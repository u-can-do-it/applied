// Shared by the server and client components.

/** What went wrong, in words: an Error's message, anything else as String() prints it. */
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
