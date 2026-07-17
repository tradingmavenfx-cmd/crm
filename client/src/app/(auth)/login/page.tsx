'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await login(
        String(form.get('email')),
        String(form.get('password')),
        String(form.get('tenantSlug')),
      );
      router.push('/dashboard');
    } catch (err) {
      const ax = err as AxiosError<{ message?: string }>;
      setError(ax.response?.data?.message ?? 'Login failed');
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-bold mb-1">Welcome back</h1>
        <p className="text-slate-500 text-sm mb-6">Sign in to your workspace</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Workspace slug" name="tenantSlug" placeholder="acme" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={loading}>
            Sign in
          </Button>
        </form>

        <p className="text-sm text-slate-500 mt-6 text-center">
          No account?{' '}
          <Link href="/register" className="text-brand-600 font-medium">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
