import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { PROFILE_FILE_MAX, profileSchema, startRunSchema } from '@/lib/shared/schemas/ai';
import {
  addApplicationSchema,
  removeStepSchema,
  setNoteSchema,
  setStatusSchema,
  updateApplicationSchema,
  type ApplicationInput,
} from '@/lib/shared/schemas/applications';
import { loginSchema } from '@/lib/shared/schemas/auth';
import { scraperSchema, type ScraperForm } from '@/lib/shared/schemas/scrapers';
import { filtersSchema, scheduleSchema, storedSettingsSchema, timeZoneSchema } from '@/lib/shared/schemas/settings';

/** the message the user would see (the action wrapper shows the first issue) */
const problem = (schema: z.core.$ZodType, input: unknown) => {
  const parsed = z.safeParse(schema, input, { error: () => 'Bad request.' });
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe('loginSchema', () => {
  it('only goes on to a path on this site', () => {
    expect(loginSchema.parse({ password: 'x', next: '/ai?days=1' }).next).toBe('/ai?days=1');
    expect(loginSchema.parse({ password: 'x', next: '//evil.example' }).next).toBe('/');
    expect(loginSchema.parse({ password: 'x', next: 'https://evil.example' }).next).toBe('/');
    expect(loginSchema.parse({}).next).toBe('/');
  });

  it('reads the path the way a browser does: a backslash or a tab can make it another site', () => {
    const next = (path: string) => loginSchema.parse({ password: 'x', next: path }).next;
    expect(next('/\\evil.example')).toBe('/'); // also what ?next=/%5Cevil.example arrives as
    expect(next(decodeURIComponent('/%5Cevil.example'))).toBe('/');
    expect(next('/\t/evil.example')).toBe('/');
    expect(next('/\\/evil.example')).toBe('/');
    expect(next('/settings?tab=a\\b')).toBe('/settings?tab=a\\b'); // in the query a backslash is just a character
    expect(next('/applied#note')).toBe('/applied#note');
  });
});

describe('profileSchema', () => {
  it('ignores an empty file input and cuts the text fields', () => {
    const parsed = profileSchema.parse({ profileId: '', name: 'n'.repeat(100), file: new File([], '') });
    expect(parsed).toEqual({
      profileId: undefined,
      name: 'n'.repeat(80),
      prompt: '',
      file: undefined,
      removeFile: false,
    });
  });

  it('needs a name (the form asks for one; the server no longer names it "Profile")', () => {
    expect(problem(profileSchema, { name: '  ', prompt: 'React roles' })).toBe('Give the profile a name.');
    expect(problem(profileSchema, { prompt: 'React roles' })).toBe('Give the profile a name.');
  });

  it('refuses a file over 5 MB', () => {
    const big = new File([new Uint8Array(PROFILE_FILE_MAX + 1)], 'cv.pdf');
    expect(problem(profileSchema, { name: 'x', file: big })).toBe('The file is larger than 5 MB.');
  });
});

describe('startRunSchema', () => {
  it('keeps only a known day preset', () => {
    expect(startRunSchema.parse({ profileId: 'p', days: '7' }).days).toBe('7');
    expect(startRunSchema.parse({ profileId: 'p', days: '9999' }).days).toBe('');
  });
});

const application: ApplicationInput = {
  url: 'https://justjoin.it/job-offer/acme-react-dev',
  title: '  React developer ',
  company: 'Acme',
  board: '',
  day: '2026-10-01',
  stage: 'submitted',
  outcome: 'pending',
  salary: '20k',
  contract: '',
  location: '',
  workMode: 'remote',
  officeDays: '2 office / 3 home',
  content: '',
  note: '  call back ',
};

describe('addApplicationSchema', () => {
  it('keeps what is saved: trimmed, the board from the link, the details that were given', () => {
    expect(addApplicationSchema.parse(application)).toEqual({
      title: 'React developer',
      url: 'https://justjoin.it/job-offer/acme-react-dev',
      board: 'justjoin',
      day: '2026-10-01',
      company: 'Acme',
      details: { salary: '20k', workMode: 'remote', remote: true },
      content: '',
      stage: 'submitted',
      outcome: 'pending',
      note: 'call back',
    });
  });

  it('says what is wrong, the first problem in the form’s order', () => {
    expect(problem(addApplicationSchema, { ...application, title: ' ', url: 'nope' })).toBe('The title is needed.');
    expect(problem(addApplicationSchema, { ...application, url: 'nope' })).toBe('The link must start with https://');
    expect(problem(addApplicationSchema, { ...application, board: 'No Board!' })).toBe(
      'Board: lowercase letters, digits, - or _ (e.g. "linkedin").',
    );
    expect(problem(addApplicationSchema, { ...application, day: '2026-02-30' })).toBe(
      'Pick the day you applied (not in the future).',
    );
    expect(problem(addApplicationSchema, { ...application, stage: 'hired?' })).toBe('Unknown status.');
  });

  it('keeps the days in the office only for a hybrid job; rejects an unknown work mode', () => {
    expect(addApplicationSchema.parse({ ...application, workMode: 'hybrid' }).details).toEqual({
      salary: '20k',
      workMode: 'hybrid',
      officeDays: '2 office / 3 home',
    });
    expect(problem(addApplicationSchema, { ...application, workMode: 'mars' })).toBe('Unknown work mode.');
  });

  it('without a link the board is "unknown", and no details is null', () => {
    const parsed = addApplicationSchema.parse({ ...application, url: '', salary: '', workMode: '' });
    expect(parsed.board).toBe('unknown');
    expect(parsed.details).toBeNull();
  });
});

describe('updateApplicationSchema', () => {
  it('needs the job id', () => {
    const { stage: _stage, outcome: _outcome, note: _note, ...input } = application;
    expect(problem(updateApplicationSchema, { jobId: '', input })).toBe('Bad request.');
    expect(updateApplicationSchema.parse({ jobId: 'k', input }).input.board).toBe('justjoin');
  });
});

describe('status schemas', () => {
  it('words a wrong status for the status picker, anything else is a bad request', () => {
    expect(problem(setStatusSchema, { jobId: 'k', stage: 'submitted', outcome: 'nope' })).toBe('Unknown status.');
    expect(problem(removeStepSchema, { jobId: 'k', step: { stage: 'nope', state: 'pending', at: '' } })).toBe(
      'Bad request.',
    );
  });
});

describe('scheduleSchema', () => {
  it('takes an interval from the list and whole hours 0–24', () => {
    expect(scheduleSchema.parse({ everyMinutes: 15, fromHour: 0, toHour: 24 })).toEqual({
      everyMinutes: 15,
      fromHour: 0,
      toHour: 24,
    });
    expect(problem(scheduleSchema, { everyMinutes: 7, fromHour: 7, toHour: 22 })).toBe(
      'Pick an interval from the list.',
    );
    expect(problem(scheduleSchema, { everyMinutes: 5, fromHour: 7.5, toHour: 22 })).toBe('Hours are 0–24.');
    expect(problem(scheduleSchema, { everyMinutes: 5, fromHour: 7, toHour: Number.NaN })).toBe('Hours are 0–24.');
  });
});

describe('timeZoneSchema', () => {
  it('takes a real zone only: a pick, never "the browser\'s"', () => {
    expect(timeZoneSchema.parse({ tz: 'Asia/Tokyo' })).toEqual({ tz: 'Asia/Tokyo' });
    expect(problem(timeZoneSchema, { tz: '' })).toBe('Unknown time zone.');
    expect(problem(timeZoneSchema, { tz: 'Mars/Base' })).toBe('Unknown time zone.');
  });
});

describe('filtersSchema', () => {
  it('keeps the lists the way they are saved', () => {
    expect(
      filtersSchema.parse({ keywords: 'React, Vue ;Next.js', cities: '', remoteOk: true, ignore: 'PHP', mute: '' }),
    ).toEqual({ keywords: ['React', 'Vue', 'Next.js'], cities: [], remoteOk: true, ignore: ['PHP'], mute: [] });
  });
});

describe('storedSettingsSchema', () => {
  it('fills in what is missing or wrong with the defaults', () => {
    expect(storedSettingsSchema.parse(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(storedSettingsSchema.parse('nonsense')).toEqual(DEFAULT_SETTINGS);
    const stored = storedSettingsSchema.parse({
      enabled: false,
      everyMinutes: 7,
      fromHour: 25,
      toHour: 20,
      keywords: [' React ', '', 42],
      timeZone: 'Mars/Base',
      browserTimeZone: 'Europe/Warsaw',
      notify: 'yes',
    });
    expect(stored).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
      toHour: 20,
      keywords: ['React', '42'],
      browserTimeZone: 'Europe/Warsaw',
    });
  });
});

const scraper: ScraperForm = {
  name: ' My board ',
  src: 'MyBoard',
  kind: 'html',
  enabled: true,
  config: {
    url: ' https://jobs.example.com/?q={keyword}&p={page} ',
    pages: 9,
    headers: { 'X-Api-Version': '1.0' },
    checkKeyword: true,
    checkLocation: false,
    items: ' li.job ',
    fields: { title: ' h3 ', url: 'h3 a@href', company: ' ' },
  },
};

describe('scraperSchema', () => {
  it('keeps what makes sense', () => {
    expect(scraperSchema.parse(scraper)).toEqual({
      id: undefined,
      scraper: {
        name: 'My board',
        src: 'myboard',
        kind: 'html',
        enabled: true,
        config: {
          url: 'https://jobs.example.com/?q={keyword}&p={page}',
          pages: 5, // MAX_PAGES
          headers: { 'X-Api-Version': '1.0' },
          checkKeyword: true,
          checkLocation: false,
          items: 'li.job',
          fields: { title: 'h3', url: 'h3 a@href' },
        },
      },
    });
  });

  it('gives a built-in board its own board id and leaves the generic settings out', () => {
    const parsed = scraperSchema.parse({ ...scraper, kind: 'justjoin', src: 'whatever' });
    expect(parsed.scraper.src).toBe('justjoin');
    expect(parsed.scraper.config.items).toBeUndefined();
    expect(parsed.scraper.config.fields).toBeUndefined();
  });

  it('says what is wrong', () => {
    const config = scraper.config;
    expect(problem(scraperSchema, { ...scraper, kind: 'ftp' })).toBe('Pick a type.');
    expect(problem(scraperSchema, { ...scraper, name: '  ' })).toBe('Give it a name.');
    expect(problem(scraperSchema, { ...scraper, config: { ...config, url: 'jobs.example.com' } })).toBe(
      'The link must start with https://',
    );
    expect(problem(scraperSchema, { ...scraper, config: { ...config, headers: { 'Bad name': 'x' } } })).toBe(
      'Bad header name "Bad name".',
    );
    expect(problem(scraperSchema, { ...scraper, src: 'Not ok!' })).toBe(
      'Board id: lowercase letters, digits, - or _, e.g. "linkedin".',
    );
    expect(problem(scraperSchema, { ...scraper, src: 'linkedin' })).toBe(
      '"linkedin" belongs to a built-in board; pick another board id.',
    );
    expect(problem(scraperSchema, { ...scraper, config: { ...config, items: '' } })).toBe(
      'Give the CSS selector of one offer.',
    );
    expect(problem(scraperSchema, { ...scraper, config: { ...config, fields: { title: 'h3' } } })).toBe(
      'Title and Link are needed.',
    );
    expect(
      problem(scraperSchema, { ...scraper, kind: 'json', config: { ...config, from: 'script', scriptId: ' ' } }),
    ).toBe('Give the id of the <script> with the JSON.');
  });

  it('reads JSON from the body unless told otherwise', () => {
    const json = { ...scraper, kind: 'json' as const, config: { ...scraper.config, from: 'nonsense' as 'body' } };
    expect(scraperSchema.parse(json).scraper.config.from).toBe('body');
  });
});

describe('setNoteSchema', () => {
  const note = (seenAt: unknown) => setNoteSchema.safeParse({ jobId: 'acme|dev', note: 'hi', seenAt }).success;

  it('takes the note_updated_at the database gives (microseconds, +00:00), or null for a note never written', () => {
    expect(note('2026-10-03T12:34:56.123456+00:00')).toBe(true);
    expect(note('2026-10-03T12:34:56+02:00')).toBe(true);
    expect(note('2026-10-03T12:34:56.123Z')).toBe(true);
    expect(note(null)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(note('yesterday')).toBe(false);
    expect(note('2026-10-03 12:34:56+00')).toBe(false);
    expect(note(undefined)).toBe(false);
    expect(note(1)).toBe(false);
  });
});
