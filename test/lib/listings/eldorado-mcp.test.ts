import { afterEach, describe, expect, it, vi } from 'vitest';
import { ELDORADO_MCP, searchArguments, searchEldorado } from '@/lib/listings/eldorado-mcp';

// Eldorado's search through its MCP server: the link's query is search_jobs' arguments; a session, its tool call,
// the session closed. The server stubbed: its answers as it gave them (October 2026).

const LINK = `${ELDORADO_MCP}?phrase=React&sortOrder=newest&workModes=remote,%20hybrid&minSalary=20000`;
const JOBS = { jobs: [{ title: 'React Developer' }], shown_results: 1, total_results: 1190 };

type Sent = { method: string; session: string | null; body: { method?: string; params?: unknown } | null };

/** The server: a session on initialize, the tool's answer as an event stream. */
function stubServer(
  result: object = { content: [{ type: 'text', text: JSON.stringify(JOBS) }], structuredContent: JOBS },
) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe(ELDORADO_MCP);
      const headers = new Headers(init.headers);
      const body = init.body ? (JSON.parse(init.body as string) as Sent['body'] & { id?: number }) : null;
      sent.push({ method: String(init.method), session: headers.get('mcp-session-id'), body });
      if (init.method === 'DELETE' || !body?.id) return Promise.resolve(new Response(null, { status: 202 }));
      if (body.method === 'initialize')
        return Promise.resolve(
          Response.json(
            { jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'czyjesteldorado' } } },
            { headers: { 'mcp-session-id': 'the-session' } },
          ),
        );
      const event = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`;
      return Promise.resolve(new Response(event, { headers: { 'content-type': 'text/event-stream' } }));
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('searchArguments', () => {
  it("reads search_jobs' arguments from the link: text, comma-separated lists, a number", () => {
    expect(searchArguments(LINK)).toEqual({
      phrase: 'React',
      sortOrder: 'newest',
      workModes: ['remote', 'hybrid'],
      minSalary: 20000,
    });
    expect(searchArguments(`${ELDORADO_MCP}?phrase=%22java%22%20-google&postedWithin=24h`)).toEqual({
      phrase: '"java" -google',
      postedWithin: '24h',
    });
  });

  it('says what is wrong: another address, an option it lacks', () => {
    expect(() => searchArguments('https://czyjesteldorado.pl/search?tag[]=React')).toThrow(
      /the link is its MCP search/,
    );
    expect(() => searchArguments(`${ELDORADO_MCP}?tag=React`)).toThrow(/no search option "tag" \(it has phrase,/);
  });
});

describe('searchEldorado', () => {
  it('a session, search_jobs with the arguments, the session closed; the structured answer', async () => {
    const sent = stubServer();
    expect(JSON.parse(await searchEldorado(LINK))).toEqual(JOBS);
    expect(sent.map((one) => [one.method, one.body?.method ?? null, one.session])).toEqual([
      ['POST', 'initialize', null],
      ['POST', 'notifications/initialized', 'the-session'],
      ['POST', 'tools/call', 'the-session'],
      ['DELETE', null, 'the-session'],
    ]);
    expect(sent[2].body?.params).toEqual({ name: 'search_jobs', arguments: searchArguments(LINK) });
  });

  it("the tool's own words when it fails, and the session closed anyway", async () => {
    const sent = stubServer({ isError: true, content: [{ type: 'text', text: 'unhandled errors in a TaskGroup' }] });
    await expect(searchEldorado(LINK)).rejects.toThrow('Eldorado MCP: unhandled errors in a TaskGroup');
    expect(sent.at(-1)?.method).toBe('DELETE');
  });
});
