import { prepareProjectExport } from './project-export';
import { readBoundedJson } from './http-body';
import { isBlockedSecretFile } from './secret-files';
import { isSafeFilePath, normalizePath } from './utils';

interface Repository { default_branch: string; private: boolean; html_url: string; size: number }

function validateRepoInput(repoName: string, token: string, owner?: string) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repoName) || ['.', '..'].includes(repoName)) throw new Error('Enter a repository name without a URL or owner prefix.');
  if (owner && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) throw new Error('Invalid GitHub owner.');
  if (!token.trim() || /[\r\n]/.test(token)) throw new Error('Enter a valid GitHub access token.');
}

function githubApi(token: string) {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  return async function api<T>(path: string, method = 'GET', body?: unknown, allowMissing = false): Promise<T | null> {
    let response: Response;
    try { response = await fetch('https://api.github.com' + path, { method, headers, redirect: 'error', signal: AbortSignal.timeout(30_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error('GitHub could not be reached. Check your connection and try again.'); }
    if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error('GitHub denied access. Check the token’s repository permissions and rate limit.');
      if (response.status === 409 || response.status === 422) throw new Error('The repository or branch changed. Review the latest GitHub files and retry; no branch was overwritten.');
      throw new Error(`GitHub request failed (HTTP ${response.status}). Retry after checking the repository.`);
    }
    return await readBoundedJson<T>(response, 2_000_000);
  };
}

/** Non-destructive GitHub sync: preserve unrelated files and refuse concurrent branch updates. */
export async function exportToGitHub(files: Record<string, string>, repoName: string, token: string, owner?: string) {
  const prepared = prepareProjectExport(files);
  validateRepoInput(repoName, token, owner);
  const api = githubApi(token);
  const user = await api<{ login: string }>('/user');
  if (!user || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) throw new Error('Could not identify the GitHub account.');
  const username = owner || user.login;
  const base = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}`;
  let repo = await api<Repository>(base, 'GET', undefined, true);
  if (!repo) repo = await api<Repository>(username === user.login ? '/user/repos' : `/orgs/${encodeURIComponent(username)}/repos`, 'POST', { name: repoName, private: true, auto_init: true, description: 'Project built with BrainHalf' });
  if (!repo?.default_branch) throw new Error('GitHub did not return a default branch. Initialize the repository and retry.');
  const branch = encodeURIComponent(repo.default_branch);
  let ref = await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${branch}`, 'GET', undefined, true);
  if (!ref) {
    // Only a confirmed empty repository may be initialized. Permission/server errors never enter this branch.
    if (repo.size !== 0) throw new Error('Default branch not found. Choose a valid default branch in GitHub first.');
    await api(`${base}/contents/.brainhalf`, 'PUT', { message: 'Initialize BrainHalf project', content: btoa('BrainHalf source export\n'), branch: repo.default_branch });
    ref = await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${branch}`);
  }
  const parent = ref?.object?.sha;
  if (!parent || !/^[a-f0-9]{40,64}$/.test(parent)) throw new Error('GitHub returned an invalid branch reference.');
  const commit = await api<{ tree: { sha: string } }>(`${base}/git/commits/${parent}`);
  if (!commit?.tree?.sha || !/^[a-f0-9]{40,64}$/.test(commit.tree.sha)) throw new Error('GitHub could not read the current source tree.');
  const tree = await api<{ sha: string }>(`${base}/git/trees`, 'POST', { base_tree: commit.tree.sha, tree: Object.entries(prepared.files).map(([path, content]) => ({ path: path.slice(1), mode: '100644', type: 'blob', content })) });
  if (!tree?.sha || !/^[a-f0-9]{40,64}$/.test(tree.sha)) throw new Error('GitHub returned an invalid source tree. No branch was changed.');
  const created = await api<{ sha: string }>(`${base}/git/commits`, 'POST', { message: 'Update project files from BrainHalf', tree: tree?.sha, parents: [parent] });
  if (!created?.sha || !/^[a-f0-9]{40,64}$/.test(created.sha)) throw new Error('GitHub returned an invalid commit. No branch was changed.');
  const current = await api<{ object: { sha: string } }>(`${base}/git/ref/heads/${branch}`);
  if (current?.object?.sha !== parent) throw new Error('New commits arrived on GitHub during export. Review those changes and retry; no branch was overwritten.');
  await api(`${base}/git/refs/heads/${branch}`, 'PATCH', { sha: created?.sha, force: false });
  return `https://github.com/${username}/${repoName}`;
}

export interface GitHubImport {
  files: Record<string, string>;
  skipped: string[];
  repoUrl: string;
  branch: string;
}

const IMPORT_OMIT_PATH = /(^|\/)(?:\.git|node_modules|\.wrangler|\.next|dist|dist-worker|coverage|test-results|playwright-report)(?:\/|$)/i;
const IMPORT_MAX_FILES = 500;
const IMPORT_MAX_TOTAL_BYTES = 10_000_000;
const IMPORT_MAX_FILE_BYTES = 1_000_000;
const IMPORT_CONCURRENCY = 4;

/**
 * Pull a repository's default-branch source into project files. Mirrors the
 * export boundary in the other direction: build output, private credential
 * files and binary blobs are skipped, never imported.
 */
export async function importFromGitHub(repoName: string, token: string, owner?: string): Promise<GitHubImport> {
  validateRepoInput(repoName, token, owner);
  const api = githubApi(token);
  const user = await api<{ login: string }>('/user');
  if (!user || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) throw new Error('Could not identify the GitHub account.');
  const username = owner || user.login;
  const base = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}`;
  const repo = await api<Repository>(base, 'GET', undefined, true);
  if (!repo) throw new Error(`Repository ${username}/${repoName} was not found. Check the name and the token’s access.`);
  if (!repo.default_branch) throw new Error('GitHub did not return a default branch for this repository.');
  if (repo.size === 0) throw new Error('This repository is empty. There is nothing to import.');
  const listing = await api<{ truncated?: boolean; tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }> }>(
    `${base}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`
  );
  if (!listing || !Array.isArray(listing.tree)) throw new Error('GitHub could not read the repository file listing.');
  if (listing.truncated) throw new Error('This repository is too large to import. Remove build output and vendor directories first.');
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let totalBytes = 0;
  let binaryFiles = 0;
  const candidates = listing.tree.filter(entry => {
    if (entry.type !== 'blob' || typeof entry.path !== 'string' || typeof entry.sha !== 'string') return false;
    const raw = '/' + entry.path;
    if (!isSafeFilePath(raw)) { skipped.push(raw); return false; }
    const path = normalizePath(raw);
    if (IMPORT_OMIT_PATH.test(path) || isBlockedSecretFile(path) || /\/(?:\.env|\.dev\.vars)(?:\.[^/]*)?$/i.test(path)) { skipped.push(path); return false; }
    if (typeof entry.size === 'number' && entry.size > IMPORT_MAX_FILE_BYTES) { skipped.push(path); return false; }
    return true;
  }) as Array<{ path: string; sha: string }>;
  for (let index = 0; index < candidates.length; index += IMPORT_CONCURRENCY) {
    const batch = candidates.slice(index, index + IMPORT_CONCURRENCY);
    const decoded = await Promise.all(batch.map(async entry => {
      const blob = await api<{ content?: string; encoding?: string }>(`${base}/git/blobs/${entry.sha}`);
      if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string') return null;
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), char => char.charCodeAt(0)); }
      catch { return null; }
      try { return { path: normalizePath('/' + entry.path), text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes: bytes.byteLength }; }
      catch { return null; }
    }));
    for (const result of decoded) {
      if (!result) { binaryFiles += 1; continue; }
      if (Object.keys(files).length >= IMPORT_MAX_FILES || totalBytes + result.bytes > IMPORT_MAX_TOTAL_BYTES) { skipped.push(result.path); continue; }
      if (Object.prototype.hasOwnProperty.call(files, result.path)) continue;
      totalBytes += result.bytes;
      files[result.path] = result.text;
    }
  }
  if (binaryFiles > 0) skipped.push(`${binaryFiles} binary file${binaryFiles === 1 ? '' : 's'}`);
  if (!Object.keys(files).length) throw new Error('No importable source files found in this repository.');
  return { files, skipped, repoUrl: `https://github.com/${username}/${repoName}`, branch: repo.default_branch };
}
