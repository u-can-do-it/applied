'use client';

import { useMemo } from 'react';
import type { ListedApplication } from '@/lib/applications';
import { stageOf, stats } from '@/lib/stages';
import { cn } from '@/lib/shared/cn';
import { percentOf } from '@/lib/shared/format';
import { Card } from '@/components/ui/card';
import { isRentADev, RENT_A_DEV } from '@/features/offers/rent-a-dev';
import { Funnel } from './funnel';
import { StageTable } from './stage-table';
import { TILES, type TileId } from './status-filter';

/** filter: the id of the statistic whose applications the list shows (?status=), null for all */
export function AppliedStats({
  apps,
  filter,
  setFilter,
}: {
  apps: ListedApplication[];
  filter: string | null;
  setFilter: (filter: string | null) => void;
}) {
  const counts = useMemo(() => stats(apps), [apps]);
  // Rent-a-dev or not; a job nothing said either way about is in neither
  const leasing = useMemo(() => {
    const calls = apps.map(isRentADev);
    return { yes: calls.filter((call) => call === true).length, no: calls.filter((call) => call === false).length };
  }, [apps]);
  // a second click on the one that's on shows them all again
  const pick = (id: string) => setFilter(filter === id ? null : id);
  const on = (id: string) => (filter === id ? 'true' : undefined);

  const share = (count: number) => percentOf(count, counts.sent);
  const tiles: { id: TileId | null; value: number; sub: string; tone: '' | 'good' | 'bad' }[] = [
    { id: 'unanswered', value: counts.unanswered, sub: '', tone: '' },
    { id: 'process', value: counts.inProcess, sub: '', tone: '' },
    { id: null, value: counts.sent, sub: '', tone: '' }, // Sent: all of them
    { id: 'offers', value: counts.offers, sub: share(counts.offers), tone: 'good' },
    { id: 'positive', value: counts.positive, sub: share(counts.positive), tone: 'good' },
    { id: 'rejected', value: counts.rejected, sub: share(counts.rejected), tone: 'bad' },
    { id: 'ghosted', value: counts.ghosted, sub: share(counts.ghosted), tone: 'bad' },
    { id: 'pool', value: counts.pool, sub: share(counts.pool), tone: 'bad' },
  ];

  return (
    <section className="mb-3.5 flex flex-col gap-2.5" aria-label="Application statistics">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        {tiles.map((tile) => (
          <Card
            key={tile.id ?? 'sent'}
            size="sm"
            className="py-0 transition-shadow hover:ring-muted-foreground has-aria-pressed:ring-2 has-aria-pressed:ring-brand"
          >
            <button
              type="button"
              className="flex flex-col items-start px-3 py-2.5 text-left focus-visible:outline-offset-[-2px]"
              aria-pressed={tile.id ? on(tile.id) : undefined}
              onClick={() => (tile.id ? pick(tile.id) : setFilter(null))}
            >
              <span className="text-[22px] leading-[1.2] font-bold tabular-nums">{tile.value}</span>
              <span className="text-xs text-muted-foreground">{tile.id ? TILES[tile.id].label : 'Sent'}</span>
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
        {/* the last one only counts: not a filter */}
        <Card size="sm" className="py-0" aria-disabled="true" title={RENT_A_DEV.title}>
          <div className="flex flex-col items-start px-3 py-2.5 opacity-70">
            <span className="text-[22px] leading-[1.2] font-bold tabular-nums">
              {leasing.yes} / {leasing.no}
            </span>
            <span className="text-xs text-muted-foreground">{RENT_A_DEV.label} / normal</span>
            <span className="text-xs text-warning-strong tabular-nums">
              {percentOf(leasing.yes, leasing.yes + leasing.no)}
            </span>
          </div>
        </Card>
      </div>

      {/* where applications are: each one at the stage of its last status (a stage it was taken back
          from doesn't count), as a share of all sent */}
      <Funnel
        stages={counts.now.map((atStage) => ({ ...atStage, label: stageOf(atStage.stage).label }))}
        sent={counts.sent}
        isOn={(stage) => Boolean(on(stage))}
        onPick={pick}
      />

      <StageTable byStage={counts.byStage} isOn={on} onPick={pick} />
    </section>
  );
}
