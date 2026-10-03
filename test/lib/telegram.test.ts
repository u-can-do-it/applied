import { describe, expect, it } from 'vitest';
import type { Queued } from '@/lib/scraping/store';
import { formatNotification, type Outgoing } from '@/lib/telegram';

let seq = 0;
const offer = (o: Partial<Outgoing> = {}): Outgoing => {
  seq++;
  return {
    src: 'justjoin',
    id: `id-${seq}`,
    title: `Offer ${seq}`,
    company: 'Acme',
    seniority: 'senior',
    remote: false,
    location: 'Warszawa',
    url: `https://x.test/${seq}`,
    dup_key: null,
    ...o,
  };
};
const many = (count: number, o: Partial<Outgoing> = {}) => Array.from({ length: count }, () => offer(o));
const notify = (input: Partial<Parameters<typeof formatNotification>[0]>) =>
  formatNotification({ matched: [], unmatched: [], unchecked: [], profile: null, held: false, link: null, ...input });

describe('formatNotification', () => {
  it('nothing new: no messages', () => {
    expect(notify({})).toEqual([]);
    expect(notify({ held: true })).toEqual([]);
  });

  it('one offer: the board heading, title, company · seniority · place, link', () => {
    const o = offer({ title: 'React Dev', url: 'https://justjoin.it/job-offer/x' });
    expect(notify({ matched: [o] })).toEqual([
      {
        text: '---------------------- justjoin ----------------------\n🆕 React Dev\nAcme · senior · Warszawa\nhttps://justjoin.it/job-offer/x',
        offers: [o],
      },
    ]);
  });

  it('where: remote, the place, or office; missing parts are left out', () => {
    const text = (o: Partial<Outgoing>) => notify({ matched: [offer({ title: 'T', url: 'u', ...o })] })[0].text.split('\n').slice(2, 3)[0];
    expect(text({ remote: true })).toBe('Acme · senior · zdalnie');
    expect(text({ location: null })).toBe('Acme · senior · stacjonarnie');
    expect(text({ company: null, seniority: null })).toBe('Warszawa');
  });

  it("the AI's score and summary (cut to 160 characters)", () => {
    const [m] = notify({ matched: [offer({ title: 'T', url: 'u', verdict: { score: 87, summary: 'x'.repeat(200) } })] });
    expect(m.text).toContain(`\n✦ 87% · ${'x'.repeat(160)}\nu`);
    const [bare] = notify({ matched: [offer({ title: 'T', url: 'u', verdict: { score: 40, summary: null } })] });
    expect(bare.text).toContain('\n✦ 40%\nu');
  });

  it('five offers per message, one block per board in board order', () => {
    const jj = many(7, { src: 'justjoin' });
    const bd = many(2, { src: 'bulldog' });
    const out = notify({ matched: [...jj.slice(0, 3), ...bd, ...jj.slice(3)] });
    expect(out.map((m) => m.offers.length)).toEqual([2, 5, 2]);
    expect(out[0].offers).toEqual(bd);
    expect(out[1].offers).toEqual(jj.slice(0, 5));
    expect(out[2].offers).toEqual(jj.slice(5));
    // the heading only on a board's first message
    expect(out[0].text.startsWith('---------------------- bulldog ----------------------\n')).toBe(true);
    expect(out[1].text.startsWith('---------------------- justjoin ----------------------\n')).toBe(true);
    expect(out[2].text.startsWith('🆕 ')).toBe(true);
    // offers in a message are separated by a blank line
    expect(out[1].text.split('\n\n')).toHaveLength(5);
  });

  it('exactly five: one message', () => {
    expect(notify({ matched: many(5) })).toHaveLength(1);
    expect(notify({ matched: many(6) })).toHaveLength(2);
  });

  it('offers the AI could not check come after the matches, with a warning', () => {
    const matched = [offer()];
    const unchecked = many(2, { src: 'nofluff' });
    const out = notify({ matched, unchecked });
    expect(out).toHaveLength(2);
    expect(out[1].offers).toEqual(unchecked);
    expect(out[1].text.startsWith('⚠ Not checked by the AI (it failed for a while):\n---------------------- nofluff')).toBe(true);
  });

  it("the ones that didn't match: a line under the last message", () => {
    const matched = [offer()];
    const unmatched: Queued[] = many(3);
    const out = notify({ matched, unmatched, profile: 'Frontend', link: 'https://app.test/ai' });
    expect(out).toHaveLength(1);
    expect(out[0].text.endsWith('\n\n+ 3 new offer(s) didn\'t match “Frontend”.')).toBe(true);
    // they count as sent with that message
    expect(out[0].offers).toEqual([...matched, ...unmatched]);
  });

  it("only ones that didn't match: a message of their own, with the link", () => {
    const unmatched: Queued[] = many(2);
    expect(notify({ unmatched, profile: 'Frontend', link: 'https://app.test/ai' })).toEqual([
      { text: '🆕 2 new offer(s), none matched “Frontend”.\nhttps://app.test/ai', offers: unmatched },
    ]);
    expect(notify({ unmatched, profile: 'Frontend' })[0].text).toBe('🆕 2 new offer(s), none matched “Frontend”.');
  });

  it('held while muted: a first message with the total', () => {
    const out = notify({ matched: many(6), unmatched: many(1), unchecked: many(2, { src: 'zz' }), profile: 'P', held: true });
    expect(out[0]).toEqual({ text: '📬 9 offer(s) held while muted', offers: [] });
    expect(out).toHaveLength(4); // the heading, 6 matched in two, 2 unchecked (+ the unmatched line)
  });
});
