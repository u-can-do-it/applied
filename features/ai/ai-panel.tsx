import { countPending } from '@/lib/ai/runs';
import { describeRange } from '@/lib/dates';
import { env } from '@/lib/env';
import { aiConfig } from '@/lib/ai/openai';
import { isUsable, listProfiles } from '@/lib/ai/profiles';
import { message } from '@/lib/shared/errors';
import { appZone } from '@/lib/time-zone';
import { LoadError } from '@/components/load-error';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PANEL, PANEL_TITLE, SMALL } from '@/features/scraping/panel-styles';
import { AiControls } from './ai-controls';
import { activeRun } from './run-info';

/** What "Check …" offers: the date ranges a run can take, as the offers' date filter has them. */
const RANGES = [{ days: '1' }, { days: '7' }, { days: '' }] as const;

async function load() {
  const profiles = await listProfiles();
  const active = profiles.at(0) ?? null;
  let run: Awaited<ReturnType<typeof activeRun>> = null;
  let pending: number[] = RANGES.map(() => 0);
  if (active && isUsable(active)) {
    const zone = await appZone();
    [run, ...pending] = await Promise.all([
      activeRun(active),
      ...RANGES.map((range) => countPending(active, zone.resolveRange(range))),
    ]);
  }
  return { profiles, active, run, pending };
}

/**
 * Settings → AI filter: the profiles (the active one judges every new offer, and is the offers'
 * fit badge and ?fit= filter), and runs that check older offers, with the latest one's progress.
 */
export async function AiPanel() {
  // the data is loaded first: JSX built inside a try would not have its render errors caught there
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load();
  } catch (error) {
    return <LoadError title="Can’t load the AI filter." detail={message(error)} />;
  }
  const { profiles, active, run, pending } = loaded;
  return (
    <Card id="ai-filter" className={`${PANEL} scroll-mt-4`} role="region" aria-labelledby="ai-filter-h">
      <CardHeader className="px-4">
        <h2 id="ai-filter-h" className={PANEL_TITLE}>
          AI filter
        </h2>
        <p className={`${SMALL} m-0 text-muted-foreground`}>
          The active profile judges every new offer after a scrape (while “Only offers the AI profile matches” is on
          under Notifications): the offers show its fit, and filter by it. Check the older ones here.
        </p>
      </CardHeader>
      <CardContent className="px-4">
        <AiControls
          // a new run, or one that ended, starts it afresh: its polled state is this one's
          key={run ? `${run.id}:${run.status}` : 'none'}
          profiles={profiles.map((profile) => ({
            id: profile.id,
            name: profile.name,
            prompt: profile.prompt,
            fileName: profile.fileName,
            version: profile.version,
          }))}
          activeId={active?.id ?? null}
          run={run}
          ranges={RANGES.map((range, i) => ({
            days: range.days,
            label: describeRange(range) || 'all offers',
            newCount: pending[i] ?? 0,
          }))}
          aiConfigured={Boolean(env.OPENAI_API_KEY)}
          models={aiConfig()}
        />
      </CardContent>
    </Card>
  );
}
