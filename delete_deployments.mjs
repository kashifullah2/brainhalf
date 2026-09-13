import { execSync, spawn } from 'child_process';

console.log('Fetching deployments...');
const listCmd = execSync('npx wrangler pages deployment list --project-name brainhalf', { encoding: 'utf-8' });
const ids = listCmd.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g);
const uniqueIds = [...new Set(ids)];

console.log(`Found ${uniqueIds.length} deployments.`);

async function deleteDeployment(id) {
  return new Promise((resolve) => {
    console.log(`Deleting ${id}...`);
    const proc = spawn('npx', ['wrangler', 'pages', 'deployment', 'delete', id, '--project-name', 'brainhalf', '--force'], {
      stdio: ['pipe', 'inherit', 'inherit']
    });

    if (proc.stdin) {
      proc.stdin.write('y\n');
      proc.stdin.end();
    }

    proc.on('exit', (exitCode) => {
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
