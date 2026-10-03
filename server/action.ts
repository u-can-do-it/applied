import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import * as z from 'zod/mini';
import { requireLogin } from './session';
import { message } from '@/lib/shared/errors';
import { fail, ok, type Result } from '@/lib/shared/result';

// Every server action is built here: it checks the login, then the input against its schema
// (the browser can send anything, whatever the TypeScript types say), and answers with a Result
// instead of throwing. A failure's message is what the user sees, so the schemas word theirs for
// the user, and the action throws an Error with a user-facing message for anything else.

type Options = {
  /** for the login itself: no login needed */
  public?: boolean;
};

/** A request the forms never send (a wrong type, a missing key) gets this; the schemas word the rest. */
const BAD_REQUEST = 'Bad request.';

async function run<S extends z.core.$ZodType, O>(
  schema: S,
  raw: unknown,
  fn: (input: z.output<S>) => Promise<O>,
  options: Options & { form?: boolean },
): Promise<Result<O>> {
  try {
    if (!options.public) await requireLogin();
    // a form's fields become an object only now: nothing is read from the request before the login check
    let input = raw;
    if (options.form) {
      if (!(raw instanceof FormData)) return fail(BAD_REQUEST);
      input = Object.fromEntries(raw);
    }
    const parsed = z.safeParse(schema, input, { error: () => BAD_REQUEST });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? BAD_REQUEST);
    return ok(await fn(parsed.data));
  } catch (error) {
    unstable_rethrow(error); // redirect() and the like are how Next.js answers, not failures
    return fail(message(error));
  }
}

/** A server action called with one value (an object, or nothing for `noInput`). */
export const action =
  <S extends z.core.$ZodType, O>(schema: S, fn: (input: z.output<S>) => Promise<O>, options: Options = {}) =>
  async (input: z.input<S>): Promise<Result<O>> =>
    run(schema, input, fn, options);

/** A server action for `<form action>` / useActionState: (previous answer, FormData); the fields become an object. */
export const formAction =
  <S extends z.core.$ZodType, O>(schema: S, fn: (input: z.output<S>) => Promise<O>, options: Options = {}) =>
  async (_previous: Result<O> | null, form: FormData): Promise<Result<O>> =>
    run(schema, form, fn, { ...options, form: true });
