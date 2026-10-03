import 'server-only';
import dns, { type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';
import { env } from './env';

// What the server sends to other sites (listing pages, offers' ads, links typed in "Add application"):
// every such request goes through fetchOutbound().
//
// SSRF policy, in production (a dev server may read localhost): only http(s); never an address on
// the server's own network or a special-purpose one (private, loopback, link-local, CGNAT, multicast,
// unspecified, reserved, and the IPv6 forms that embed one of those IPv4 addresses). A host name is
// resolved first and refused if ANY of its addresses is one. Redirects are followed here, a few hops,
// each hop checked the same way. DNS rebinding (a name that answers a public address to the check and
// a private one to the connection) is closed by the connection's own lookup: the requests go through
// an undici Agent whose `lookup` checks the addresses it is about to connect to, so the address used
// is always one that passed.

/** A desktop browser's User-Agent: some boards answer bots with nothing. */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const MAX_REDIRECTS = 5;
const PRIVATE = 'Private addresses are not allowed';

const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network", the unspecified address
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, the cloud metadata service
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
] as const)
  BLOCKED.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo: an IPv4 address hidden in it
  ['64:ff9b:1::', 48], // local-use NAT64: a private network's IPv4 addresses behind it
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  BLOCKED.addSubnet(network, prefix, 'ipv6');

/** The 8 groups of an IPv6 address, as numbers ("::ffff:7f00:1" -> [0,0,0,0,0,0xffff,0x7f00,1]). */
function groups(address: string): number[] {
  let text = address;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text); // "::ffff:127.0.0.1"
  if (v4) {
    const [, o1, o2, o3, o4] = v4.map(Number);
    text = `${text.slice(0, v4.index)}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
  }
  const part = (side: string) => (side ? side.split(':').map((group) => parseInt(group, 16)) : []);
  const halves = text.split('::'); // "::" stands for as many zero groups as are missing
  if (halves.length === 1) return part(text);
  const left = part(halves[0]);
  const right = part(halves[1]);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/** The IPv4 address an IPv6 one carries: mapped, compatible, NAT64 (last 32 bits) or 6to4 (bits 16–48). */
function embeddedIpv4(address: string): string | null {
  const parts = groups(address);
  const v4 = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  const zeros = (from: number, to: number) => parts.slice(from, to).every((group) => group === 0);
  if (zeros(0, 5) && (parts[5] === 0xffff || parts[5] === 0)) return v4(parts[6], parts[7]); // ::ffff:a.b.c.d, ::a.b.c.d
  if (zeros(0, 4) && parts[4] === 0xffff && parts[5] === 0) return v4(parts[6], parts[7]); // ::ffff:0:a.b.c.d (translated)
  if (parts[0] === 0x64 && parts[1] === 0xff9b && zeros(2, 6)) return v4(parts[6], parts[7]); // 64:ff9b::a.b.c.d
  if (parts[0] === 0x2002) return v4(parts[1], parts[2]); // 2002:AABB:CCDD::
  return null;
}

/** An address the server must not be sent to (an IP literal; anything else isn't an address). */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').replace(/%.*$/, ''); // "[fe80::1%eth0]"
  const family = isIP(ip);
  if (family === 4) return BLOCKED.check(ip, 'ipv4');
  if (family !== 6) return false;
  if (BLOCKED.check(ip, 'ipv6')) return true;
  const inner = embeddedIpv4(ip);
  return inner !== null && BLOCKED.check(inner, 'ipv4');
}

const enforced = () => env.NODE_ENV === 'production';

/** Throws unless the link is http(s) and, in production, its host and every address it resolves to are public. */
export async function checkUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a link: ${raw.slice(0, 80)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links');
  if (!enforced()) return url;
  // the URL parser already turned 2130706433, 0x7f.1 and 0177.0.0.1 into 127.0.0.1
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isBlockedAddress(host)) throw new Error(PRIVATE);
  if (isIP(host.replace(/^\[|\]$/g, ''))) return url;
  let addresses: LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Can't find ${host} (DNS)`);
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw new Error(PRIVATE);
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** The connection's own DNS lookup: the same check on the addresses it is about to connect to. */
export function checkedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) callback(error, []);
    else if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address)))
      callback(Object.assign(new Error(PRIVATE), { code: 'EPRIVATE' }), []);
    else if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

let agent: Agent | undefined;
const pinnedAgent = () => (agent ??= new Agent({ connect: { lookup: checkedLookup } }));

const REDIRECT = new Set([301, 302, 303, 307, 308]);
/**
 * What still goes to another site after a redirect: a scraper's own headers (an API key, a cookie)
 * were meant for the site it named, so on another origin only these stay.
 */
const SAFE_HEADERS = new Set(['user-agent', 'accept', 'accept-language']);
export const MAX_BYTES = 8 * 1024 * 1024;

/** fetch() failed: our refusal is the cause; tell that, not "fetch failed". */
function unwrap(error: unknown): unknown {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'EPRIVATE' ? new Error(PRIVATE) : error;
}

/**
 * A GET to a user-supplied or scraped link: checked (checkUrl), its redirects followed here up to
 * MAX_REDIRECTS hops with each hop checked, and in production connected only to checked addresses.
 */
export async function fetchOutbound(raw: string, init: Omit<RequestInit, 'redirect' | 'method' | 'body'> = {}) {
  let url = (await checkUrl(raw)).toString();
  const headers = new Headers(init.headers);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: new Headers(headers),
        redirect: 'manual',
        ...(enforced() && { dispatcher: pinnedAgent() }),
      });
    } catch (error) {
      throw unwrap(error);
    }
    const location = REDIRECT.has(res.status) ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error(`More than ${MAX_REDIRECTS} redirects`);
    const next = await checkUrl(new URL(location, url).toString());
    if (next.origin !== new URL(url).origin)
      for (const name of [...headers.keys()]) if (!SAFE_HEADERS.has(name)) headers.delete(name);
    url = next.toString();
  }
}

/**
 * A response's body as text, at most `maxBytes` (read as it streams, so a huge or endless answer
 * stops there and throws), decoded with the charset its Content-Type names.
 */
export async function readText(res: Response, maxBytes = MAX_BYTES): Promise<string> {
  if (!res.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`The page is bigger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(all);
  } catch {
    return new TextDecoder().decode(all);
  }
}
