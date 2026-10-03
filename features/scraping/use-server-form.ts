'use client';

import { useState } from 'react';

// How every change in Settings behaves (the Next.js "interactive apps" patterns):
// - toggles show the new value at once (useOptimistic) until the refreshed page has it;
// - forms keep what you typed (controlled, no automatic form reset) and take the server's values
//   only where you haven't typed since (this hook);
// - "Saved." is a toast; what went wrong shows next to the control until the next try (useAction).

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A form over server data: shows what you type; new server data replaces only untouched values. */
export function useServerForm<T extends object>(server: T) {
  const [base, setBase] = useState(server);
  const [form, setForm] = useState(server);
  if (!same(server, base)) {
    // the page was refreshed with other values (saved here, or changed elsewhere)
    setBase(server);
    if (same(form, base)) setForm(server);
  }
  return { form, setForm, dirty: !same(form, server) };
}
