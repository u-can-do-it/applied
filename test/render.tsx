import { fireEvent, render as renderBare, screen, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

// an open tooltip measures its trigger; jsdom has no ResizeObserver
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/** Renders as the app does (app/layout.tsx): in a TooltipProvider, which every hint (components/hint.tsx) needs. */
export const render = (ui: ReactElement, options?: RenderOptions) =>
  renderBare(ui, { wrapper: TooltipProvider, ...options });

/** An element's hint (components/hint.tsx): it opens on keyboard focus, as it does for a mouse's hover. */
export function hintOf(element: HTMLElement): string | null {
  fireEvent.focus(element);
  const text = screen.queryByRole('tooltip')?.textContent ?? null;
  fireEvent.blur(element);
  return text;
}
