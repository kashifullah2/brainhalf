import { WebContainer } from '@webcontainer/api';

let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

export async function getWebContainer(): Promise<WebContainer> {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }
  
  if (!bootPromise) {
    bootPromise = WebContainer.boot();
  }
  
  try {
    webcontainerInstance = await bootPromise;
    return webcontainerInstance;
  } catch (error) {
    console.error('Failed to boot WebContainer:', error);
    bootPromise = null;
    throw error;
  }
}
