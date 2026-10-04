import type { WebContainer, WebContainerProcess } from '@webcontainer/api';

export interface DevServerHandle {
  process: WebContainerProcess;
  url: string;
}

export async function installDependencies(
  container: WebContainer,
  onOutput?: (data: string) => void,
): Promise<number> {
  const process = await container.spawn('npm', ['install', '--prefer-offline']);
  if (onOutput) {
    process.output.pipeTo(new WritableStream({ write(data) { onOutput(data); } })).catch(() => {});
  }
  return process.exit;
}

export async function startDevServer(
  container: WebContainer,
  onOutput?: (data: string) => void,
): Promise<DevServerHandle> {
  const process = await container.spawn('npm', ['run', 'dev']);
  if (onOutput) {
    process.output.pipeTo(new WritableStream({ write(data) { onOutput(data); } })).catch(() => {});
  }

  const url = await new Promise<string>((resolve) => {
    container.on('server-ready', (_port: number, serverUrl: string) => {
      resolve(serverUrl);
    });
  });

  return { process, url };
}

export async function spawnShell(
  container: WebContainer,
): Promise<WebContainerProcess> {
  return container.spawn('jsh', { terminal: { cols: 80, rows: 24 } });
}

export async function runCommand(
  container: WebContainer,
  command: string,
  args: string[] = [],
  onOutput?: (data: string) => void,
): Promise<number> {
  const process = await container.spawn(command, args);
  if (onOutput) {
    process.output.pipeTo(new WritableStream({ write(data) { onOutput(data); } })).catch(() => {});
  }
  return process.exit;
}
