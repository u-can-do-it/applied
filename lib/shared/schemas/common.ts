// Shared by the server and client components: building blocks of the action schemas.
import { z } from 'zod';

/** For an action that takes no input. */
export const noInput = z.void();

/** A string field as kept: trimmed and cut to `max` characters ('' when not sent). */
export const text = (max: number) =>
  z
    .string()
    .default('')
    .transform((value) => value.trim().slice(0, max));

/** A job's key (offers_unique.dup_key), the id of an application. */
export const jobKey = z.string().min(1);
