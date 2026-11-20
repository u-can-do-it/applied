// Shared by the server and client components.

/** 1234 -> "1.2 s"; by default whole seconds from 10 s on, where the tenths don't matter */
export const seconds = (ms: number, digits = ms < 10_000 ? 1 : 0) => `${(ms / 1000).toFixed(digits)} s`;

/** 3 of 12 -> "25%"; of none -> "–" */
export const percentOf = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

/** How long ago, roughly: "just now", "12 min ago", "5 h ago" (up to 48 h), then "3 days ago". */
export function ago(iso: string, now = Date.now()) {
  const ms = now - Date.parse(iso);
  return ms < 30_000 ? 'just now' : `${duration(ms)} ago`;
}

/** How long, roughly: "12 min", "5 h" (up to 48 h), then "3 days". */
export function duration(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
}
