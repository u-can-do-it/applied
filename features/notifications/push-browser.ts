// This browser's side of push notifications (client components only): the service worker
// (public/sw.js, registered by features/shell/service-worker.tsx) and its push subscription.

export const SW_URL = '/sw.js';
/** Subscribing asks the browser's push service (Google's, for Chrome); without it, the browser waits on and on. */
const SUBSCRIBE_TIMEOUT_MS = 20_000;

/** Service workers, the Push API and notifications: Chrome on Android has them; some browsers and in-app views don't. */
export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const registerServiceWorker = () =>
  navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null && a.byteLength === b.length && new Uint8Array(a).every((byte, i) => byte === b[i]);

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Subscribes this browser with the server's key, or returns the subscription it has with that key.
 * One made with another key (the VAPID keys were changed) is dropped first: the push service would
 * refuse the server's messages to it.
 */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  await registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameBytes(existing.options.applicationServerKey, key)) return existing;
  await existing?.unsubscribe();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('The browser couldn’t reach its push service: check the connection and try again.'));
    }, SUBSCRIBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
