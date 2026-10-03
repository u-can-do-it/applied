import 'server-only';
import { sql } from 'drizzle-orm';
import type { ScrapeSettings } from '../../scraping/kinds';
import { storedSettingsSchema } from '../../shared/schemas/settings';
import { db } from '../client';
import { first } from '../rows';
import { scrapeSettings } from '../schema';

// The scraping settings: one row, its settings as JSON. Read through the schema, so a field this
// version doesn't know, or one missing, gets its default.

export async function get(): Promise<ScrapeSettings> {
  const row = first(await db().select({ settings: scrapeSettings.settings }).from(scrapeSettings).limit(1));
  return storedSettingsSchema.parse(row?.settings);
}

export async function save(settings: ScrapeSettings) {
  await db()
    .insert(scrapeSettings)
    .values({ id: true, settings, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: scrapeSettings.id,
      set: { settings: sql`excluded.settings`, updatedAt: sql`excluded.updated_at` },
    });
}
