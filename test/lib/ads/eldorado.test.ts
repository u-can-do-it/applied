import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEldorado } from '@/lib/ads/eldorado';
import { ELDORADO_MCP, searchEldorado } from '@/lib/listings/eldorado-mcp';

// Eldorado's ad: what its MCP search lists about the one job (#<id>), its pages being out of reach. The search's
// answer is the recorded one (test/fixtures/eldorado.json).

vi.mock('@/lib/listings/eldorado-mcp', () => ({
  ELDORADO_MCP: 'https://czyjesteldorado.pl/_mcp',
  searchEldorado: vi.fn(),
}));

const recorded = JSON.parse(readFileSync(new URL('../../fixtures/eldorado.json', import.meta.url), 'utf8')) as {
  jobs: { url: string }[];
};
const answer = (jobs: object[]) => vi.mocked(searchEldorado).mockResolvedValue(JSON.stringify({ jobs }));
const offer = (id: string) => ({ src: 'eldorado', id, url: `https://czyjesteldorado.pl/praca/${id}-x` });

afterEach(() => vi.clearAllMocks());

describe('readEldorado', () => {
  it('searches its id, and gives what Eldorado lists: details and a text of them', async () => {
    const cities = recorded.jobs[1]; // hybrid, in Gdańsk and Warszawa
    answer([cities]);
    const ad = await readEldorado(offer('460556'));
    expect(searchEldorado).toHaveBeenCalledWith(`${ELDORADO_MCP}?phrase=%23460556`);
    expect(ad.details).toMatchObject({ location: 'Gdańsk, Warszawa', workMode: 'hybrid' });
    expect(ad.details.posted).toMatch(/^2026-10-\d\d$/);
    expect(ad.details.remote).toBeUndefined();
    expect(ad.details.skills?.length).toBeGreaterThan(0);
    expect(ad.text).toMatch(/^What Eldorado lists about it/);
    expect(ad.text).toContain('Places: Gdańsk, Warszawa.');
    expect(ad.text.length).toBeGreaterThanOrEqual(80); // counts as an ad's text
  });

  it('its monthly figure in PLN, the contract named; fully remote when it may be done remotely', async () => {
    answer([
      {
        url: 'https://czyjesteldorado.pl/praca/461012-dev?utm_source=mcp',
        title: 'Dev',
        work_modes: ['remote', 'hybrid'],
        contract_types: ['b2b'],
        workload_types: ['full_time'],
        salary_from: 25200,
        salary_to: 31500,
      },
    ]);
    const ad = await readEldorado(offer('461012'));
    expect(ad.details).toMatchObject({ workMode: 'remote', remote: true, contract: 'B2B, full-time' });
    expect(ad.details.salary).toMatch(/^25\s200–31\s500 PLN \/ month/);
  });

  it('nothing when the search has no such job, or the id is not one of its', async () => {
    answer([{ url: 'https://czyjesteldorado.pl/praca/4610120-other' }]);
    expect(await readEldorado(offer('461012'))).toEqual({ text: '', details: {} });
    expect(await readEldorado(offer('abc'))).toEqual({ text: '', details: {} });
  });
});
