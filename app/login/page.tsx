import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/login/login-form';

export const metadata: Metadata = { title: 'Jobwatch · log in' };

export default function LoginPage() {
  return (
    <main className="wrap max-w-[360px] pt-[18vh]">
      <h1 className="m-0 mb-1 text-[22px] font-bold tracking-[-0.01em]">Jobwatch</h1>
      <p className="my-[1em] text-muted-foreground">Enter the password once. This browser stays logged in.</p>
      {/* reads ?next= on the client */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
