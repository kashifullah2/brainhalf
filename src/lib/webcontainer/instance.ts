import { WebContainer } from '@webcontainer/api';

let instance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

export function webContainerSupported(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined';
  } catch {
    return false;
  }
}

export async function getWebContainer(): Promise<WebContainer> {
  if (instance) return instance;
  if (bootPromise) return bootPromise;
  if (!webContainerSupported()) {
    throw new Error('WebContainers require cross-origin isolation (SharedArrayBuffer). Falling back to edge preview.');
  }
  bootPromise = WebContainer.boot().then(wc => {
    instance = wc;
    bootPromise = null;
    return wc;
  }).catch(err => {
    bootPromise = null;
    throw err;
  });
  return bootPromise;
}

export function getWebContainerSync(): WebContainer | null {
  return instance;
}

export function teardownWebContainer(): void {
  instance?.teardown();
  instance = null;
  bootPromise = null;
}
