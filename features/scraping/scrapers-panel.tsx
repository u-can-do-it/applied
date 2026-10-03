'use client';

import { useOptimistic, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { PanelHeading } from '@/components/help';
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
import { LazyScraperEditor, loadEditor } from './lazy-scraper-editor';
import { ScraperBrief } from './scraper-status';

// The scrapers: the built-in boards, plus your own (JSON / HTML / RSS) set up here.

const saved = (offers = 0) => (offers ? ` · ${offers} offer${offers === 1 ? '' : 's'} saved` : '');

const HELP = (
  <>
    <p>
      A scraper is one saved search on a board: its link and its filters. The built-in boards come with theirs; “Add
      scraper” sets up your own from a JSON API, an HTML page or an RSS feed. Searches on one board share its id, which
      every offer they find is saved under.
    </p>
    <p>
      Test fetches the pages with the scraper’s values without saving anything. Copy starts a new scraper from this one,
      e.g. for another search on the same board. A new scraper’s first run (or the first after its search changed) only
      saves its offers, so Telegram isn’t flooded with old ones.
    </p>
    <p>What each scraper’s last run found is on the Activity tab.</p>
  </>
);

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
    <Card
      className={PANEL}
      role="region"
      aria-labelledby="scrapers-h"
      onPointerOver={() => void loadEditor()}
      onFocus={() => void loadEditor()}
    >
      <CardHeader className="px-4">
        <PanelHeading id="scrapers-h" title="Scrapers" help={HELP}>
          <Button type="button" onClick={() => edit(blank('html'))}>
            <PlusIcon /> Add scraper
          </Button>
        </PanelHeading>
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
                    on {scraper.src}
                    {saved(counts[scraper.src]?.offers)}
                  </span>
                </div>
                <ScraperBrief scraper={scraper} />
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
        <LazyScraperEditor
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
