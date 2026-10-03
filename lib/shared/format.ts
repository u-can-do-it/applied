// Shared by the server and client components.

/** 1234 -> "1.2 s"; by default whole seconds from 10 s on, where the tenths don't matter */
export const seconds = (ms: number, digits = ms < 10_000 ? 1 : 0) => `${(ms / 1000).toFixed(digits)} s`;

/** 3 of 12 -> "25%"; of none -> "–" */
export const percentOf = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
