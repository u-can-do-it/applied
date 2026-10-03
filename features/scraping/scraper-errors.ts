import * as z from 'zod/mini';
import { scraperSchema } from '@/lib/shared/schemas/scrapers';
import { toForm, type Draft } from './scraper-draft';

/**
 * The editor's values checked with the action's schema (as Save and Test send them): each problem at
 * the field it's about (the schema's `config.url` is the editor's `url`), one without a field for the form.
 */
export function scraperErrors(draft: Draft) {
  const parsed = z.safeParse(scraperSchema, toForm(draft));
  if (parsed.success) return undefined;
  const fields: Record<string, string> = {};
  let form: string | undefined;
  for (const issue of parsed.error.issues) {
    const path = issue.path
      .map(String)
      .filter((key, i) => !(i === 0 && key === 'config'))
      .join('.');
    if (!path) form ??= issue.message;
    else fields[path] ??= issue.message;
  }
  return { form, fields };
}
