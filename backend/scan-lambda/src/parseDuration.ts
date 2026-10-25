// Copied from safescan-worker: converts Google's duration strings (like "300s") into whole seconds
export function parseDuration(duration?: string, fallback = 300): number {
  if (!duration) return fallback;
  return Math.floor(parseFloat(duration.replace('s', '')));
}
