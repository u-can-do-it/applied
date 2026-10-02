import { after } from 'next/server';
import { countPending, continueRun, latestRun, needsWorker } from '@/lib/ai-runs';
import { describeRange, resolveRange, validDay } from '@/lib/dates';
import { aiConfig } from '@/lib/openai';
import { isUsable, listProfiles } from '@/lib/profiles';
import { DAY_PRESETS } from '@/lib/sources';
import { AiControls } from './ai-controls';
import type { SearchParams } from './offers-view';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// Server part of the AI tab's toolbar: profiles, the latest run and "how many are new".
export async function AiFilterBar({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const days = DAY_PRESETS.some((p) => p.days && p.days === one(sp.days)) ? one(sp.days) : '';
  const from = days ? '' : validDay(one(sp.from));
  const to = days ? '' : validDay(one(sp.to));

  try {
    const profiles = await listProfiles();
    const active = profiles[0] ?? null;
    let run = null;
    let todayNew = 0;
    let rangeNew = 0;
    if (active && isUsable(active)) {
      [run, todayNew, rangeNew] = await Promise.all([
        latestRun(active.id),
        countPending(active, resolveRange({ days: '1' })),
        days === '1' ? Promise.resolve(-1) : countPending(active, resolveRange({ days, from, to })),
      ]);
      // an open run whose worker stopped (time limit, closed tab): continue it after this response
      if (needsWorker(run)) after(() => continueRun(run!.id));
    }
    return (
      <AiControls
        profiles={profiles.map((p) => ({ id: p.id, name: p.name, prompt: p.prompt, fileName: p.file_name, version: p.version }))}
        activeId={active?.id ?? null}
        run={run && {
          id: run.id, label: run.label, status: run.status, phase: run.phase, pairsChecked: run.pairs_checked, merged: run.merged,
          total: run.total, done: run.done, error: run.error, finishedAt: run.finished_at, stale: active?.version !== run.version,
        }}
        todayNew={todayNew}
        range={days === '1' ? null : { days, from, to, label: describeRange({ days, from, to }) || 'all offers', newCount: rangeNew }}
        aiConfigured={Boolean(process.env.OPENAI_API_KEY)}
        models={aiConfig()}
      />
    );
  } catch (e) {
    return (
      <div className="notice">
        <strong>Can’t load the AI filter.</strong> Did you run <code>supabase/ai-filter.sql</code>?
        <code>{e instanceof Error ? e.message : String(e)}</code>
      </div>
    );
  }
}
