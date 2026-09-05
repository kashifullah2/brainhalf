import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { cloudflareEnv, getServerApiUrl } from "./lib/api-url";

import { ThemeProvider, ThemeInitScript } from "../components/theme-provider";
import "./globals.css";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = cloudflareEnv(context);
  return {
    apiUrl: getServerApiUrl(request, env),
    studioUrl: env?.STUDIO_URL?.trim() || "https://studio.brainhalf.com",
  };
}

export default function App() {
  const { apiUrl, studioUrl } = useLoaderData<typeof loader>();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <ThemeInitScript />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__BRAINHALF_API_URL=${JSON.stringify(apiUrl)};window.__BRAINHALF_STUDIO_URL=${JSON.stringify(studioUrl)};`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
