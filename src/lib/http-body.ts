/** Bound upstream JSON before parsing so a huge response cannot exhaust a Worker. */
export async function readBoundedJson<T>(response: Response, maxBytes: number): Promise<T> {
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response.');
  const decoder = new TextDecoder(); let bytes = 0; let text = '';
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > maxBytes) { await reader.cancel(); throw new Error('Response exceeds the supported size.'); } text += decoder.decode(chunk.value, { stream: true }); }
    return JSON.parse(text + decoder.decode()) as T;
  } finally { reader.releaseLock(); }
}
