import 'server-only';
import { desc, eq, getTableColumns } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { aiProfiles, type AiProfileRow } from '../schema';

// AI profiles: what to look for (a prompt and an optional CV), versioned by lib/ai/profiles.ts.

/** A profile without its file's text (that can be long; only the AI calls need it). */
export type Profile = Omit<AiProfileRow, 'fileText' | 'createdAt'>;
export type ProfileWithFile = Omit<AiProfileRow, 'createdAt'>;

const { fileText: _fileText, createdAt: _createdAt, ...listColumns } = getTableColumns(aiProfiles);

/** Most recently used first: the first one is the active profile. */
export function list(): Promise<Profile[]> {
  return db().select(listColumns).from(aiProfiles).orderBy(desc(aiProfiles.lastUsedAt));
}

export async function get(id: string): Promise<ProfileWithFile | null> {
  return first(
    await db()
      .select({ ...listColumns, fileText: aiProfiles.fileText })
      .from(aiProfiles)
      .where(eq(aiProfiles.id, id)),
  );
}

export async function insert(row: Pick<AiProfileRow, 'name' | 'prompt' | 'fileName' | 'fileText' | 'lastUsedAt'>) {
  const [{ id }] = await db().insert(aiProfiles).values(row).returning({ id: aiProfiles.id });
  return id;
}

export async function patch(id: string, fields: Partial<Omit<AiProfileRow, 'id' | 'createdAt'>>) {
  await db().update(aiProfiles).set(fields).where(eq(aiProfiles.id, id));
}

/** With its runs and verdicts (on delete cascade). */
export async function remove(id: string) {
  await db().delete(aiProfiles).where(eq(aiProfiles.id, id));
}
