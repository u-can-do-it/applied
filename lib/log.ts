import 'server-only';
import { env } from './env';
import { message } from './shared/errors';

// The server's log: one JSON line per event ({"ts", "level", "msg", …context}), on stdout (info) or
// stderr (warn, error), which is where Vercel's runtime logs read it (Project → Logs). Errors that
// happen after the answer (after()) or in the background are only seen here.
//
// Never a secret: values under secret-looking keys, the secrets the app is configured with (the
// database URL, the bot token…), a URL's password and its token-like query parameters are replaced
// with [redacted]. An error is logged by message() (a failed query's cause, never its SQL or its
// values) and its stack's "at" lines.

export type LogContext = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

const REDACTED = '[redacted]';
/** keys whose value is a secret, whatever it looks like */
const SECRET_KEY = /token|secret|passw|pwd|authorization|cookie|api[-_]?key|credential|signature|^dsn$|db_?url/i;
/** query parameters that carry one */
// a whole name, or its last part after "-" / "_" (access_token, client_secret, x-api-key), so
// keywords, author or zipcode stay as they are
const SECRET_PARAM =
  /^(?:.*[-_])?(?:token|secret|password|passwd|pwd|pass|sig|signature|key|apikey|auth|code|session|sessionid|credentials?)$/i;
/** what a secret looks like inside free text, and what it becomes */
const SECRET_TEXT: [RegExp, string][] = [
  [/\bbot\d+:[\w-]{20,}/g, REDACTED], // a Telegram bot token, in a Bot API URL
  [/\bsk-[\w-]{16,}/g, REDACTED], // an OpenAI key
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, REDACTED],
  // libpq's key=value connection strings (and error messages quoting one): password='…' / pwd=…
  [/\b(password|passwd|pwd)\s*=\s*('(?:[^'\\]|\\.)*'|"[^"]*"|[^\s&;,]+)/gi, `$1=${REDACTED}`],
];
const URL_IN_TEXT = /\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi;
const SECRET_ENV = ['SUPABASE_DB_URL', 'APP_PASSWORD', 'CRON_SECRET', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'] as const;

/**
 * The configured secrets' values (a malformed or missing one is simply not there), also as they
 * look inside a URL (percent-encoded), and the database password on its own.
 */
function configuredSecrets(): string[] {
  const values = new Set<string>();
  const add = (value: string | undefined) => {
    if (value && value.length >= 6) values.add(value);
  };
  for (const name of SECRET_ENV) {
    try {
      const value = env[name];
      add(value);
      if (value) add(encodeURIComponent(value));
    } catch {
      // not set or malformed: nothing to hide
    }
  }
  try {
    const password = new URL(env.SUPABASE_DB_URL).password;
    add(password);
    add(decodeURIComponent(password));
  } catch {
    // no database URL, or not one with a password
  }
  // the longest first: a secret that contains another is replaced whole
  return [...values].sort((a, b) => b.length - a.length);
}

/** Token-like parameters' values replaced; true if any was. */
function scrubParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const name of new Set(params.keys()))
    if (SECRET_PARAM.test(name)) {
      params.set(name, REDACTED);
      changed = true;
    }
  return changed;
}

/**
 * A URL without its password (or its user name when that's all there is: a token as userinfo), and
 * with its token-like parameters replaced, in the query and in the fragment (#access_token=…).
 */
function scrubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  if (url.password) {
    url.password = REDACTED;
    changed = true;
  } else if (url.username) {
    url.username = REDACTED;
    changed = true;
  }
  if (scrubParams(url.searchParams)) changed = true;
  if (url.hash.includes('=')) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (scrubParams(fragment)) {
      url.hash = fragment.toString();
      changed = true;
    }
  }
  return changed ? url.toString() : raw;
}

export function scrubText(text: string, secrets = configuredSecrets()): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  out = out.replace(URL_IN_TEXT, scrubUrl);
  for (const [pattern, replacement] of SECRET_TEXT) out = out.replace(pattern, replacement);
  return out;
}

/**
 * An error as fields: what went wrong (message()), why (its cause's message: "fetch failed" is
 * nothing without it) and where (the stack's frames only).
 */
function errorFields(error: unknown, secrets: string[]): LogContext {
  if (!(error instanceof Error)) return { error: scrubText(message(error), secrets) };
  // the stack's first lines repeat the message, which for a failed query holds its values
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 12)
    .map((line) => line.trim());
  // message() already tells a failed query by its cause
  const cause = error.cause !== undefined && !error.message.startsWith('Failed query') ? message(error.cause) : '';
  return {
    error: scrubText(message(error), secrets),
    ...(cause && { cause: scrubText(cause, secrets) }),
    ...(frames.length && { stack: scrubText(frames.join('\n'), secrets) }),
  };
}

function scrubValue(value: unknown, secrets: string[], depth: number): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (value === null || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (value instanceof Error) return errorFields(value, secrets);
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return '[…]';
  if (value instanceof Headers) return scrubValue([...value.entries()], secrets, depth);
  if (Array.isArray(value)) {
    // a header as a [name, value] pair
    if (value.length === 2 && typeof value[0] === 'string' && SECRET_KEY.test(value[0])) return [value[0], REDACTED];
    return value.slice(0, 50).map((item) => scrubValue(item, secrets, depth + 1));
  }
  return scrubContext(value as LogContext, secrets, depth + 1);
}

function scrubContext(context: LogContext, secrets: string[], depth = 0): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (key === 'error') Object.assign(out, errorFields(value, secrets));
    else out[key] = SECRET_KEY.test(key) ? REDACTED : scrubValue(value, secrets, depth);
  }
  return out;
}

/** The line written for one event (exported for the tests). */
export function formatEntry(level: Level, msg: string, context: LogContext = {}, now = new Date()): string {
  const secrets = configuredSecrets();
  return JSON.stringify({
    ts: now.toISOString(),
    level,
    msg: scrubText(msg, secrets),
    ...scrubContext(context, secrets),
  });
}

function write(level: Level, msg: string, context?: LogContext) {
  let line: string;
  try {
    line = formatEntry(level, msg, context);
  } catch {
    // a context that can't be written (a cycle the depth cap missed…): the event still is
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg });
  }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * `log.error('AI run slice crashed', { runId, error })`. Context keys say what the event is about:
 * `runId`, `scraper`, `jobId`, `route`…; `error` takes the caught value as it is.
 */
export const log = {
  info: (msg: string, context?: LogContext) => write('info', msg, context),
  warn: (msg: string, context?: LogContext) => write('warn', msg, context),
  error: (msg: string, context?: LogContext) => write('error', msg, context),
};
