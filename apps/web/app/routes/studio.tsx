import { redirect } from "@remix-run/cloudflare";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  
  // Redirect to the standalone studio app
  // In development, Vite typically runs the studio on port 5173.
  const studioUrl = isLocal ? "http://localhost:5173" : "https://studio.brainhalf.com";
  
  return redirect(studioUrl);
};
