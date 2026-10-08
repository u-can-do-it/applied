// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Marked } from '@/components/marked';

afterEach(cleanup);

describe('Marked', () => {
  it('marks the matched parts, the rest as it is', () => {
    const { container } = render(<Marked text="Senior React Developer" marks={[0, 6, 7, 12]} />);
    expect(container.textContent).toBe('Senior React Developer');
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Senior', 'React']);
  });

  it('no marks: just the text', () => {
    const { container } = render(<Marked text="Developer" />);
    expect(container.innerHTML).toBe('Developer');
  });
});
