// Shared by the server and client components.

const ENTITIES: Partial<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
};

/** "&amp;", "&#8211;", "&#x2013;" -> the character; a named entity it doesn't know stays as it is */
export const decodeEntities = (html: string) =>
  html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity);

// a real tag starts with a letter, "/" or "!": in "a < b and c > d" the signs are text
const TAG = /<\/?[a-z!][^<>]*>/gi;
const ESCAPED_TAG = /&lt;\/?[a-z!][^<>]*?&gt;/gi;
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
// comments and <?xml …?> go first: a "<" or ">" inside them would cut the tag pass short
const dropComments = (s: string) => s.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, ' ');

/** HTML (possibly entity-escaped, as inside JSON-LD) -> readable plain text with line breaks and bullets */
export function htmlToText(html: unknown): string {
  // untyped JSON from a board (a string, a number…) printed the way String() prints it
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the value is untyped JSON; String() is the conversion we want
  let s = dropComments(String(html ?? ''));
  // at least as many escaped tags as real ones (JSON-LD): HTML escaped as text, decoded first
  // ("&lt;li&gt;" -> "<li>"); otherwise an escaped tag is text ("knowledge of &lt;canvas&gt;"),
  // decoded after the tags go
  const escaped = count(s, ESCAPED_TAG);
  if (escaped && escaped >= count(s, TAG)) s = dropComments(decodeEntities(s));
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
    .replace(TAG, ' ');
  return decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n{2,}(?=• )/g, '\n') // <li><p>…</p></li> would leave a blank line between bullets
    .trim();
}
