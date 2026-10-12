import 'server-only';
import { env } from '../env';
import { hmac, sameString } from '../hmac';
import { cronSecret } from './schedule';

// LinkedIn's job alert emails come from Gmail: a Google Apps Script in your account (gmailScript, from
// Settings) sends each new one to POST /api/alerts/linkedin every 10 minutes, so Gmail stays Google's to
// read and the app gets the emails only. Its secret is derived from the cron's: a new CRON_SECRET or
// APP_PASSWORD means the script needs pasting again.

export const ALERTS_PATH = '/api/alerts/linkedin';

/** The script's secret; null without CRON_SECRET or APP_PASSWORD. */
export async function alertsSecret(): Promise<string | null> {
  const cron = await cronSecret();
  return cron ? hmac(cron, 'jobwatch-alerts-v1') : null;
}

/** Authorization: Bearer <secret>. Without any secret only a local dev server lets it through. */
export async function isAlertsRequest(req: Request) {
  const secret = await alertsSecret();
  if (!secret) return env.NODE_ENV !== 'production';
  return sameString(req.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/** LinkedIn's job alerts, and its other emails with jobs in them */
const SEARCH = 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com) newer_than:2d';

/** The Apps Script to paste at script.google.com, with this app's endpoint and secret in it. */
export function gmailScript(endpoint: string, secret: string) {
  return `// Jobwatch: LinkedIn's job alert emails, sent to your Jobwatch every 10 minutes.
// Set it up once: pick "setup" above and Run (Google asks to let it read your Gmail and connect to an
// external service). Then leave it; Google emails you if it fails. It sends each new email from LinkedIn's
// job alerts, and nothing else.
const JOBWATCH = ${JSON.stringify(endpoint)};
const SECRET = ${JSON.stringify(secret)};
const SEARCH = ${JSON.stringify(SEARCH)};

function setup() {
  for (const trigger of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(trigger);
  ScriptApp.newTrigger('sendAlerts').timeBased().everyMinutes(10).create();
  sendAlerts();
}

function sendAlerts() {
  const sent = PropertiesService.getScriptProperties();
  const until = Number(sent.getProperty('until') || 0);
  const emails = GmailApp.search(SEARCH, 0, 50)
    .flatMap((thread) => thread.getMessages())
    .filter((email) => email.getDate().getTime() > until)
    .sort((a, b) => a.getDate().getTime() - b.getDate().getTime());
  for (const email of emails) {
    const answer = UrlFetchApp.fetch(JOBWATCH, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + SECRET },
      payload: JSON.stringify({ html: email.getBody() }),
      muteHttpExceptions: true,
    });
    if (answer.getResponseCode() !== 200)
      throw new Error('Jobwatch answered ' + answer.getResponseCode() + ': ' + answer.getContentText().slice(0, 200));
    sent.setProperty('until', String(email.getDate().getTime()));
  }
}
`;
}
