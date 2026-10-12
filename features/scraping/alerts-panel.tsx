'use client';

import { useRef, useState } from 'react';
import { CheckIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react';
import { Code } from '@/components/field';
import { PanelHeading } from '@/components/help';
import { useZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { AlertCounts } from '@/lib/db/repos/alert-jobs';
import { PANEL, SMALL } from './panel-styles';

// LinkedIn's job alert emails in Settings: whether they come in, what became of their jobs, and how to set up
// the Gmail script that sends them (lib/listings/gmail-alerts.ts), with this app's endpoint and secret in it.

export function AlertsPanel({
  lastEmailAt,
  lastEmailJobs,
  counts,
  script,
}: {
  lastEmailAt: string | null;
  lastEmailJobs: number | null;
  counts: AlertCounts;
  /** null: no secret to give it (no APP_PASSWORD) */
  script: string | null;
}) {
  const { formatTime } = useZone();
  return (
    <Card className={PANEL} role="region" aria-labelledby="alerts-h">
      <CardHeader className="px-4">
        <PanelHeading id="alerts-h" title="LinkedIn alert emails" help={<AlertsHelp />} />
      </CardHeader>
      <CardContent className="px-4">
        <p className={SMALL}>
          {!lastEmailAt ? (
            <span className="text-muted-foreground">No email yet: set it up below.</span>
          ) : lastEmailJobs ? (
            <>
              <CheckIcon className="text-success" role="img" aria-label="OK" /> Last email {formatTime(lastEmailAt)}:{' '}
              {lastEmailJobs} job{lastEmailJobs === 1 ? '' : 's'}
            </>
          ) : (
            <span className="text-warning">
              <TriangleAlertIcon /> The last email ({formatTime(lastEmailAt)}) had no job in it: another kind of
              LinkedIn email, or a layout the app doesn’t read.
            </span>
          )}
        </p>
        <p className={SMALL}>
          This week: {counts.kept} kept, {counts.known} found by the scrapers already, {counts.skipped} left out by the
          filters
          {counts.waiting > 0 && ` · ${counts.waiting} waiting for the next run`}
        </p>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Set it up in Gmail</summary>
          {script ? (
            <>
              <ol className="my-1.5 list-decimal pl-5">
                <li>
                  On LinkedIn, Jobs → Job alerts: let your searches’ alerts come by email (daily is the most often it
                  sends).
                </li>
                <li>
                  At <Code>script.google.com</Code> → New project, replace the code with the script below and save.
                </li>
                <li>
                  Pick <Code>setup</Code> and Run, and let it read your Gmail and connect to an external service. From
                  then on it sends each new alert here every 10 minutes.
                </li>
              </ol>
              <CopyScript script={script} />
              <p className={SMALL}>
                The secret in it comes from <Code>CRON_SECRET</Code> (or <Code>APP_PASSWORD</Code>): after changing
                that, paste the script again.
              </p>
            </>
          ) : (
            <p className={SMALL}>
              <span className="text-warning">Set APP_PASSWORD (or CRON_SECRET) first</span>: the script needs a secret
              to send the emails with.
            </p>
          )}
        </details>
      </CardContent>
    </Card>
  );
}

/** The script with a Copy button; where the browser refuses the clipboard, the script is selected instead. */
function CopyScript({ script }: { script: string }) {
  const [copied, setCopied] = useState<'yes' | 'select' | null>(null);
  const text = useRef<HTMLPreElement>(null);
  const select = () => {
    const range = document.createRange();
    if (text.current) range.selectNodeContents(text.current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  };
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute top-1.5 right-1.5"
        onClick={() => {
          navigator.clipboard.writeText(script).then(
            () => {
              setCopied('yes');
            },
            () => {
              select();
              setCopied('select');
            },
          );
        }}
      >
        {copied === 'yes' ? <CheckIcon /> : <CopyIcon />} {copied === 'yes' ? 'Copied' : 'Copy'}
      </Button>
      <pre
        ref={text}
        aria-label="The Gmail script"
        className="m-0 max-h-72 overflow-auto rounded-md bg-card p-2 pr-24 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {script}
      </pre>
      {copied === 'select' && (
        <p className={SMALL} role="status">
          The browser didn’t let the page copy it: the script is selected, copy it with the keyboard.
        </p>
      )}
    </div>
  );
}

function AlertsHelp() {
  return (
    <>
      <p>
        <strong>Why:</strong> LinkedIn matches its alerts on the whole ad, and they find what the logged-out search the
        scrapers use misses. A Google Apps Script in your Gmail sends each new alert email here; your Gmail stays
        Google’s to read, the app gets those emails only.
      </p>
      <p>
        <strong>What happens to them:</strong> each job in an email waits for the next scrape run, which reads its
        posting on LinkedIn (title, company, place, ad) and keeps it when the filters let it through, as the LinkedIn
        scrapers’ offers: a keyword in the title or the ad, in the cities or remote, not an ignored title. A kept one is
        announced and checked by the AI like any new offer. Up to 10 are read a run; a job a scraper found already isn’t
        read again.
      </p>
    </>
  );
}
