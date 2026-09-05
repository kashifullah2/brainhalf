export function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export function formatPlayCount(count: number) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return count.toString();
}

export function getGameGradient() {
  const hues = [0, 60, 120, 180, 240, 300];
  const h1 = hues[Math.floor(Math.random() * hues.length)];
  const h2 = (h1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 80%, 60%), hsl(${h2}, 80%, 60%))`;
}

export function formatCredits(credits: number) {
  return credits.toLocaleString();
}
