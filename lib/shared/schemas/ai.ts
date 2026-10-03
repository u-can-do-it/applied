// Shared by the server and client components.
import * as z from 'zod/mini';
import { DAY_PRESETS } from '../search-params';
import { string, text } from './common';

export const PROFILE_FILE_MAX = 5 * 1024 * 1024;

/** The AI profile form (FormData: the file is uploaded with it). */
export const profileSchema = z.object({
  profileId: z.pipe(
    string(),
    z.transform((id: string) => id || undefined),
  ),
  name: z
    .pipe(
      string(),
      z.transform((name: string) => name.slice(0, 80)),
    )
    .check(z.refine((name) => name.trim() !== '', 'Give the profile a name.')),
  prompt: z.pipe(
    string(),
    z.transform((prompt: string) => prompt.slice(0, 4000)),
  ),
  // an empty file input still sends a File, of size 0
  file: z
    .pipe(
      z.optional(z.instanceof(File)),
      z.transform((file: File | undefined) => (file?.size ? file : undefined)),
    )
    .check(z.refine((file) => !file || file.size <= PROFILE_FILE_MAX, 'The file is larger than 5 MB.')),
  removeFile: z.pipe(
    z.optional(z.string()),
    z.transform((value: string | undefined) => value === 'on'),
  ),
});

export const profileIdSchema = z.object({ id: z.string().check(z.minLength(1)) });

/** "Check …": a day preset, or a range (resolved in the app's time zone); neither = all offers. */
export const startRunSchema = z.object({
  profileId: z.string().check(z.minLength(1)),
  days: z.pipe(
    text(20),
    z.transform((days: string) => (DAY_PRESETS.some((preset) => preset.days && preset.days === days) ? days : '')),
  ),
  from: text(10),
  to: text(10),
});
