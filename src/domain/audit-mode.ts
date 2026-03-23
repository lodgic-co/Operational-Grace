/**
 * Prefix segment for OG reservation/hold mutation routes (`/live/...` vs `/training/...`).
 * Returns null when the path does not start with a live or training operational prefix.
 */
export function ogMutationPathBusinessMode(path: string): 'live' | 'training' | null {
  const p = path.split('?')[0] ?? path;
  const m = p.match(/^\/(live|training)\//i);
  if (!m) return null;
  return m[1]!.toLowerCase() === 'live' ? 'live' : 'training';
}
