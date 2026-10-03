import { after } from 'next/server';
import { countPending, continueRun, latestRun, needsWorker, type AiRun } from '@/lib/ai/runs';
import { isPaused } from '@/lib/ai/run-view';
import { describeRange } from '@/lib/dates';
import { env } from '@/lib/env';
import { aiConfig } from '@/lib/ai/openai';
import { isUsable, listProfiles } from '@/lib/ai/profiles';
import { message } from '@/lib/shared/errors';
import { parseOfferQuery, type SearchParams } from '@/lib/shared/search-params';
import { appZone } from '@/lib/time-zone';
import { LoadError } from '@/components/load-error';
import { AiControls } from './ai-controls';

async function load(range: { days: string; from: string; to: string }) {
  const profiles = await listProfiles();
  const active = profiles.at(0) ?? null;
  let run: AiRun | null = null;
  let todayNew = 0;
  let rangeNew = 0;
  if (active && isUsable(active)) {
    const zone = await appZone();
    [run, todayNew, rangeNew] = await Promise.all([
      latestRun(active.id),
      countPending(active, zone.resolveRange({ days: '1' })),
      range.days === '1' ? Promise.resolve(-1) : countPending(active, zone.resolveRange(range)),
    ]);
    // an open run whose worker stopped (time limit, closed tab): continue it after this response
    const open = run;
    if (open && needsWorker(open)) after(() => continueRun(open.id));
  }
  return { profiles, active, run, todayNew, rangeNew };
}

// Server part of the AI tab's toolbar: profiles, the latest run and "how many are new".
export async function AiFilterBar({ searchParams }: { searchParams: SearchParams }) {
  const { days, from, to } = parseOfferQuery(await searchParams);

  // the data is loaded first: JSX built inside a try would not have its render errors caught there
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load({ days, from, to });
  } catch (error) {
    return <LoadError title="Can’t load the AI filter." detail={message(error)} />;
  }
  const { profiles, active, run, todayNew, rangeNew } = loaded;
  return (
    <AiControls
      profiles={profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        prompt: profile.prompt,
        fileName: profile.fileName,
        version: profile.version,
      }))}
      activeId={active?.id ?? null}
      run={
        run &&
        active && {
          id: run.id,
          label: run.label,
          status: run.status,
          phase: run.phase,
          lockUntil: run.lockUntil,
          pairsChecked: run.pairsChecked,
          merged: run.merged,
          total: run.total,
          done: run.done,
          error: run.error,
          finishedAt: run.finishedAt,
          createdAt: run.createdAt,
          // eslint-disable-next-line react-hooks/purity -- a server component renders once per request: "now" is that request's time
          paused: isPaused(run, Date.now()),
          profile: { name: active.name, version: run.version },
          stale: active.version !== run.version,
        }
      }
      todayNew={todayNew}
      range={
        days === '1'
          ? null
          : { days, from, to, label: describeRange({ days, from, to }) || 'all offers', newCount: rangeNew }
      }
      aiConfigured={Boolean(env.OPENAI_API_KEY)}
      models={aiConfig()}
    />
  );
}
