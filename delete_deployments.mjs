import * as pty from 'node-pty';
import { execSync } from 'child_process';
import fs from 'fs';

console.log('Fetching deployments...');
const listCmd = execSync('npx wrangler pages deployment list --project-name brainhalf', { encoding: 'utf-8' });
const ids = listCmd.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g);
const uniqueIds = [...new Set(ids)];

console.log(`Found ${uniqueIds.length} deployments.`);

async function deleteDeployment(id) {
  return new Promise((resolve) => {
    console.log(`Deleting ${id}...`);
    const ptyProcess = pty.spawn('npx', ['wrangler', 'pages', 'deployment', 'delete', id, '--project-name', 'brainhalf'], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    });

    let buffer = '';
    ptyProcess.onData((data) => {
      process.stdout.write(data);
      buffer += data;
      if (buffer.includes('Y/n')) {
        ptyProcess.write('y\r');
        buffer = ''; // reset buffer after sending y
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`\nFinished ${id} with code ${exitCode}`);
      resolve();
    });
  });
}

async function run() {
  for (const id of uniqueIds) {
    await deleteDeployment(id);
  }
  console.log('Done deleting deployments.');
}

run();
