import 'server-only';
import { queueSize } from './scraping/store';
import { rest, restUrl } from './supabase';

// What the pages show that changes without you doing anything there: a scrape (its run, new
// offers), a Telegram command (mute, send). AutoRefresh asks for this once a minute and refreshes
// the page only when it differs. Your own changes refresh the page by themselves (server actions).

const latest = async (table: string, select: string, order?: string) => {
  const url = restUrl(table);
  url.searchParams.set('select', select);
  if (order) {
    url.searchParams.set('order', order);
    url.searchParams.set('limit', '1');
  }
  return ((await (await rest(url)).json()) as unknown[])[0] ?? null;
};

/** A fingerprint of that: equal = nothing new to show. */
export async function dataVersion(): Promise<string> {
  const parts = await Promise.all(
    [
      latest('scrape_state', 'last_run_at,locked_until,muted'),
      latest('scrape_runs', 'id,finished_at,added,matched,notified', 'started_at.desc'),
      latest('offers', 'first_seen', 'first_seen.desc'),
      queueSize(),
    ].map((p) => p.catch(() => null)),
  ); // a table that isn't there yet just doesn't count
  return JSON.stringify(parts);
}
