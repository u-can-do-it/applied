'use client';

import { BookmarkIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PanelHeading } from '@/components/help';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PANEL, SMALL } from './panel-styles';

// The bookmarklet (lib/listings/bookmarklet.ts): a link to drag to the bookmarks bar, for a board
// that blocks this server but not your browser.

const HELP = (
  <>
    <p>
      Some boards block this server (Eldorado’s Cloudflare answers it with “Just a moment…”) but not your browser. The
      bookmarklet runs their scrapers from your browser instead: open the board’s site, click it, and it fetches the
      pages those scrapers read there, as you, and sends them here. They go through the same filters, saving and
      notifications as a scheduled run, which keeps trying on its own.
    </p>
    <p>
      Clicked anywhere else (here, say), it opens the search of the board that blocks this server (the one the last
      scheduled run got an HTTP 403 from); a bookmarklet stops with its page, so click it once more there.
    </p>
    <p>
      It works on any site a scraper’s link points to, every scraper on that site at once. The link holds a key derived
      from the app’s password: keep it to yourself; changing the password changes it (drag it again).
    </p>
  </>
);

export function BookmarkletPanel({ href }: { href: string }) {
  return (
    <Card className={PANEL} role="region" aria-labelledby="bookmarklet-h">
      <CardHeader className="px-4">
        <PanelHeading id="bookmarklet-h" title="Bookmarklet" help={HELP} />
      </CardHeader>
      <CardContent className="px-4">
        <p className={`${SMALL} text-muted-foreground`}>
          Drag it to your bookmarks bar and click it: it opens the board that blocks this server; click it again there.
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              // React refuses a javascript: link in href; set on the element, it's the bookmark that gets dragged
              ref={(link) => link?.setAttribute('href', href)}
              onClick={(event) => {
                event.preventDefault(); // here it would run on this app
                toast('Drag it to your bookmarks bar, then click it there.');
              }}
            >
              <BookmarkIcon /> Jobwatch import
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="For a browser that can't drag to its bookmarks: paste it as a bookmark's address"
            onClick={() =>
              void navigator.clipboard.writeText(href).then(
                () => toast('Copied. Paste it as a new bookmark’s address.'),
                () => toast.error('Couldn’t copy it.'),
              )
            }
          >
            <CopyIcon /> Copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
