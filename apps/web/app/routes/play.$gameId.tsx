import { useParams } from "@remix-run/react";
import { GamePlayer } from "../../components/arcade/game-player";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";

export const headers = () => {
  return {
    "Cache-Control": "public, max-age=3600",
  };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not Found" }];
  const { title, description, gameId } = data as any;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:image", content: `/api/og/game?id=${gameId}` },
    { property: "og:title", content: title },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `/api/og/game?id=${gameId}` }
  ];
};

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { gameId } = params;
  if (!gameId) throw new Response("Not Found", { status: 404 });

  // In a real app, you would fetch game details from D1 here
  const title = `Play Project Neon | BrainHalf Arcade`;
  const description = `A 3D browser game generated instantly by AI. Built by @User420 on BrainHalf.`;
  
  // Increment play count (simulated)
  if ((context.cloudflare as any)?.ctx?.waitUntil) {
    (context.cloudflare as any).ctx.waitUntil(Promise.resolve());
  }

  return Response.json({ title, description, gameId });
}

export default function PlayGamePage() {
  const params = useParams();
  return (
    <GamePlayer gameId={params.gameId!} />
  );
}
