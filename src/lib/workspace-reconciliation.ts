import { isBlockedSecretFile } from './secret-files';
import { basicReactTemplate } from './templates';
import { STARTER_APP_JSX, STARTER_MAIN_JSX, STARTER_STYLES_CSS } from './preview-templates';
import { createTypeScriptStarter } from './project-starters';

type FileMap = Record<string, string>;
const createTypeScriptBaseline = createTypeScriptStarter();

const baseline: FileMap = {
  '/src/App.jsx': basicReactTemplate.src.directory['App.jsx'].file.contents,
  '/src/main.jsx': basicReactTemplate.src.directory['main.jsx'].file.contents,
  '/src/styles.css': basicReactTemplate.src.directory['styles.css'].file.contents,
};
const serverBaseline: FileMap = {
  '/src/App.jsx': STARTER_APP_JSX,
  '/src/main.jsx': STARTER_MAIN_JSX,
  '/src/styles.css': STARTER_STYLES_CSS,
};

export function reconcileWorkspaceSnapshot(local: FileMap, remote: FileMap): { files: FileMap; conflicts: string[]; hasLocalChanges: boolean } {
  const files = { ...remote };
  const conflicts: string[] = [];
  let hasLocalChanges = false;
  for (const path of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (isBlockedSecretFile(path)) {
      if (typeof local[path] === 'string') files[path] = local[path];
      continue;
    }
    if (local[path] !== remote[path]) conflicts.push(path);
    if (typeof local[path] === 'string' && local[path] !== baseline[path] && local[path] !== serverBaseline[path] && local[path] !== createTypeScriptBaseline[path]) hasLocalChanges = true;
  }
  return { files, conflicts, hasLocalChanges };
}
