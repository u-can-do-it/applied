import { Code } from '@/components/field';

/** The Notifications panel's help: the channels, push on a phone, mute and the AI filter. */
export function NotificationsHelp() {
  return (
    <>
      <p>
        <strong>Where new offers go:</strong> every channel that’s set up gets them: Telegram (its panel below) and push
        notifications on the devices enabled here. One push notification per scrape run, naming the offers; tapping it
        opens the list on what that run brought. If one channel fails, the others still send; an offer none of them
        could send waits in the queue for the next try.
      </p>
      <p>
        <strong>On an Android phone:</strong> open Jobwatch in Chrome, log in, then menu → <q>Add to Home screen</q> (
        <q>Install app</q>). Open it from the home screen, come here and tap <q>Enable notifications on this device</q>.
        Push needs <Code>VAPID_PUBLIC_KEY</Code>, <Code>VAPID_PRIVATE_KEY</Code> and <Code>VAPID_SUBJECT</Code> on the
        server: <Code>npx web-push generate-vapid-keys</Code> makes the keys; the subject is <Code>mailto:</Code> your
        address.
      </p>
      <p>
        <strong>Mute</strong> keeps new offers in a queue instead of sending them, on every channel; unmuting sends what
        waited.
      </p>
      <p>
        <strong>Only offers the AI profile matches:</strong> every new offer is checked right after scraping, as the AI
        tab would (also the ones that aren’t sent, like a new scraper’s first run). The matches are listed with their
        fit; if none match, the message just says how many new offers there are. One the AI can’t check for 20 minutes
        is sent anyway, marked. Without <Code>OPENAI_API_KEY</Code> or an AI profile, every new offer is sent.
      </p>
    </>
  );
}
