import { prepareProjectExport } from './project-export';
import { readBoundedJson } from './http-body';

interface Repository { default_branch: string; private: boolean; html_url: string; size: number }
/** Non-destructive GitHub sync: preserve unrelated files and refuse concurrent branch updates. */
export async function exportToGitHub(files: Record<string, string>, repoName: string, token: string, owner?: string) {
  const prepared = prepareProjectExport(files);
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(repoName) || ['.', '..'].includes(repoName)) throw new Error('Enter a repository name without a URL or owner prefix.');
  if (owner && !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) throw new Error('Invalid GitHub owner.');
  if (!token.trim() || /[\r\n]/.test(token)) throw new Error('Enter a valid GitHub access token.');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api<T>(path: string, method = 'GET', body?: unknown, allowMissing = false): Promise<T | null> {
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
  }
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
