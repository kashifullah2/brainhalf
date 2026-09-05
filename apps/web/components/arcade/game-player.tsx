

import { useEffect, useState, useRef } from "react";
import { Link } from "@remix-run/react";
import { Heart, Share2, Sparkles, ChevronLeft } from "lucide-react";
import { clientApi } from "../../app/lib/api-url";

interface GameMeta {
  title: string;
  username: string;
  likeCount: number;
}

export function GamePlayer({ gameId }: { gameId: string }) {
  const [showUi, setShowUi] = useState(true);
  const [liked, setLiked] = useState(false);
  const [meta, setMeta] = useState<GameMeta>({ title: "Loading…", username: "…", likeCount: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch game metadata
  useEffect(() => {
    fetch(clientApi(`/api/arcade/games/${gameId}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setMeta({ title: (d as any).title || "Untitled", username: (d as any).username || "unknown", likeCount: (d as any).likeCount || 0 });
        }
      })
      .catch(() => {});
  }, [gameId]);

  // Record a play on mount
  useEffect(() => {
    fetch(clientApi(`/api/arcade/games/${gameId}/play`), { method: "POST", credentials: "include" }).catch(() => {});
  }, [gameId]);

  // Auto-hide UI after inactivity
  useEffect(() => {
    const handleActivity = () => {
      setShowUi(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setShowUi(false), 3000);
    };
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    window.addEventListener("keydown", handleActivity);
    timeoutRef.current = setTimeout(() => setShowUi(false), 3000);
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setMeta(m => ({ ...m, likeCount: m.likeCount + 1 }));
    try {
      await fetch(clientApi(`/api/arcade/games/${gameId}/like`), { method: "POST", credentials: "include" });
    } catch {
      // Revert on failure
      setLiked(false);
      setMeta(m => ({ ...m, likeCount: m.likeCount - 1 }));
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: meta.title, url: window.location.href });
    } catch {
      await navigator.clipboard.writeText(window.location.href);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-hidden font-sans">
      {/* Game iframe */}
      <iframe
        src={clientApi(`/api/games/render/${gameId}`)}
        className="w-full h-full border-none outline-none"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        title={meta.title}
      />

      {/* Back Button */}
      <Link
        to="/arcade"
        className={`absolute top-6 left-6 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white transition-all duration-500 hover:bg-black/60 hover:scale-105 z-50 ${showUi ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"}`}
      >
        <ChevronLeft size={20} />
      </Link>

      {/* Bottom Overlay Bar */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl h-12 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-between px-6 transition-all duration-500 shadow-2xl z-50 ${showUi ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-95 pointer-events-none"}`}>
        {/* Left: Info */}
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-white tracking-tight text-sm truncate max-w-[140px]">{meta.title}</span>
          <div className="w-1 h-1 rounded-full bg-white/30" />
          <span className="text-xs text-white/60">@{meta.username}</span>
        </div>

        {/* Center: Like */}
        <button
          onClick={handleLike}
          className="flex items-center gap-2 group absolute left-1/2 -translate-x-1/2"
          title={liked ? "Liked!" : "Like this game"}
        >
          <Heart
            size={16}
            className={`transition-colors ${liked ? "text-red-500 fill-red-500" : "text-white/60 group-hover:text-red-500"}`}
          />
          <span className="text-xs font-mono text-white/80">{meta.likeCount.toLocaleString()}</span>
        </button>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleShare}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            title="Share Game"
          >
            <Share2 size={14} />
          </button>
          <Link
            to={`/studio?remix=${gameId}`}
            className="flex items-center gap-2 px-4 h-8 rounded-full bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-lg"
          >
            <Sparkles size={14} /> Remix
          </Link>
        </div>
      </div>

      {/* BrainHalf Badge */}
      <Link
        to="/"
        className={`absolute bottom-6 right-6 px-3 py-1.5 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg flex items-center gap-2 transition-all duration-500 hover:bg-black/40 z-50 ${showUi ? "opacity-100" : "opacity-40"}`}
      >
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
        <span className="text-[10px] font-mono text-white/70 tracking-wider uppercase">Made with BrainHalf</span>
      </Link>
    </div>
  );
}
