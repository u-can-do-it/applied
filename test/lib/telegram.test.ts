import { describe, expect, it } from 'vitest';
import type { Queued } from '@/lib/db/repos/notify-queue';
import { formatNotification, type Outgoing } from '@/lib/telegram';

let seq = 0;
const offer = (overrides: Partial<Outgoing> = {}): Outgoing => {
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
    jobId: null,
    ...overrides,
  };
};
const many = (count: number, overrides: Partial<Outgoing> = {}) =>
  Array.from({ length: count }, () => offer(overrides));
const notify = (input: Partial<Parameters<typeof formatNotification>[0]>) =>
  formatNotification({ matched: [], unmatched: [], unchecked: [], profile: null, held: false, link: null, ...input });
const text = (input: Partial<Parameters<typeof formatNotification>[0]>) => notify(input)?.text ?? '';

describe('formatNotification', () => {
  it('nothing new: no message', () => {
    expect(notify({})).toBeNull();
    expect(notify({ held: true })).toBeNull();
  });

  it('one offer: the count, the board heading, title, company · seniority · place, link', () => {
    const reactDev = offer({ title: 'React Dev', url: 'https://justjoin.it/job-offer/x' });
    expect(notify({ matched: [reactDev] })).toEqual({
      text: '🆕 1 new offer\n\n---------------------- justjoin ----------------------\n🆕 React Dev\nAcme · senior · Warszawa\nhttps://justjoin.it/job-offer/x',
      offers: [reactDev],
    });
  });

  it('where: remote, the place, or office; missing parts are left out', () => {
    const where = (overrides: Partial<Outgoing>) =>
      text({ matched: [offer({ title: 'T', url: 'u', ...overrides })] }).split('\n')[4];
    expect(where({ remote: true })).toBe('Acme · senior · zdalnie');
    expect(where({ location: null })).toBe('Acme · senior · stacjonarnie');
    expect(where({ company: null, seniority: null })).toBe('Warszawa');
  });

  it("the AI's score and summary (cut to 160 characters)", () => {
    expect(
      text({ matched: [offer({ title: 'T', url: 'u', verdict: { score: 87, summary: 'x'.repeat(200) } })] }),
    ).toContain(`\n✦ 87% · ${'x'.repeat(160)}\nu`);
    expect(text({ matched: [offer({ title: 'T', url: 'u', verdict: { score: 40, summary: null } })] })).toContain(
      '\n✦ 40%\nu',
    );
  });

  it('one message for the whole batch, one block per board in board order', () => {
    const jj = many(7, { src: 'justjoin' });
    const bd = many(2, { src: 'bulldog' });
    const message = notify({ matched: [...jj.slice(0, 3), ...bd, ...jj.slice(3)] });
    expect(message?.offers).toHaveLength(9);
    const blocks = message?.text.split('\n\n---------------------- ') ?? [];
    expect(blocks[0]).toBe('🆕 9 new offers');
    expect(blocks[1].startsWith('bulldog ----------------------\n')).toBe(true);
    expect(blocks[2].startsWith('justjoin ----------------------\n')).toBe(true);
    expect(blocks[2].split('\n\n')).toHaveLength(7);
  });

  it('what does not fit in a message is counted, with the link to the new offers; it all counts as sent', () => {
    const long = many(60, { verdict: { score: 90, summary: 'y'.repeat(160) } });
    const message = notify({ matched: long, more: 'https://app.test/?new=1' });
    expect(message?.text.length).toBeLessThanOrEqual(4096);
    const listed = (message?.text.match(/^🆕 Offer /gm) ?? []).length;
    expect(listed).toBeGreaterThan(5);
    expect(message?.text.endsWith(`\n\n+ ${60 - listed} more: https://app.test/?new=1`)).toBe(true);
    expect(message?.offers).toEqual(long);
  });

  it('offers the AI could not check come after the matches, with a warning', () => {
    const out = text({ matched: [offer()], unchecked: many(2, { src: 'nofluff' }), profile: 'P' });
    expect(out.startsWith('🆕 3 new offers, 1 matching “P”\n\n---------------------- justjoin')).toBe(true);
    expect(out).toContain('\n\n⚠ Not checked by the AI (it failed for a while):\n---------------------- nofluff');
  });

  it("the ones that didn't match: a line at the end", () => {
    const matched = [offer()];
    const unmatched: Queued[] = many(3);
    const message = notify({ matched, unmatched, profile: 'Frontend', link: 'https://app.test/ai' });
    expect(message?.text.startsWith('🆕 4 new offers, 1 matching “Frontend”')).toBe(true);
    expect(message?.text.endsWith("\n\n+ 3 new offers didn't match “Frontend”.")).toBe(true);
    // they count as sent with it
    expect(message?.offers).toEqual([...matched, ...unmatched]);
  });

  it("only ones that didn't match: just the count, with the link", () => {
    const unmatched: Queued[] = many(2);
    expect(notify({ unmatched, profile: 'Frontend', link: 'https://app.test/ai' })).toEqual({
      text: '🆕 2 new offers, none matched “Frontend”.\nhttps://app.test/ai',
      offers: unmatched,
    });
    expect(text({ unmatched, profile: 'Frontend' })).toBe('🆕 2 new offers, none matched “Frontend”.');
  });

  it('held while muted: said first', () => {
    const message = notify({
      matched: many(6),
      unmatched: many(1),
      unchecked: many(2, { src: 'zz' }),
      profile: 'P',
      held: true,
    });
    expect(message?.text.startsWith('📬 Held while muted.\n🆕 9 new offers, 6 matching “P”\n\n')).toBe(true);
    expect(message?.offers).toHaveLength(9);
    expect(text({ unmatched: many(1), profile: 'P', held: true })).toBe(
      '📬 Held while muted.\n🆕 1 new offer, none matched “P”.',
    );
  });
});
