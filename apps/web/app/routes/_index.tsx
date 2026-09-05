import { Link, useLoaderData } from "@remix-run/react";
import { ArrowRight } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { apiPath, cloudflareEnv, getServerApiUrl } from "../lib/api-url";
import { SiteHeader } from "../../components/landing/site-header";
import { StudioPreview } from "../../components/landing/studio-preview";

export const meta: MetaFunction = () => {
  return [
    { title: "BrainHalf — describe a game, get something playable" },
    {
      name: "description",
      content:
        "BrainHalf is a small studio in the browser: describe a game, get something playable, and share it in the arcade.",
    },
    { property: "og:title", content: "BrainHalf" },
    { property: "og:image", content: "/og-image.png" },
  ];
};

interface ArcadeGame {
  id: string;
  title?: string;
  playCount?: number;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const env = cloudflareEnv(context) as { KV?: KVNamespace; CACHE?: KVNamespace; API_URL?: string } | undefined;
  const kv = env?.KV ?? env?.CACHE;
  const cacheKey = "stats:homepage";

  if (kv) {
    const cached = await kv.get(cacheKey, "json");
    if (cached) return Response.json(cached);
  }

  try {
    let gamesCount = 0;
    let playsCount = 0;
    let recentGames: ArcadeGame[] = [];

    const apiBase = getServerApiUrl(request, env);
    const arcadeRes = await fetch(apiPath(apiBase, "/api/arcade/games?limit=6"));
    if (arcadeRes.ok) {
      const arcade = (await arcadeRes.json()) as { games?: ArcadeGame[] };
      recentGames = arcade.games ?? [];
      gamesCount = recentGames.length;
      playsCount = recentGames.reduce((sum, g) => sum + (g.playCount ?? 0), 0);
    }

    const data = { gamesCount, playsCount, recentGames };
    if (kv) {
      await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
    }
    return Response.json(data);
  } catch {
    return Response.json({ gamesCount: 0, playsCount: 0, recentGames: [] });
  }
}

type LoaderData = {
  gamesCount: number;
  playsCount: number;
  recentGames: ArcadeGame[];
};

export default function HomePage() {
  const { gamesCount, playsCount } = useLoaderData<LoaderData>();

  const gamesLabel = gamesCount > 0 ? gamesCount.toLocaleString() : "—";
  const playsLabel = playsCount > 0 ? playsCount.toLocaleString() : "—";

  return (
    <div className="landing-page">
      <SiteHeader />

      <main>
        <div className="landing-wrap">
          <section className="landing-hero">
            <div>
              <p className="landing-eyebrow">
                public beta
                <kbd>v0.1</kbd>
                <span>— rough edges expected</span>
              </p>

              <h1 className="landing-h1">
                Describe a game.
                <br />
                Get something you can <em>actually play</em>.
              </h1>

              <p className="landing-lead">
                BrainHalf is a browser studio: you type what you want, an agent builds the
                game, and you play it right away. Tweak the details beside it until it feels
                right — not a mockup, something you can actually ship.
              </p>

              <div className="landing-cta-row">
                <Link to="/studio" className="landing-btn-primary">
                  Open studio
                  <ArrowRight size={14} style={{ marginLeft: 6 }} />
                </Link>
                <Link to="/arcade" className="landing-btn-ghost">
                  See what people shipped
                </Link>
              </div>

              <p className="landing-fine">
                free to try · 100 credits on signup · works in your browser
              </p>

              <div className="landing-stats">
                <div className="landing-stat">
                  <span>{gamesLabel}</span>
                  games in arcade
                </div>
                <div className="landing-stat">
                  <span>{playsLabel}</span>
                  plays logged
                </div>
                <div className="landing-stat">
                  <span>~30s</span>
                  first playable (usually)
                </div>
              </div>
            </div>

            <StudioPreview />
          </section>

          <section className="landing-section">
            <h2>how it works</h2>
            <div className="landing-steps">
              <article className="landing-step">
                <div className="landing-step-num">01 — prompt</div>
                <h3>Say what you want in plain language</h3>
                <p>
                  &quot;Roguelike dungeon with fog of war&quot; beats a spec doc. The agent
                  figures out the rest from there.
                </p>
              </article>
              <article className="landing-step">
                <div className="landing-step-num">02 — build</div>
                <h3>See your game take shape</h3>
                <p>
                  Watch the game come together in real time. Preview it, adjust the details,
                  and keep iterating until it clicks.
                </p>
              </article>
              <article className="landing-step">
                <div className="landing-step-num">03 — ship</div>
                <h3>Publish to the arcade</h3>
                <p>
                  Share a link. Others play in the browser, remix your project, and keep
                  improving it together.
                </p>
              </article>
            </div>
          </section>

          <section className="landing-section">
            <h2>what you get</h2>
            <div className="landing-notes">
              <p>Chat, preview, and edits in one place — no tab hopping.</p>
              <p>2D or 3D — the agent picks what fits your idea.</p>
              <p>Your game stays yours to edit and share, not a locked export.</p>
              <p>Arcade for discovery; dashboard for your projects and credits.</p>
              <p>Honest limits: complex multiplayer MMOs aren&apos;t the goal. Small games are.</p>
            </div>
          </section>

          <section className="landing-section" style={{ paddingBottom: 32 }}>
            <h2>try it</h2>
            <p
              style={{
                fontSize: "1.125rem",
                lineHeight: 1.6,
                color: "var(--text-2)",
                maxWidth: "36ch",
                margin: "0 0 24px",
              }}
            >
              Worst case you burn a few credits and learn what the agent is good at. Best case
              you have a playable prototype before your coffee cools.
            </p>
            <Link to="/studio" className="landing-btn-primary">
              Start in studio →
            </Link>
          </section>
        </div>
      </main>

      <footer className="landing-wrap landing-footer">
        <span>© {new Date().getFullYear()} brainhalf</span>
        <div className="landing-footer-links">
          <Link to="/arcade">Arcade</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/sign-in">Sign in</Link>
          <Link to="/dashboard">Dashboard</Link>
        </div>
      </footer>
    </div>
  );
}
