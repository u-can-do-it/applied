import { describe, expect, it } from 'vitest';
import { BOARD_RE, BOARDS, byHost, byId, SCRAPED_BOARDS } from '@/lib/boards';

// "(^|\.)justjoin\.it$" -> "justjoin.it"
const domainOf = (pattern: RegExp) =>
  pattern.source.match(/^\(\^\|\\\.\)((?:[a-z0-9-]+\\\.)+[a-z]+)\$$/)?.[1].replace(/\\\./g, '.');

describe('the board registry', () => {
  it('ids are unique and valid board ids', () => {
    const ids = BOARDS.map((board) => board.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(BOARD_RE.test(id), id).toBe(true);
    for (const board of BOARDS) expect(byId(board.id)).toBe(board);
  });

  it('every scraped board has a listing with seeds', () => {
    for (const board of SCRAPED_BOARDS) expect(board.listing.seeds.length, board.id).toBeGreaterThan(0);
  });

  it('hosts are "(^|\\.)domain$" patterns, and no two boards claim one host', () => {
    for (const board of BOARDS)
      for (const pattern of board.hosts) {
        const domain = domainOf(pattern);
        expect(domain, `${board.id}: ${pattern.source}`).toBeTruthy();
        // the domain, a subdomain and www. all lead to this board, and to no other
        for (const host of [`${domain}`, `jobs.${domain}`, `www.${domain}`]) {
          expect(byHost(host)?.id, host).toBe(board.id);
          expect(
            BOARDS.filter((other) => other.hosts.some((re) => re.test(host))),
            host,
          ).toHaveLength(1);
        }
      }
  });
});
