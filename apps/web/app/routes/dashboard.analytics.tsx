import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
  return [
    { title: "Analytics | Dashboard" }
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  return Response.json({ message: "Analytics data loaded." });
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>() as any;
  
  return (
    <div style={{ padding: "40px 48px", height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Analytics</h1>
      <p style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 40 }}>View performance metrics for your games.</p>
      
      <div style={{ padding: 40, border: "1px dashed var(--border)", borderRadius: 12, textAlign: "center" }}>
        <p style={{ color: "var(--text-3)" }}>{data.message}</p>
      </div>
    </div>
  );
}
