'use client';

import { useMemo } from 'react';
import type { Application } from '@/lib/applications';
import { isActive, isRejected, stageOf, outcomeHeading, stats } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { percentOf } from '@/lib/shared/format';
import { Card } from '@/components/ui/card';
import { Funnel } from './funnel';
import { StageTable } from './stage-table';

/** what a click on a statistic shows: the applications it counts */
export type Filter = { label: string; test: (app: Application) => boolean } | null;

export function AppliedStats({
  apps,
  filter,
  setFilter,
}: {
  apps: Application[];
  filter: Filter;
  setFilter: (filter: Filter) => void;
}) {
  const counts = useMemo(() => stats(apps), [apps]);
  const pick = (label: string, test: (app: Application) => boolean) => () =>
    setFilter(filter?.label === label ? null : { label, test });
  const on = (label: string) => (filter?.label === label ? 'true' : undefined);

  const tiles = [
    { label: 'Sent', value: counts.sent, sub: '', test: () => true, tone: '' },
    {
      label: 'Positive replies',
      value: counts.positive,
      sub: percentOf(counts.positive, counts.sent),
      test: (app: Application) => app.stage !== 'submitted',
      tone: 'good',
    },
    {
      label: 'Offers',
      value: counts.offers,
      sub: percentOf(counts.offers, counts.sent),
      test: (app: Application) => app.stage === 'offer',
      tone: 'good',
    },
    { label: 'In progress', value: counts.active, sub: '', test: (app: Application) => isActive(app), tone: '' },
    {
      label: 'Rejected',
      value: counts.rejected,
      sub: percentOf(counts.rejected, counts.sent),
      test: (app: Application) => isRejected(app),
      tone: 'bad',
    },
    {
      label: 'Ghosted',
      value: counts.ghosted,
      sub: percentOf(counts.ghosted, counts.sent),
      test: (app: Application) => app.outcome === 'ghosted',
      tone: 'bad',
    },
    {
      label: outcomeHeading('pool'),
      value: counts.pool,
      sub: percentOf(counts.pool, counts.sent),
      test: (app: Application) => app.outcome === 'pool',
      tone: 'bad',
    },
  ];

  return (
    <section className="mb-3.5 flex flex-col gap-2.5" aria-label="Application statistics">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            size="sm"
            className="py-0 transition-shadow hover:ring-muted-foreground has-aria-pressed:ring-2 has-aria-pressed:ring-brand"
          >
            <button
              type="button"
              className="flex flex-col items-start px-3 py-2.5 text-left focus-visible:outline-offset-[-2px]"
              aria-pressed={on(tile.label)}
              onClick={tile.label === 'Sent' ? () => setFilter(null) : pick(tile.label, tile.test)}
            >
              <span className="text-[22px] leading-[1.2] font-bold tabular-nums">{tile.value}</span>
              <span className="text-xs text-muted-foreground">{tile.label}</span>
              {tile.sub && (
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    tile.tone === 'good' && 'text-success',
                    tile.tone === 'bad' && 'text-destructive',
                  )}
                >
                  {tile.sub}
                </span>
              )}
            </button>
          </Card>
        ))}
      </div>

      {/* where applications are: each one at the stage of its last status (a stage it was taken back
          from doesn't count), as a share of all sent */}
      <Funnel
        stages={counts.now.map((atStage) => ({ ...atStage, label: stageOf(atStage.stage).label }))}
        sent={counts.sent}
        isOn={(label) => Boolean(on(label))}
        onPick={(label, stage) => pick(label, (app) => app.stage === stage)()}
      />

      <StageTable byStage={counts.byStage} isOn={on} onPick={(label, test) => pick(label, test)()} />
    </section>
  );
}
