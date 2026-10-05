# 9. Notifications: channels fed by one queue, Web Push next to Telegram

- Status: accepted (2026-10-04)
- Context: [`lib/channels/`](../../lib/channels), [`lib/push.ts`](../../lib/push.ts),
  [`lib/listings/pipeline/notify.ts`](../../lib/listings/pipeline/notify.ts);
  [OPERATIONS.md → Notifications](../OPERATIONS.md#notifications)

## Context

The user wants new offers on an Android phone as notifications of the app itself, without Telegram, while
Telegram keeps working for whoever uses it. The queue (`notify_queue`), mute and the AI
check already decide what is worth sending and when; they shouldn't be repeated per channel.

## Decision

- **One batch, every channel.** `notify` builds the batch (claimed from the queue, AI verdicts, the
  20-minute rule, mute) and `deliver()` hands the same batch to every ready channel at once. A channel answers
  with what it couldn't deliver; one that throws counts as having delivered nothing. One channel failing never
  stops another.
- **Put back what no channel delivered.** An offer goes back into the queue only if every channel failed for
  it. With Telegram alone that is every offer it failed to send; with both, an offer push got to you isn't
  queued again because Telegram was down (it would come again as a push). Such a partial delivery is a success with a
  warning ("Sent 3; Telegram: …"): a toast in Settings, a warning (not an error) in the run log. Only when no
  channel delivered is it an error.
- **Push is a PWA with Web Push and VAPID** (`web-push`), no third-party service: `app/manifest.ts`,
  `public/sw.js` (no fetch handler, no cache: the app needs the server anyway), subscriptions in
  `push_subscriptions`, removed when the push service answers 404 / 410. One notification per batch, linking to
  `/?new=1`.
- **Push endpoints are outside input, so the SSRF policy applies.** The browser sends the endpoint, so a
  logged-in request could name any URL. It must be https, on the default port, on a known push service's host
  (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`;
  `isPushEndpoint`), checked when subscribing and again before every send (a stored one that fails is deleted).
  `web-push` makes the request with `node:https`, not `fetchOutbound()`, so in production it gets an
  `https.Agent` whose `lookup` is `lib/outbound.ts`'s `checkedLookup`: the connection only goes to an address
  the guard allows, as [ADR 0008](0008-ssrf-policy-connect-time-checks.md)'s requests do. A send gives up after
  10 s; what the user sees of a failure is "couldn't be reached", the network error's words go to the log.
- **"New" is the latest run's window**: the jobs whose earliest offer (`offers_unique.first_seen`) was first
  seen between the `started_at` and `finished_at` of the newest finished run that brought at least one such
  job (`latestWithNewJobs`), as Activity counts a run's offers. Not `added > 0`: a run that only saved another
  board's offer of a known job added an offer but no job. No flag is stored, so nothing has to be reset when
  you've seen them.

## Consequences

- Mute, the queue and the AI filter are in Settings → Notifications, for every channel; Telegram's panel has
  only its own set-up. The `/mute` and `/send` commands act on every channel.
- A channel is ready only with someone to send to (push: at least one device), so new offers aren't queued
  for nobody.
- A new channel is a `Channel` (`name`, `ready`, `send`) added to `CHANNELS`.
- A notification and the list's "new" can differ: the notification is the batch that was sent (it may hold
  offers a mute kept from earlier runs, or leave out ones the AI filter rejected), while `/?new=1` shows the
  jobs of the latest run that brought any, which may be a later run than the one notified. Left as it is: the
  link shows what came in last, which is what you open the app for.
