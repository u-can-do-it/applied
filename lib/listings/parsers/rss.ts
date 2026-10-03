// The generic RSS / Atom parser: a feed's <item>s (RSS 2.0 and 1.0) or <entry>s (Atom), read with an
// XML parser (fast-xml-parser). Namespace prefixes are dropped (dc:creator is `creator`); entities
// are left to strip(), which decodes them in CDATA too, as feeds that put escaped HTML in a title
// expect.
import { XMLParser } from 'fast-xml-parser';
import { decodeEntities } from '../../shared/html';
import { isObj, sampleOf, strip, time, type Obj } from '../extract';
import type { Found, ListingParser } from '../types';

const OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  // values stay text: a guid "0012" is not the number 12
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name: string) => ['item', 'entry', 'category', 'link'].includes(name),
};
const parser = new XMLParser(OPTIONS);

/** Every <item> and <entry>, wherever the feed has them, in order. */
function itemsOf(node: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(node)) for (const child of node) itemsOf(child, out);
  else if (isObj(node))
    for (const [name, value] of Object.entries(node)) {
      if (name.startsWith('@_')) continue;
      if (name === 'item' || name === 'entry') out.push(...(value as unknown[]).filter(isObj));
      else itemsOf(value, out);
    }
  return out;
}

/** An element's text: its own, plus its children's (a title with tags in it), as one line. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return strip(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (!isObj(node)) return '';
  const parts = Object.entries(node)
    .filter(([name]) => !name.startsWith('@_'))
    .map(([, value]) => (Array.isArray(value) ? value.map(textOf).join(' ') : textOf(value)));
  return strip(parts.join(' '));
}

const attr = (node: unknown, name: string): string => {
  const value = isObj(node) ? node[`@_${name}`] : undefined;
  return typeof value === 'string' ? value : '';
};

/** RSS: <link>text</link>. Atom: <link href> (the "alternate" one, else the first). */
function linkOf(item: Obj): string {
  const links = (item.link as unknown[] | undefined) ?? [];
  const text = links.map(textOf).find(Boolean);
  if (text) return text;
  const alternate = links.find((link) => ['', 'alternate'].includes(attr(link, 'rel'))) ?? links[0];
  return decodeEntities(attr(alternate, 'href')).trim();
}

const absolute = (link: string, base: string) => {
  try {
    return link ? new URL(link, base).toString() : '';
  } catch {
    return '';
  }
};

export const parseRss: ListingParser = (body, { src, url }) => {
  let feed: unknown;
  try {
    feed = parser.parse(body);
  } catch (error) {
    throw new Error(`The feed isn't XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const items = itemsOf(feed);
  if (!items.length) throw new Error('No <item> or <entry> in the feed');
  return {
    total: items.length,
    sample: sampleOf(items[0]), // as the parser read it
    items: items.map((item): Found => {
      const link = absolute(linkOf(item), url);
      const author =
        textOf(item.creator) || textOf(isObj(item.author) ? item.author.name : undefined) || textOf(item.author);
      const title = textOf(item.title);
      return {
        src,
        id: textOf(item.guid) || textOf(item.id) || link,
        title,
        company: author || null,
        seniority: null,
        remote: /remote|zdaln/i.test(title),
        url: link,
        locations: [],
        // RSS: <category>React</category>; Atom: <category term="React"/>
        skills: ((item.category as unknown[] | undefined) ?? [])
          .map((category) => textOf(category) || strip(attr(category, 'term')))
          .filter(Boolean),
        sort: time(textOf(item.pubDate) || textOf(item.published) || textOf(item.updated) || textOf(item.date)),
      };
    }),
  };
};
