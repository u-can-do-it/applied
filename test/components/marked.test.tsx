// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Marked } from '@/components/marked';

afterEach(cleanup);

describe('Marked', () => {
  const marked = (container: HTMLElement) => [...container.querySelectorAll('mark')].map((mark) => mark.textContent);

  it('marks the matched parts, the rest as it is', () => {
    const { container } = render(<Marked text="Senior React Developer" marks={[0, 6, 13, 22]} />);
    expect(container.textContent).toBe('Senior React Developer');
    expect(marked(container)).toEqual(['Senior', 'Developer']);
  });

  it('matches with only white space between them: one mark, the space in it', () => {
    const text = 'PRETIUS SOFTWARE SP. Z O.O. – Kraków';
    const { container } = render(<Marked text={text} marks={[0, 7, 8, 16, 17, 20, 21, 22, 23, 27, 30, 36]} />);
    expect(container.textContent).toBe(text);
    expect(marked(container)).toEqual(['PRETIUS SOFTWARE SP. Z O.O.', 'Kraków']);
  });

  it('tight: no room around a mark (the text where it would be)', () => {
    const { container } = render(<Marked text="Senior React" marks={[7, 12]} tight />);
    expect(container.querySelector('mark')?.className).not.toContain('px-');
  });

  it('no marks: just the text', () => {
    const { container } = render(<Marked text="Developer" />);
    expect(container.innerHTML).toBe('Developer');
  });
});
