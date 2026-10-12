import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/alerts/linkedin/route';
import * as alertsRepo from '@/lib/db/repos/alert-jobs';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { hmac } from '@/lib/hmac';
import { alertsSecret, gmailScript } from '@/lib/listings/gmail-alerts';

// The Gmail script's endpoint: one LinkedIn alert email in, its jobs waiting for the next run.

vi.mock('@/lib/db/repos/alert-jobs', () => ({ add: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-state', () => ({ markAlertEmail: vi.fn() }));

const add = vi.mocked(alertsRepo.add);
const markEmail = vi.mocked(stateRepo.markAlertEmail);

const EMAIL =
  '<a href="https://www.linkedin.com/comm/jobs/view/4466208580/?trk=a&amp;refId=b">Front End Engineer</a>' +
  '<a href="https://www.linkedin.com/comm/jobs/view/4475683203/?trk=a">Senior React Developer</a>';

const post = async (body: unknown, secret?: string | null) =>
  POST(
    new NextRequest('https://jobwatch.test/api/alerts/linkedin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret !== null && { authorization: `Bearer ${secret ?? (await alertsSecret())}` }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-test-secret');
  add.mockReset().mockResolvedValue(1);
  markEmail.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/alerts/linkedin', () => {
  it("adds the email's jobs and says how many were new", async () => {
    const response = await post({ html: EMAIL });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobwatch: 'ok', jobs: 2, new: 1 });
    expect(add).toHaveBeenCalledWith('linkedin', ['4466208580', '4475683203']);
    expect(markEmail).toHaveBeenCalledWith(2);
  });

  it('an email without jobs is taken, and noted as such', async () => {
    add.mockResolvedValue(0);
    expect(await (await post({ html: '<p>Your weekly digest</p>' })).json()).toEqual({
      jobwatch: 'ok',
      jobs: 0,
      new: 0,
    });
    expect(markEmail).toHaveBeenCalledWith(0);
  });

  it('only with the secret: derived from the cron one, so a new CRON_SECRET means a new one', async () => {
    expect((await post({ html: EMAIL }, null)).status).toBe(401);
    expect((await post({ html: EMAIL }, 'cron-test-secret')).status).toBe(401);
    expect(await alertsSecret()).toBe(await hmac('cron-test-secret', 'jobwatch-alerts-v1'));
    expect(add).not.toHaveBeenCalled();
  });

  it('anything but {"html": "…"} is a bad request', async () => {
    for (const body of ['not json', { html: 42 }, { text: EMAIL }, null])
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    expect((await post({ html: 'x'.repeat(2_000_001) })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('the database failing: not 200, so the script sends the email again', async () => {
    add.mockRejectedValue(new Error('connection refused'));
    const response = await post({ html: EMAIL });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ jobwatch: 'error' });
  });
});

describe('the Gmail script', () => {
  const script = gmailScript('https://jobwatch.test/api/alerts/linkedin', 'se"cret');

  it('is JavaScript, with the endpoint and secret in it', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- parsing the script is the test
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('const JOBWATCH = "https://jobwatch.test/api/alerts/linkedin";');
    expect(script).toContain('const SECRET = "se\\"cret";');
  });

  it('sends each new email from LinkedIn once, oldest first, and stops at an answer that is not 200', () => {
    const sent: { url: string; secret: string; html: string }[] = [];
    const properties = new Map<string, string>();
    let answer = 200;
    const message = (html: string, at: number) => ({ getBody: () => html, getDate: () => new Date(at) });
    let threads = [{ getMessages: () => [message('second', 2000), message('first', 1000)] }];
    const google = {
      GmailApp: { search: (query: string) => (query.includes('jobalerts-noreply@linkedin.com') ? threads : []) },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key: string) => properties.get(key) ?? null,
          setProperty: (key: string, value: string) => properties.set(key, value),
        }),
      },
      UrlFetchApp: {
        fetch: (url: string, options: { headers: { Authorization: string }; payload: string }) => {
          sent.push({
            url,
            secret: options.headers.Authorization,
            html: (JSON.parse(options.payload) as { html: string }).html,
          });
          return { getResponseCode: () => answer, getContentText: () => '{"jobwatch":"error"}' };
        },
      },
      ScriptApp: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script as Apps Script runs it, with Google's services stubbed
    const run = new Function(...Object.keys(google), `${script}\nsendAlerts();`) as (...services: unknown[]) => void;
    const send = () => run(...Object.values(google));

    send();
    expect(sent).toEqual([
      { url: 'https://jobwatch.test/api/alerts/linkedin', secret: 'Bearer se"cret', html: 'first' },
      { url: 'https://jobwatch.test/api/alerts/linkedin', secret: 'Bearer se"cret', html: 'second' },
    ]);
    send(); // nothing new
    expect(sent).toHaveLength(2);

    threads = [{ getMessages: () => [message('second', 2000), message('third', 3000), message('fourth', 4000)] }];
    answer = 500;
    expect(send).toThrow('Jobwatch answered 500: {"jobwatch":"error"}');
    answer = 200;
    send(); // the one that failed again, then the next
    expect(sent.map((email) => email.html)).toEqual(['first', 'second', 'third', 'third', 'fourth']);
  });
});
