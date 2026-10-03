'use client';

import { useOptimistic, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { ActionError, useAction } from '@/components/use-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/shared/cn';
import { kindOf } from '@/lib/listings/kinds';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { toggleScraperAction } from './actions';
import { PANEL } from './panel-styles';
import { blank, toDraft, type Draft } from './scraper-draft';
import { ScraperEditor } from './scraper-editor';
import { ScraperStatus } from './scraper-status';

// The scrapers: the built-in boards, plus your own (JSON / HTML / RSS) set up here.

export function ScrapersPanel({
  scrapers,
  counts,
  keywords,
}: {
  scrapers: Scraper[];
  counts: Partial<Record<string, { offers: number }>>;
  keywords: string[];
}) {
  const [open, setOpen] = useState<{ draft: Draft; test: boolean; n: number } | null>(null);
  const act = useAction();
  const edit = (draft: Draft, test = false) => setOpen((previous) => ({ draft, test, n: (previous?.n ?? 0) + 1 }));
  // a switched checkbox shows at once; the refreshed page brings the real list
  const [list, toggle] = useOptimistic(scrapers, (cur, change: { id: string; enabled: boolean }) =>
    cur.map((scraper) => (scraper.id === change.id ? { ...scraper, enabled: change.enabled } : scraper)),
  );

  return (
    <Card className={PANEL} role="region" aria-labelledby="scrapers-h">
      <CardHeader className="flex items-center justify-between gap-3 px-4">
        <h2 id="scrapers-h" className="m-0 text-base font-semibold">
          Scrapers
        </h2>
        <Button type="button" onClick={() => edit(blank('html'))}>
          <PlusIcon /> Add scraper
        </Button>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="m-0 list-none border-t p-0">
          {list.map((scraper) => (
            <li
              key={scraper.id}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-b py-2.5 max-[560px]:grid-cols-[auto_1fr]"
            >
              <Switch
                className="mt-0.5"
                checked={scraper.enabled}
                aria-label={`${scraper.name} on`}
                onCheckedChange={(enabled) => {
                  act.run(
                    () => toggleScraperAction({ id: scraper.id, enabled }),
                    () => toggle({ id: scraper.id, enabled }),
                  );
                }}
              />
              <div className={cn('min-w-0 text-sm', !scraper.enabled && 'opacity-55')}>
                <div>
                  <strong>{scraper.name}</strong> <Badge variant="quiet">{kindOf(scraper.kind).label}</Badge>{' '}
                  <span className="text-xs text-muted-foreground">
                    {scraper.src}
                    {counts[scraper.src] ? ` · ${counts[scraper.src]?.offers} saved` : ''}
                  </span>
                </div>
                <ScraperStatus scraper={scraper} />
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 max-[560px]:col-start-2 max-[560px]:justify-start">
                <Button type="button" variant="outline" size="sm" onClick={() => edit(toDraft(scraper), true)}>
                  Test
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => edit(toDraft(scraper))}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="A copy, e.g. for another search on the same board"
                  onClick={() => edit({ ...toDraft(scraper), id: undefined, name: `${scraper.name} (copy)` })}
                >
                  Copy
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <ActionError error={act.error} />
      </CardContent>
      {open && (
        <ScraperEditor
          key={open.n}
          initial={open.draft}
          autoTest={open.test}
          keywords={keywords}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  );
}
