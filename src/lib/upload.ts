// ---------------------------------------------------------------------------
// File upload hook.
//
// Uploads to our own /api/storage/upload, which stores the file in R2 under a
// key owned by the signed-in user. A failure is now reported as a failure: the
// previous version resolved with a fabricated `client-storage/...` path on 404,
// 500, and network errors alike, so broken uploads rendered as green ticks.
// ---------------------------------------------------------------------------

import { useState, useCallback } from "react";

import { apiUrl } from "./api-paths";

export interface UploadResult {
  objectPath: string;
  sizeBytes: number;
  contentType: string;
  contentHash: string;
}

interface UseUploadReturn {
  uploadFile: (file: File) => Promise<UploadResult>;
  progress: number;
  error: Error | null;
}

function messageFromResponse(responseText: string, status: number): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    if (responseText.trimStart().startsWith("<")) {
      return (
        "The upload API is not running. Start the app with `pnpm dev:api` so " +
        "the Pages Functions and storage bucket are available."
      );
    }
  }
  if (status === 401) return "Your session has expired. Sign in again.";
  return `Upload failed (${status}).`;
}

export function useUpload(): UseUploadReturn {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const uploadFile = useCallback(async (file: File): Promise<UploadResult> => {
    setProgress(0);
    setError(null);

    try {
      const result = await new Promise<UploadResult>((resolve, reject) => {
        const formData = new FormData();
        formData.append("file", file);

        // XMLHttpRequest rather than fetch, because it is still the only way to
        // observe upload progress in a browser.
        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiUrl("/storage/upload"));
        xhr.withCredentials = true;

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText) as UploadResult;
              if (!data.objectPath) {
                reject(new Error("The server did not return a storage path."));
                return;
              }
              resolve(data);
            } catch {
              reject(new Error("The server returned an unreadable response."));
            }
            return;
          }
          reject(new Error(messageFromResponse(xhr.responseText, xhr.status)));
        });

        xhr.addEventListener("error", () =>
          reject(new Error("Network error while uploading. Check your connection.")),
        );
        xhr.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));

        xhr.send(formData);
      });

      setProgress(100);
      return result;
    } catch (err) {
      const uploadError = err instanceof Error ? err : new Error("Upload failed.");
      setError(uploadError);
      throw uploadError;
    }
  }, []);

  return { uploadFile, progress, error };
}
