// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimeZone } from '@/components/time-zone';
import { AdText } from '@/features/applications/ad-text';

afterEach(cleanup);

const show = (content: string) =>
  render(
    <TimeZone tz="Europe/Warsaw">
      <AdText ad={{ content, contentStatus: 'ok', contentError: null, scrapedAt: null }} loadError={null} />
    </TimeZone>,
  );

describe('AdText', () => {
  it('a bullet is a line of its own, its text beside the "•"', () => {
    show('Requirements:\n• React\n• Node');
    const bullet = screen.getByText('React');
    expect(bullet.textContent).toBe('• React');
    expect(screen.getByText('Requirements:').tagName).toBe('DIV');
  });

  it('a text saved with its "•" on a line of its own shows it with the bullet text', () => {
    const { container } = show('Apply\n\nHere is why:\n\n•\nYou build things.\n\n•\nYou ship them.');
    // the box's lines
    const lines = [...(container.firstElementChild?.children ?? [])].map((line) => line.textContent);
    expect(lines).toEqual(['Apply', '', 'Here is why:', '• You build things.', '• You ship them.']);
  });
});
