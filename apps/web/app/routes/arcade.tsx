import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData } from "@remix-run/react";
import { Search, Play, TrendingUp, Sparkles } from "lucide-react";
import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { apiPath, clientApi, cloudflareEnv, getServerApiUrl } from "../lib/api-url";

interface Game {
  id: string;
  title: string;
  description?: string;
  gameType: string;
  thumbnailUrl?: string;
  playCount: number;
  likeCount: number;
  username: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "all";
  const sort = url.searchParams.get("sort") || "trending";
  const page = url.searchParams.get("page") || "1";

  const env = cloudflareEnv(context) as { KV?: KVNamespace; CACHE?: KVNamespace; API_URL?: string } | undefined;
  const kv = env?.KV ?? env?.CACHE;
  const cacheKey = `arcade:games:${type}:${sort}:${page}`;

  if (kv) {
    const cached = await kv.get(cacheKey, "json");
    if (cached) return Response.json(cached);
  }

  try {
    const apiBase = getServerApiUrl(request, env);
    const params = new URLSearchParams({ page, limit: "24" });
    if (type !== "all") params.set("type", type.toLowerCase());

    const [gamesRes, trendingRes] = await Promise.all([
      fetch(apiPath(apiBase, `/api/arcade/games?${params}`)),
      fetch(apiPath(apiBase, "/api/arcade/trending")),
    ]);

    const gamesJson = gamesRes.ok
      ? ((await gamesRes.json()) as { games?: Game[] })
      : { games: [] as Game[] };
    const trendingJson = trendingRes.ok
      ? ((await trendingRes.json()) as { games?: Game[] })
      : { games: [] as Game[] };

    const initialGames: Game[] = gamesJson.games ?? [];
    const initialTrending: Game[] = trendingJson.games ?? [];
    const hasMore = initialGames.length === 24;

    const data = { initialGames, initialTrending, initialHasMore: hasMore };
    if (kv) {
      await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 60 });
    }
    return Response.json(data);
  } catch {
    return Response.json({ initialGames: [], initialTrending: [], initialHasMore: false });
  }
}

const getGradient = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const c1 = `hsl(${Math.abs(hash) % 360}, 60%, 40%)`;
  const c2 = `hsl(${Math.abs(hash * 2) % 360}, 70%, 20%)`;
  return `linear-gradient(135deg, ${c1}, ${c2})`;
};

const GameCard = ({ game, featured = false }: { game: Game; featured?: boolean }) => (
  <div className={`group relative flex flex-col gap-3 rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-pointer ${featured ? "w-[400px] shrink-0" : "w-full"}`}>
    <div className="w-full aspect-video rounded-xl relative overflow-hidden shadow-md" style={{ background: game.thumbnailUrl ? `url(${game.thumbnailUrl}) center/cover` : getGradient(game.id) }}>
      <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono font-medium text-white shadow-sm z-10">
        {game.gameType?.toUpperCase()}
      </div>
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors duration-300 z-10 flex flex-col items-center justify-center gap-4 opacity-0 group-hover:opacity-100">
        <Link to={`/play/${game.id}`} className="transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 w-12 h-12 rounded-full bg-[var(--accent)] flex items-center justify-center text-white shadow-lg hover:scale-110">
          <Play size={20} className="ml-1" />
        </Link>
        <Link to={`/studio?remix=${game.id}`} className="transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 delay-75 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold text-white hover:bg-white/20 flex items-center gap-2">
          <Sparkles size={14} /> Remix
        </Link>
      </div>
    </div>
    <div className="flex flex-col gap-1 px-1">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[14px] font-semibold text-white tracking-tight truncate">{game.title}</h3>
        <div className="flex items-center gap-1 text-[var(--text-2)] shrink-0">
          <Play size={10} className="opacity-70" />
          <span className="text-[10px] font-mono">{game.playCount.toLocaleString()}</span>
        </div>
      </div>
      <span className="text-[12px] text-[var(--text-2)]">@{game.username}</span>
    </div>
  </div>
);

const SkeletonCard = () => (
  <div className="flex flex-col gap-3 rounded-xl overflow-hidden w-full animate-pulse">
    <div className="w-full aspect-video rounded-xl bg-[var(--bg-3)]" />
    <div className="flex flex-col gap-2 px-1">
      <div className="h-4 bg-[var(--bg-3)] rounded w-2/3" />
      <div className="h-3 bg-[var(--bg-3)] rounded w-1/3" />
    </div>
  </div>
);

export default function ArcadePage() {
  const { initialGames, initialTrending, initialHasMore } = useLoaderData<typeof loader>() as any;
  
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sortFilter, setSortFilter] = useState("Trending");
  const [games, setGames] = useState<Game[]>(initialGames);
  const [trending, setTrending] = useState<Game[]>(initialTrending);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !loadingMore && hasMore && !loading) {
          const nextPage = page + 1;
          setLoadingMore(true);
          const params = new URLSearchParams({ page: String(nextPage), limit: "12" });
          if (typeFilter !== "All") params.set("type", typeFilter.toLowerCase());
          fetch(clientApi(`/api/arcade/games?${params}`), { credentials: "include" })
            .then(r => r.ok ? r.json() : { games: [] })
            .then((d: any) => {
              const newGames = d.games || [];
              setGames(prev => [...prev, ...newGames]);
              setPage(nextPage);
              setHasMore(newGames.length === 12);
            })
            .finally(() => setLoadingMore(false));
        }
      },
      { threshold: 0.1 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [loadingMore, hasMore, loading, page, typeFilter]);

  // Filter/search on type change — refetch
  useEffect(() => {
    // Skip initial load since loader handles it
    if (typeFilter === "All" && page === 1 && games.length === initialGames.length) return;
    
    setLoading(true);
    setPage(1);
    const params = new URLSearchParams({ page: "1", limit: "24" });
    if (typeFilter !== "All") params.set("type", typeFilter.toLowerCase());
    fetch(clientApi(`/api/arcade/games?${params}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : { games: [] })
      .then((d: any) => { setGames(d.games || []); setHasMore((d.games || []).length === 24); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, sortFilter]);

  const displayedGames = search
    ? games.filter(g => g.title.toLowerCase().includes(search.toLowerCase()) || g.username.toLowerCase().includes(search.toLowerCase()))
    : games;

  return (
    <div className="flex flex-col w-full h-full bg-[#0a0a0a] text-white overflow-hidden font-sans">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-[#1c1c1c] shrink-0 flex flex-col pt-8 pb-4 px-10 gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-mono font-bold tracking-tight">Arcade</h1>
          <div className="relative w-full max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              placeholder="Search games..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#111111] border border-[#1c1c1c] rounded-full py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors text-white placeholder:text-[#555555]"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 bg-[#111111] p-1 rounded-lg border border-[#1c1c1c]">
            {["All", "2D", "3D"].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`px-5 py-1 text-xs font-semibold rounded-md transition-colors ${typeFilter === t ? "bg-[var(--accent)] text-white shadow-sm" : "text-[#888888] hover:text-white"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-sm text-[#888888]">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} />
              <select value={sortFilter} onChange={e => setSortFilter(e.target.value)} className="bg-transparent border-none outline-none hover:text-white cursor-pointer">
                <option>Trending</option>
                <option>New</option>
                <option>Most Played</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 overflow-y-auto px-10 py-10 flex flex-col gap-12 pb-24">
        {/* Trending section */}
        {!search && typeFilter === "All" && trending.length > 0 && (
          <section className="flex flex-col gap-5">
            <h2 className="text-sm font-semibold tracking-wider text-[#555555] uppercase font-mono">Trending</h2>
            <div className="flex gap-6 overflow-x-auto pb-4 no-scrollbar">
              {trending.map(game => <GameCard key={game.id} game={game} featured />)}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-5">
          {!search && <h2 className="text-sm font-semibold tracking-wider text-[#555555] uppercase font-mono">Explore</h2>}
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-6 gap-y-10">
              {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : displayedGames.length === 0 ? (
             <div className="text-center py-20 text-[var(--text-3)] font-mono text-sm">
              {search ? `No games matching "${search}"` : "No games published yet. Be the first!"}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-6 gap-y-10">
              {displayedGames.map(game => <GameCard key={game.id} game={game} />)}
              {loadingMore && Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
            </div>
          )}
          <div ref={observerTarget} className="w-full h-4 opacity-0" />
        </section>
      </div>
    </div>
  );
}
