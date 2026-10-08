import { afterEach, describe, expect, it, vi } from 'vitest';
import { withApiParams } from '@/lib/listings/api-params';

const LINK = 'https://api.adzuna.com/v1/api/jobs/pl/search/1?what_or=React%20Vue';

afterEach(() => vi.unstubAllEnvs());

const withKeys = () => {
  vi.stubEnv('ADZUNA_APP_ID', 'the-id');
  vi.stubEnv('ADZUNA_APP_KEY', 'the-key');
};

describe('withApiParams', () => {
  it("asks Adzuna for JSON with the keys from the environment, the link's own query as written", () => {
    withKeys();
    expect(withApiParams('adzuna', LINK)).toBe(`${LINK}&content-type=application%2Fjson&app_id=the-id&app_key=the-key`);
    expect(withApiParams('adzuna', 'https://api.adzuna.com/v1/api/jobs/pl/search/1?')).toBe(
      'https://api.adzuna.com/v1/api/jobs/pl/search/1?content-type=application%2Fjson&app_id=the-id&app_key=the-key',
    );
  });

  it('keeps what the link has of its own', () => {
    withKeys();
    const own = `${LINK}&content-type=application/json&app_id=mine&app_key=my-key`;
    expect(withApiParams('adzuna', own)).toBe(own);
  });

  it('says which variable is missing', () => {
    vi.stubEnv('ADZUNA_APP_ID', 'the-id');
    vi.stubEnv('ADZUNA_APP_KEY', '');
    expect(() => withApiParams('adzuna', LINK)).toThrow(/^ADZUNA_APP_KEY is not set/);
  });

  it("asks an ATS's API for the company its careers link names", () => {
    expect(withApiParams('ats', 'https://job-boards.greenhouse.io/gitlab')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs',
    );
    expect(() => withApiParams('ats', 'https://example.com/careers')).toThrow(/^Not a careers page on Greenhouse/);
  });

  it('leaves the other kinds alone', () => {
    const link = 'https://justjoin.it/api/candidate-api/offers?keywords=React';
    expect(withApiParams('justjoin', link)).toBe(link);
  });
});
