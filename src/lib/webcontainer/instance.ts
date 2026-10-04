type WebContainerType = typeof import('@webcontainer/api').WebContainer;
type WebContainerInstance = InstanceType<WebContainerType>;

let instance: WebContainerInstance | null = null;
let bootPromise: Promise<WebContainerInstance> | null = null;

export function webContainerSupported(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined';
  } catch {
    return false;
  }
}

export async function getWebContainer(): Promise<WebContainerInstance> {
  if (instance) return instance;
  if (bootPromise) return bootPromise;
  if (!webContainerSupported()) {
    throw new Error('WebContainers require cross-origin isolation (SharedArrayBuffer). Falling back to edge preview.');
  }
  bootPromise = import('@webcontainer/api').then(({ WebContainer }) =>
    WebContainer.boot()
  ).then(wc => {
    instance = wc;
    bootPromise = null;
    return wc;
  }).catch(err => {
    bootPromise = null;
    throw err;
  });
  return bootPromise;
}

export function getWebContainerSync(): WebContainerInstance | null {
  return instance;
}

export function teardownWebContainer(): void {
  instance?.teardown();
  instance = null;
  bootPromise = null;
}
