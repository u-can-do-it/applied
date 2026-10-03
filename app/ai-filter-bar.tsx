import { after } from 'next/server';
import { countPending, continueRun, latestRun, needsWorker, type Run } from '@/lib/ai-runs';
import { describeRange } from '@/lib/dates';
import { env } from '@/lib/env';
import { aiConfig } from '@/lib/openai';
import { isUsable, listProfiles } from '@/lib/profiles';
import { message } from '@/lib/shared/errors';
import { parseOfferQuery, type SearchParams } from '@/lib/shared/search-params';
import { appZone } from '@/lib/time-zone';
import { AiControls } from './ai-controls';

async function load(range: { days: string; from: string; to: string }) {
  const profiles = await listProfiles();
  const active = profiles.at(0) ?? null;
  let run: Run | null = null;
  let todayNew = 0;
  let rangeNew = 0;
  if (active && isUsable(active)) {
    const z = await appZone();
    [run, todayNew, rangeNew] = await Promise.all([
      latestRun(active.id),
      countPending(active, z.resolveRange({ days: '1' })),
      range.days === '1' ? Promise.resolve(-1) : countPending(active, z.resolveRange(range)),
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
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load the AI filter.</strong>
        <code>{message(e)}</code>
      </div>
    );
  }
  const { profiles, active, run, todayNew, rangeNew } = loaded;
  return (
    <AiControls
      profiles={profiles.map((p) => ({
        id: p.id,
        name: p.name,
        prompt: p.prompt,
        fileName: p.fileName,
        version: p.version,
      }))}
      activeId={active?.id ?? null}
      run={
        run && {
          id: run.id,
          label: run.label,
          status: run.status,
          phase: run.phase,
          pairsChecked: run.pairsChecked,
          merged: run.merged,
          total: run.total,
          done: run.done,
          error: run.error,
          finishedAt: run.finishedAt,
          stale: active?.version !== run.version,
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
