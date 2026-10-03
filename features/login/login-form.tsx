'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '/';
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        placeholder="Password"
        aria-label="Password"
        autoComplete="current-password"
        autoFocus
        required
      />
      <button type="submit" disabled={pending} aria-busy={pending || undefined}>
        {pending ? 'Checking…' : 'Log in'}
      </button>
      {state?.ok === false && <p className="form-error">{state.error}</p>}
    </form>
  );
}
