import 'server-only';
import { z } from 'zod';

// Every environment variable the app reads, with its default; .env.example says what each is for.
// Checked on first use, not at import: `next build` loads this module without any of them set.
// A missing or malformed variable fails where it's read, with its name, so the parts that don't
// need it keep working (no database URL: the login page still answers; no OpenAI key: no AI tab).

/** `VAR=` with nothing after it, as .env.example has them, counts as not set */
const unset = (value: unknown) => (value === '' ? undefined : value);
const optional = z.preprocess(unset, z.string().optional());
const withDefault = (fallback: string) => z.preprocess(unset, z.string().default(fallback));
const url = z.url({
  protocol: /^https?$/,
  error: (issue) => (issue.input === undefined ? 'is not set' : 'is not an http(s) URL'),
});
const trimSlashes = (value: string) => value.replace(/\/+$/, '');
const vapidKey = (what: string) => z.string().regex(/^[\w-]+=*$/, { error: `is not ${what}` });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).catch('development'),

  // the database (lib/db, npm run db:migrate); nothing loads without it. Supabase → Connect →
  // Session pooler (port 5432), on Vercel and here alike. Not the Transaction pooler (6543): pages
  // hang through it (lib/db/client.ts)
  SUPABASE_DB_URL: z.preprocess(
    unset,
    z
      .string({ error: 'is not set' })
      .regex(/^postgres(ql)?:\/\//, { error: 'is not a postgresql:// URL (Supabase → Connect → Session pooler)' }),
  ),

  // the login; production without it answers 503 everywhere (proxy.ts)
  APP_PASSWORD: optional,
  // what Supabase Cron sends to /api/cron/scrape; derived from APP_PASSWORD when not set
  CRON_SECRET: optional,

  // the AI filter and "Fill in" (optional: without a key the app runs without them)
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: withDefault('gpt-6-luna'),
  // a model per job; not set = OPENAI_MODEL
  OPENAI_ASSESS_MODEL: optional,
  OPENAI_DEDUP_MODEL: optional,
  OPENAI_EXTRACT_MODEL: optional,
  OPENAI_ASSESS_EFFORT: withDefault('high'),
  OPENAI_DEDUP_EFFORT: withDefault('low'),
  OPENAI_EXTRACT_EFFORT: withDefault('low'),
  OPENAI_BASE_URL: z.preprocess(unset, url.default('https://api.openai.com/v1')).transform(trimSlashes),

  // Telegram (optional: without both, offers are saved but not sent)
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  // another Bot API server (e.g. a local one, or a stand-in for tests)
  TELEGRAM_API_URL: z.preprocess(unset, url.default('https://api.telegram.org')).transform(trimSlashes),

  // Adzuna's API (optional: without both, its scraper fails with "ADZUNA_APP_ID is not set");
  // developer.adzuna.com → Dashboard → API Access Details
  ADZUNA_APP_ID: optional,
  ADZUNA_APP_KEY: optional,

  // Web Push (optional: without all three, no push notifications). `npx web-push generate-vapid-keys`
  // makes the pair; the subject is how a push service reaches you: mailto:you@example.com or an https URL
  VAPID_PUBLIC_KEY: z.preprocess(unset, vapidKey('a VAPID public key (base64url)').optional()),
  VAPID_PRIVATE_KEY: z.preprocess(unset, vapidKey('a VAPID private key (base64url)').optional()),
  VAPID_SUBJECT: z.preprocess(
    unset,
    z
      .string()
      .regex(/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/, { error: 'is not a mailto: address or an https:// URL' })
      .optional(),
  ),

  // set by Vercel: the production domain, for links in Telegram and the cron / webhook addresses
  VERCEL_PROJECT_PRODUCTION_URL: optional,
});

export type Env = z.output<typeof schema>;
type Key = keyof Env;

/** The variables checked; reading one that's missing or malformed throws "SUPABASE_DB_URL is not set". */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;
  const problems = new Map<string | symbol, string>();
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    if (!problems.has(key)) problems.set(key, `${key} ${issue.message}`);
  }
  const without = Object.fromEntries([...problems.keys()].map((key) => [key, true])) as Partial<Record<Key, true>>;
  const rest: Partial<Env> = schema.omit(without).parse(source);
  return new Proxy(rest, {
    get(target, key, receiver) {
      const problem = problems.get(key);
      if (problem) throw new Error(problem);
      return Reflect.get(target, key, receiver) as unknown;
    },
  }) as Env;
}

// NODE_ENV by name: the bundler inlines it, so it stays the build's value, as it was before
const read = () => parseEnv({ ...process.env, NODE_ENV: process.env.NODE_ENV });
let parsed: Env | undefined;

/** process.env, parsed on first use; in development on every use, so an edited .env counts without a restart */
export const env: Env = new Proxy({} as Env, {
  get(_, key) {
    const current = process.env.NODE_ENV === 'production' ? (parsed ??= read()) : read();
    return Reflect.get(current, key) as unknown;
  },
});
