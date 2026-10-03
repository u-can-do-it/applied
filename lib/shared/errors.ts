// Shared by the server and client components.

/**
 * What went wrong, in words: an Error's message, anything else as String() prints it. A failed
 * database query comes wrapped by drizzle-orm as "Failed query: <the SQL>\nparams: <the values>",
 * with the database's own error as its cause; the values can be a note's text or a secret, and the
 * message ends up in the UI and in the run logs, so only the cause is told.
 */
export function message(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message.startsWith('Failed query'))
    return error.cause instanceof Error ? message(error.cause) : 'The database query failed.';
  return error.message;
}
