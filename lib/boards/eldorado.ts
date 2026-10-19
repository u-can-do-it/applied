// czyjesteldorado.pl: its listing: its MCP server's search (lib/listings/eldorado-mcp.ts, read by
// lib/listings/parsers/eldorado.ts); its ads: the page's JobPosting.
import { pathOf } from './links.ts';
import type { ScrapedBoard } from './types.ts';

export const eldorado: ScrapedBoard<'eldorado'> = {
  id: 'eldorado',
  label: 'Eldorado',
  hosts: [/(^|\.)czyjesteldorado\.pl$/],
  // an employer's page opened from Eldorado counts as Eldorado
  tagsLinks: /czyjesteldorado/i,
  aggregator: true,
  // its pages answer any datacenter with Cloudflare's challenge, ScrapingAnt's proxies included (since mid-October
  // 2026; a residential proxy at 25 credits a page got through): its search goes to its MCP server instead, and its
  // ads stay out of reach
  alwaysInFilters: true,
  idFromLink: (url) => pathOf(url).match(/\/praca\/(\d+)/)?.[1] ?? null,
  listing: {
    label: 'Eldorado search (MCP)',
    hint:
      'Eldorado’s own MCP server (its search_jobs tool, a beta), the newest 50 jobs of a search. The link’s query is ' +
      'the search: phrase= (quotes for an exact word, -word to leave one out), sortOrder=newest, and optionally ' +
      'workModes=remote,hybrid,office, seniority=junior,mid,senior, contractTypes=b2b,employment_contract, ' +
      'postedWithin=24h|3d|7d, minSalary= (PLN). Its ads can’t be read (Cloudflare), so the AI filter sees the title, ' +
      'skills and places only.',
    defaults: {
      url: 'https://czyjesteldorado.pl/_mcp?phrase={keyword}&sortOrder=newest',
      checkKeyword: true,
      checkLocation: true,
    },
    seeds: [{ name: 'Eldorado' }],
  },
};
