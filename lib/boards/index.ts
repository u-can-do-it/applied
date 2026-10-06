// The job boards Jobwatch knows, one file each (how to add one: CONTRIBUTING.md), and what is read
// from a job link with them. Shared by the server and the browser: only what a board is, no parsers
// (lib/listings/parsers/) and no ad readers (lib/ads/).
// The `.ts` in the imports: scripts/db-migrate.ts seeds the boards' scrapers from this in plain Node.
import { adzuna } from './adzuna.ts';
import { builtin } from './builtin.ts';
import { bulldog } from './bulldog.ts';
import { eldorado } from './eldorado.ts';
import { himalayas } from './himalayas.ts';
import { indeed } from './indeed.ts';
import { justjoin } from './justjoin.ts';
import { linkedin } from './linkedin.ts';
import { BOARD_RE, bareHost, isLink, parseLink, siteName, withoutQuery, withoutTracking } from './links.ts';
import { nofluff } from './nofluff.ts';
import { olx } from './olx.ts';
import { pracuj } from './pracuj.ts';
import { rocketjobs } from './rocketjobs.ts';
import { solidjobs } from './solidjobs.ts';
import { theprotocol } from './theprotocol.ts';

export { BOARD_RE, isLink };

/**
 * The boards Jobwatch scrapes, each a scraper kind too. A new one goes at the end: this order is the
 * Settings list's, and the database's list of kinds (scrapers_kind_check in lib/db/schema.ts).
 */
export const SCRAPED_BOARDS = [
  justjoin,
  nofluff,
  solidjobs,
  bulldog,
  eldorado,
  builtin,
  linkedin,
  adzuna,
  himalayas,
] as const;
export type ScrapedBoardId = (typeof SCRAPED_BOARDS)[number]['id'];

/** Every board: the scraped ones, then the ones known by their links only (an application's link). */
export const BOARDS = [...SCRAPED_BOARDS, theprotocol, pracuj, rocketjobs, indeed, olx] as const;
export type BoardId = (typeof BOARDS)[number]['id'];
type KnownBoard = (typeof BOARDS)[number];

export const byId = (id: string): KnownBoard | undefined => BOARDS.find((board) => board.id === id);

/** The board on this host ("www." and case don't matter). */
export function byHost(host: string): KnownBoard | undefined {
  const bare = host.toLowerCase().replace(/^www\./, '');
  return BOARDS.find((board) => board.hosts.some((pattern) => pattern.test(bare)));
}

/** suggestions for an application's board field; any lowercase id works */
export const BOARD_SUGGESTIONS = [...BOARDS.map((board) => board.id), 'facebook', 'email', 'referral', 'unknown'];

/** The board a link is on (justjoin, nofluff, …); other sites by their name (job-boards.greenhouse.io -> greenhouse). */
export function boardOf(link: string): string {
  const url = parseLink(link);
  if (!url) return 'unknown';
  const host = bareHost(url);
  const board = byHost(host) ?? BOARDS.find((known) => known.tagsLinks?.test(url.search));
  return board?.id ?? siteName(host);
}

/** The link without tracking: a board's own links need no query at all (unless the board says otherwise), others lose utm_* and the like. */
export function cleanLink(link: string): string {
  const url = parseLink(link);
  if (!url) return link.trim();
  const board = byId(boardOf(url.toString()));
  if (!board) return withoutTracking(url);
  return board.cleanLink ? board.cleanLink(url) : withoutQuery(url).toString();
}

/** The offer's id on its board, when the link shows it: what its ad reader and pages know it by. */
export function boardIdOf(board: string, link: string): string | null {
  const url = parseLink(link);
  return (url && byId(board)?.idFromLink?.(url)) ?? null;
}

/** The id a scraped offer from this link is saved under (offers.id), when the link shows it. */
export function offerIdOf(board: string, link: string): string | null {
  return byId(board)?.linkIdIsOfferId === false ? null : boardIdOf(board, link);
}
