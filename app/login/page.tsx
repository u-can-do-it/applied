import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/login/login-form';

export const metadata: Metadata = { title: 'Jobwatch · log in' };

export default function LoginPage() {
  return (
    <main className="wrap login">
      <h1>Jobwatch</h1>
      <p className="muted">Enter the password once. This browser stays logged in.</p>
      {/* reads ?next= on the client */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
