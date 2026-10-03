// Shared by the server and client components.
import { z } from 'zod';
import { DAY_PRESETS } from '../../sources';
import { text } from './common';

export const PROFILE_FILE_MAX = 5 * 1024 * 1024;

/** The AI profile form (FormData: the file is uploaded with it). */
export const profileSchema = z.object({
  profileId: z
    .string()
    .default('')
    .transform((id) => id || undefined),
  name: z
    .string()
    .default('')
    .transform((name) => name.slice(0, 80)),
  prompt: z
    .string()
    .default('')
    .transform((prompt) => prompt.slice(0, 4000)),
  // an empty file input still sends a File, of size 0
  file: z
    .instanceof(File)
    .optional()
    .transform((file) => (file?.size ? file : undefined))
    .refine((file) => !file || file.size <= PROFILE_FILE_MAX, 'The file is larger than 5 MB.'),
  removeFile: z
    .string()
    .optional()
    .transform((value) => value === 'on'),
});

export const profileIdSchema = z.object({ id: z.string().min(1) });

/** "Check …": a day preset, or a range (resolved in the app's time zone); neither = all offers. */
export const startRunSchema = z.object({
  profileId: z.string().min(1),
  days: text(20).transform((days) => (DAY_PRESETS.some((preset) => preset.days && preset.days === days) ? days : '')),
  from: text(10),
  to: text(10),
});
