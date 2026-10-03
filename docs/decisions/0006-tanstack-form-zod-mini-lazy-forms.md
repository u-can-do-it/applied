# 6. Forms: TanStack Form with the actions' Zod schemas (`zod/mini`), loaded lazily

- Status: accepted (2026-10-03)
- Context: [code review](../code-review.md) §4; [`components/form.tsx`](../../components/form.tsx)

## Context

Each form had its own state handling (a `useServerForm` hook, a hand-kept `touched` set for "Fill in from the
link", draft objects in the scraper editor), and validation lived in three places: ad-hoc checks in the
browser, normalising functions on the server, and the server action's own guards.

## Decision

- **One schema per input**, in `lib/shared/schemas/`. The server action checks it (`action()` /
  `formAction()` in `server/action.ts`) and the form checks the same schema in the browser.
- **TanStack Form** (`useAppForm` in `components/form.tsx`), not react-hook-form: it takes a Zod schema
  directly through Standard Schema (no resolver), tracks touched and dirty fields per field (what "Fill in from
  the link" needs to skip what you changed), and sits next to TanStack Query. Fields come from the app's field
  components, which wire the label, hint, error and aria attributes. Checked on Save, then on every change
  (`checkOnSubmit`); what the server answers shows by the button (`answered`, `FormError`).
- **`zod/mini`** for the shared schemas: functions instead of methods, so a page bundles only what it uses
  (about 16 kB gzipped instead of zod's ~90 kB). Server-only code (`lib/env.ts`) may use full `zod`.
- **Lazy**: a form shown on a click (a `Sheet`, a `Dialog`) is `React.lazy`-loaded inside `<LazyForm>`; a form
  on the page from the start (Settings) loads its schema on the first check (`lazySchema`). A page then doesn't
  carry the form library and zod until they're needed. If the code can't load, the form says so instead of
  saving unchecked.

## Consequences

- A field's rule is written once; a message the user sees is worded in the schema.
- `zod/mini`'s functional API (`z.pipe(…)`, `z._default(…)`, `.check(z.refine(…))`) reads differently from the zod most
  examples show.
- A form whose values aren't the schema's input maps them first (the scraper editor's `toForm` and
  `scraperErrors`).
- The first open of a lazy form shows grey fields for a moment.
