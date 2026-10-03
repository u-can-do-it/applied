'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { login } from './actions';

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '/';
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2.5">
      <input type="hidden" name="next" value={next} />
      <Input
        type="password"
        name="password"
        placeholder="Password"
        aria-label="Password"
        autoComplete="current-password"
        autoFocus
        required
        className="h-10 bg-card text-base md:text-base dark:bg-card"
      />
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending || undefined}>
        {pending ? 'Checking…' : 'Log in'}
      </Button>
      {state?.ok === false && (
        <Alert variant="destructive">
          <AlertTitle>{state.error}</AlertTitle>
        </Alert>
      )}
    </form>
  );
}
