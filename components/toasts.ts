// Toasts show above an open Sheet or Dialog (the root layout's Toaster). A click on one (its close
// button, say) is outside the window: without this the window would take it as "click outside" and close.

/** For a Sheet's or Dialog's onInteractOutside: a toast clicked doesn't close the window under it. */
export function keepOpenOnToast(event: { target: EventTarget | null; preventDefault: () => void }) {
  if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) event.preventDefault();
}
