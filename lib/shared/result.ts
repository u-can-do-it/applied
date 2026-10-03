// Shared by the server and client components.

/** The answer of anything that can fail with a message for the user, e.g. every server action. */
export type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

export function ok(): Result;
export function ok<T>(data: T): Result<T>;
export function ok<T>(data?: T): Result<T | undefined> {
  return { ok: true, data };
}

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The data, or the error thrown: for code that handles failures with try/catch. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
