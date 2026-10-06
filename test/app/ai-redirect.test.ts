import { expect, it } from 'vitest';
import config from '@/next.config';

it('/ai, the AI filter tab that was, lands on the offers it showed: the matches, or ?rejected=1 the rejected', async () => {
  const redirects = (await config.redirects?.()) ?? [];
  const to = (query: Record<string, string>) =>
    redirects.find(
      (redirect) =>
        redirect.source === '/ai' &&
        (redirect.has ?? []).every((has) => has.type === 'query' && query[has.key] === has.value),
    )?.destination;
  expect(to({ days: '1', rejected: '1' })).toBe('/?fit=rejected'); // a Telegram message links there
  expect(to({ days: '7' })).toBe('/?fit=match');
});
