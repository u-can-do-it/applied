import 'server-only';
import { BROWSER_UA } from '../outbound';
import { isObj, str } from './extract';

// Eldorado's search through its own MCP server (czyjesteldorado.pl/_mcp, its search_jobs tool; announced in
// github.com/orgs/Czy-Jest-Eldorado/discussions/54, a beta): its Cloudflare challenges its pages from any
// datacenter, ScrapingAnt's proxies included, but not this. The scraper's link names the search: its query is
// the tool's arguments (phrase=React&sortOrder=newest&workModes=remote,hybrid). The server is this fixed
// address, never the link's host, so this is plain fetch (as for ScrapingAnt's API), not fetchOutbound.

export const ELDORADO_MCP = 'https://czyjesteldorado.pl/_mcp';
const TIMEOUT_MS = 20_000;
const PROTOCOL_VERSION = '2025-06-18';

/** search_jobs' arguments: these as text, these as comma-separated lists, minSalary a number */
const TEXT = ['phrase', 'sortOrder', 'postedWithin'];
const LISTS = ['workModes', 'contractTypes', 'workloadTypes', 'seniority'];
const OPTIONS = [...TEXT, ...LISTS, 'minSalary'];

/** The tool's arguments from the scraper's link; an option it doesn't know is an error, not ignored. */
export function searchArguments(link: string): Record<string, unknown> {
  const url = new URL(link);
  if (url.origin + url.pathname !== ELDORADO_MCP)
    throw new Error(`Eldorado: the link is its MCP search, ${ELDORADO_MCP}?phrase={keyword}&sortOrder=newest`);
  const args: Record<string, unknown> = {};
  for (const [name, value] of url.searchParams) {
    if (TEXT.includes(name)) args[name] = value;
    else if (LISTS.includes(name))
      args[name] = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    else if (name === 'minSalary') args[name] = Number(value) || null;
    else throw new Error(`Eldorado: no search option "${name.slice(0, 40)}" (it has ${OPTIONS.join(', ')})`);
  }
  return args;
}

/** A JSON-RPC answer, sent as JSON or as a server-sent event stream. */
async function answerOf(res: Response): Promise<unknown> {
  const text = await res.text();
  const body = (res.headers.get('content-type') ?? '').includes('event-stream')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
    : text;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`Eldorado MCP: HTTP ${res.status}, not JSON: ${text.trim().slice(0, 100)}`);
  }
}

/** One search: a session, its tool call, the session closed. The tool's result as JSON text, for the parser. */
export async function searchEldorado(link: string): Promise<string> {
  const args = searchArguments(link);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const open = { session: null as string | null }; // the server's id for it, once it gave one
  let id = 0;
  const post = async (method: string, params: object, notification = false) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': BROWSER_UA,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (open.session) headers['Mcp-Session-Id'] = open.session;
    const message = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
    const res = await fetch(ELDORADO_MCP, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
      signal,
      cache: 'no-store',
    });
    open.session = res.headers.get('mcp-session-id') ?? open.session;
    if (notification) {
      await res.body?.cancel();
      return null;
    }
    const answer = await answerOf(res);
    const error = isObj(answer) && isObj(answer.error) ? str(answer.error.message) : '';
    if (!res.ok || error) throw new Error(`Eldorado MCP: ${error || `HTTP ${res.status}`} (${method})`);
    return isObj(answer) && isObj(answer.result) ? answer.result : {};
  };

  try {
    await post('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jobwatch', version: '1.0' },
    });
    await post('notifications/initialized', {}, true);
    const result = (await post('tools/call', { name: 'search_jobs', arguments: args })) ?? {};
    const text = Array.isArray(result.content)
      ? result.content.map((part: unknown) => (isObj(part) ? str(part.text) : '')).join('')
      : '';
    if (result.isError) throw new Error(`Eldorado MCP: ${text.slice(0, 200) || 'the search failed'}`);
    return isObj(result.structuredContent) ? JSON.stringify(result.structuredContent) : text;
  } finally {
    // the session is the server's to keep otherwise; closing it is a courtesy, its failure no matter
    if (open.session)
      await fetch(ELDORADO_MCP, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': open.session, 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(3_000),
      })
        .then((res) => res.body?.cancel())
        .catch(() => undefined);
  }
}
