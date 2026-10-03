import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { message } from '@/lib/shared/errors';

describe('message', () => {
  it("is an Error's message, or anything else as a string", () => {
    expect(message(new Error('Wrong password.'))).toBe('Wrong password.');
    expect(message('plain')).toBe('plain');
    expect(message(42)).toBe('42');
  });

  it("tells a failed query's cause, never its SQL or values", () => {
    const cause = new Error('relation "public.offers" does not exist');
    const failed = new DrizzleQueryError('select public.jw_cron_connect($1, $2)', ['https://x', 'the-secret'], cause);
    expect(failed.message).toContain('the-secret'); // what drizzle-orm says
    expect(message(failed)).toBe('relation "public.offers" does not exist');
    // the same shape without drizzle-orm's class, and a cause that isn't an Error
    expect(message(new Error('Failed query: update x set note = $1\nparams: my note', { cause: 'odd' }))).toBe(
      'The database query failed.',
    );
    // wrapped twice
    expect(message(new Error('Failed query: select 1\nparams: ', { cause: failed }))).toBe(cause.message);
  });
});
