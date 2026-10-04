// Shared by the server and client components: what a browser's push subscription looks like
// (PushSubscription.toJSON()), checked before it's saved, since the server will send to it.
import * as z from 'zod/mini';

const NOT_A_SUBSCRIPTION = 'This browser’s push subscription doesn’t look right.';
/** base64url, as the browser encodes the keys (unpadded; padding tolerated) */
const BASE64URL = /^[\w-]+={0,2}$/;
const key = (min: number, max: number) =>
  z
    .string({ error: NOT_A_SUBSCRIPTION })
    .check(
      z.regex(BASE64URL, NOT_A_SUBSCRIPTION),
      z.minLength(min, NOT_A_SUBSCRIPTION),
      z.maxLength(max, NOT_A_SUBSCRIPTION),
    );

/**
 * The push services browsers subscribe with: Chrome's (Google's FCM), Firefox's (Mozilla's), Edge's
 * (Windows' WNS) and Safari's. The server sends to a subscription's endpoint, so it may only be one of
 * these: anything else (a private address, a site of someone's choosing) is refused here and by
 * lib/push.ts before each send.
 */
const PUSH_HOST =
  /^(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|(?:[a-z0-9-]+\.)+notify\.windows\.com)$/;

/** A known push service's https URL, on its default port, without a user name or password. */
export function isPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && PUSH_HOST.test(url.hostname);
}

/** The push service's URL for this browser: a known push service's, https. */
export const endpoint = z
  .string({ error: NOT_A_SUBSCRIPTION })
  .check(
    z.maxLength(2048, NOT_A_SUBSCRIPTION),
    z.refine(
      isPushEndpoint,
      'This browser’s push service isn’t one Jobwatch sends to (Chrome, Firefox, Edge, Safari).',
    ),
  );

export const pushSubscriptionSchema = z.object({
  endpoint,
  expirationTime: z.optional(z.nullable(z.number())),
  keys: z.object(
    {
      // a P-256 public key, 65 bytes: 87 characters; the auth secret, 16 bytes: 22
      p256dh: key(80, 100),
      auth: key(16, 32),
    },
    { error: NOT_A_SUBSCRIPTION },
  ),
});

export type PushSubscriptionInput = z.input<typeof pushSubscriptionSchema>;

/** One device, by its subscription's endpoint (test, disable). */
export const endpointSchema = z.object({ endpoint });
