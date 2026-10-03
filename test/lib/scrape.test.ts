import { describe, expect, it } from 'vitest';
import { htmlToText } from '@/lib/scrape';

describe('htmlToText', () => {
  it('paragraphs and line breaks become lines', () => {
    expect(htmlToText('<p>First</p><p>Second<br>third<br/>fourth</p>')).toBe('First\nSecond\nthird\nfourth');
    expect(htmlToText('<h2>About</h2><div>We build</div><div>things</div>')).toBe('About\nWe build\nthings');
  });

  it('list items become bullets, without blank lines between them', () => {
    // the end of the list (</li></ul>) leaves one blank line after it
    expect(htmlToText('<p>Requirements:</p><ul><li>React</li><li>TypeScript</li></ul><p>Nice</p>')).toBe(
      'Requirements:\n• React\n• TypeScript\n\nNice',
    );
    expect(htmlToText('<ul><li><p>React</p></li><li><p>Node</p></li></ul>')).toBe('• React\n• Node');
  });

  it('inline tags become spaces, whitespace collapses', () => {
    expect(htmlToText('<p>Use <b>React</b>,   <i>TS</i>\tand more</p>')).toBe('Use React , TS and more');
    expect(htmlToText('<span>a</span><span>b</span>')).toBe('a b');
  });

  it('at most one blank line in a row', () => {
    expect(htmlToText('a<br><br><br><br>b')).toBe('a\n\nb');
  });

  it('drops scripts and styles with their content', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Text</p><script>alert("x")</script>')).toBe('Text');
  });

  it('decodes entities, also when the HTML itself is escaped (as in JSON-LD)', () => {
    expect(htmlToText('Tom &amp; Jerry &ndash; &#8220;quoted&#8221; &#x41;&hellip;')).toBe('Tom & Jerry – “quoted” A…');
    expect(htmlToText('&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;li&gt;Node&lt;/li&gt;&lt;/ul&gt;')).toBe('• React\n• Node');
    expect(htmlToText('&unknown; stays')).toBe('&unknown; stays');
  });

  it('decodes before stripping tags, so in plain HTML an escaped "<" reads as a tag', () => {
    // inside escaped HTML (JSON-LD), text escaped twice comes out as the text it was
    expect(htmlToText('&lt;p&gt;Use &amp;lt;b&amp;gt; tags&lt;/p&gt;')).toBe('Use <b> tags');
    // in plain HTML the same "&lt;b&gt;" is lost, as is anything between a "<" and a ">"
    expect(htmlToText('<p>Use &lt;b&gt; tags</p>')).toBe('Use tags');
    // BUG? ordinary text with both signs loses everything between them
    expect(htmlToText('<p>Experience &lt; 2 years, team &gt; 5 people</p>')).toBe('Experience 5 people');
  });

  it('anything that is not a string', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(42)).toBe('42');
  });
});
