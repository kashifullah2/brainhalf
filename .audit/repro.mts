import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { addTypeScriptBackend, createTypeScriptStarter } from '../src/lib/project-starters.ts';
const directory = mkdtempSync(join(tmpdir(), 'brainhalf-product-'));
for (const [p, content] of Object.entries(addTypeScriptBackend(createTypeScriptStarter()))) {
  const dest = join(directory, p.slice(1));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content as string);
}
symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
console.log('DIR=' + directory);
execFile(process.execPath, ['--experimental-strip-types', '--test', 'server/app.test.ts'], { cwd: directory, timeout: 30000 }, (err, stdout, stderr) => {
  console.log('ERR:', err?.message);
  console.log('STDOUT:', stdout?.slice(-3000));
  console.log('STDERR:', stderr?.slice(-3000));
});
