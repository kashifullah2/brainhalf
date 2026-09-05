import { useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Profile Not Found" }];
  const typedData = data as any;
  if (!typedData) return [{ title: "Profile Not Found" }];
  return [
    { title: `${typedData.username}'s Profile | BrainHalf` }
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { username } = params as any;
  if (!username) throw new Response("Not Found", { status: 404 });
  
  // Simulated D1 fetch for profile and games
  return Response.json({ username, games: [] });
}

export default function ProfilePage() {
  const { username, games } = useLoaderData<typeof loader>() as any;
  
  return (
    <div style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>@{username}</h1>
      <p style={{ color: "var(--text-2)" }}>User profile and public games.</p>
      
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Public Games</h2>
        {games.length === 0 ? (
          <p style={{ color: "var(--text-3)" }}>No public games found.</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {/* Game list would go here */}
          </div>
        )}
      </div>
    </div>
  );
}
