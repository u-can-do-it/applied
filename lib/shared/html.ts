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
const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;
// comments and <?xml …?> go first: a "<" or ">" inside them would cut the tag pass short
const dropComments = (text: string) => text.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, ' ');
// HTML that marks its own lines: there, a line break in the source is a space, as a browser shows it
// ("<li>\n<p>Text" is "• Text", not a bullet on a line of its own); text without them keeps its lines
const LINE_TAG = /<(p|br|li|div|h\d|ul|ol|tr)\b[^<>]*>/i;

/** HTML (possibly entity-escaped, as inside JSON-LD) -> readable plain text with line breaks and bullets */
export function htmlToText(html: unknown): string {
  // untyped JSON from a board (a string, a number…) printed the way String() prints it
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the value is untyped JSON; String() is the conversion we want
  let text = dropComments(String(html ?? ''));
  // at least as many escaped tags as real ones (JSON-LD): HTML escaped as text, decoded first
  // ("&lt;li&gt;" -> "<li>"); otherwise an escaped tag is text ("knowledge of &lt;canvas&gt;"),
  // decoded after the tags go
  const escaped = count(text, ESCAPED_TAG);
  if (escaped && escaped >= count(text, TAG)) text = dropComments(decodeEntities(text));
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  if (LINE_TAG.test(text)) text = text.replace(/\s+/g, ' ');
  text = text
    .replace(/<li[^>]*>/gi, '\n• ')
    // paragraphs, headings and lists stand apart by a blank line, as on the board's page; a line
    // break, a <div> or a table row is one line
    .replace(/<(h\d|\/p|\/h\d|\/ul|\/ol)\b[^>]*>/gi, '\n\n')
    .replace(/<(br|\/div|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(TAG, ' ');
  return (
    decodeEntities(text)
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // no blank line between bullets (<li><p>…</p></li>), nor before a list's first: it follows the
      // line that introduces it
      .replace(/\n{2,}(?=• )/g, '\n')
      .trim()
  );
}
