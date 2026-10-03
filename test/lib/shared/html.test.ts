import { describe, expect, it } from 'vitest';
import { htmlToText } from '@/lib/shared/html';

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
    expect(htmlToText('&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;li&gt;Node&lt;/li&gt;&lt;/ul&gt;')).toBe(
      '• React\n• Node',
    );
    expect(htmlToText('&unknown; stays')).toBe('&unknown; stays');
  });

  it('strips tags before decoding, so an escaped "<" in the text stays text', () => {
    // inside escaped HTML (JSON-LD), text escaped twice comes out as the text it was
    expect(htmlToText('&lt;p&gt;Use &amp;lt;b&amp;gt; tags&lt;/p&gt;')).toBe('Use <b> tags');
    // in plain HTML the same "&lt;b&gt;" is the text "<b>"
    expect(htmlToText('<p>Use &lt;b&gt; tags</p>')).toBe('Use <b> tags');
    expect(htmlToText('<p>Experience &lt; 2 years, team &gt; 5 people</p>')).toBe(
      'Experience < 2 years, team > 5 people',
    );
    // without any tag, "&lt;" and "&gt;" around plain words are not escaped HTML either
    expect(htmlToText('Experience &lt; 2 years, team &gt; 5 people')).toBe('Experience < 2 years, team > 5 people');
    expect(htmlToText('a &lt;&gt; b')).toBe('a <> b');
    // a tag named in plain HTML stays
    expect(htmlToText('<p>Knowledge of &lt;canvas&gt; and WebGL</p>')).toBe('Knowledge of <canvas> and WebGL');
  });

  it('in escaped HTML, the signs in its text stay too', () => {
    expect(htmlToText('&lt;p&gt;Experience &lt; 2 years, team &gt; 5 people&lt;/p&gt;')).toBe(
      'Experience < 2 years, team > 5 people',
    );
  });

  it('a bare "<" or ">" is text, not a tag', () => {
    expect(htmlToText('<p>a < b and c > d</p>')).toBe('a < b and c > d');
    expect(htmlToText('<p>salary > 20k, 3<5</p>')).toBe('salary > 20k, 3<5');
  });

  it('mostly escaped HTML with a real tag in it is read as escaped HTML', () => {
    expect(htmlToText('&lt;p&gt;Hello&lt;/p&gt;<br>World')).toBe('Hello\n\nWorld');
    // as many escaped tags as real ones too
    expect(htmlToText('<div>&lt;p&gt;Hello&lt;/p&gt;</div>')).toBe('Hello');
    expect(htmlToText('&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;/ul&gt;<br>')).toBe('• React');
  });

  it('drops comments and <?…?>, also with "<" or ">" inside', () => {
    expect(htmlToText('<p>a<!-- note <b>x</b> -->b</p>')).toBe('a b');
    expect(htmlToText('<p>a</p><!-- x < y --><p>b</p>')).toBe('a\nb');
    expect(htmlToText('<?xml version="1.0" encoding="UTF-8"?><p>Text</p>')).toBe('Text');
    expect(htmlToText('&lt;!-- x &lt; y --&gt;&lt;p&gt;Text&lt;/p&gt;')).toBe('Text');
  });

  it('anything that is not a string', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(42)).toBe('42');
  });
});
