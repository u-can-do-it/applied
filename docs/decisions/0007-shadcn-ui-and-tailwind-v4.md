# 7. shadcn/ui and Tailwind v4 for the UI

- Status: accepted (2026-10-03)
- Context: [code review](../code-review.md) §4 "Component library: use shadcn/ui"

## Context

Every control was hand-made: four dialogs, a masked date field over a hidden native picker, a tooltip placed
with `requestAnimationFrame`, `confirm()`, inline feedback paragraphs, and an 846-line global stylesheet with
ten dark-mode blocks. None of it is what makes Jobwatch useful, and all of it had to be maintained and kept
accessible.

## Decision

- **shadcn/ui** (Radix primitives, styled with Tailwind): `Dialog`, `Sheet`, `AlertDialog` (behind
  `useConfirm()`), `Tooltip`, `Popover` + `Calendar`, `Badge`, `Skeleton`, `Progress`, `Table`, `sonner`
  toasts… The components are copied into `components/ui/` (`npx shadcn@latest add <name>`, configured by
  `components.json`) and are the repo's own code, edited like any other file.
- **Tailwind v4** through `@tailwindcss/postcss`. Colours are tokens in `app/globals.css`, shadcn's names plus
  the app's (`brand`, `success`, `warning`, `pool`), one light and one dark set that follows the system. Styling
  is utility classes on the element; `globals.css` keeps only the tokens, the base layer and `.wrap`.
- **lucide-react** for icons.
- Mantine was the runner-up (no Tailwind, more built in) but is a framework adopted wholesale with its own
  styling system; MUI and Ant Design are heavier and impose a look.

## Consequences

- The vocabulary (`<Dialog>`, `<Sheet>`, `<Tooltip>`) is what most Next.js developers already know, and
  accessibility (focus, roles, keyboard) is Radix's job.
- A colour is a token (`bg-card`, `text-muted-foreground`), never a literal and never a `dark:` variant: the
  dark theme comes from the tokens. The rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md#styling).
- Updating a shadcn component is a manual merge, since the copy is ours.
