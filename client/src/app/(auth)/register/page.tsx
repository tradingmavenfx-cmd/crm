'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

export default function RegisterPage() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      // The slug is derived from the organisation name and is required to sign
      // in again, so show it before moving on rather than redirecting straight
      // to the dashboard.
      setSlug(
        await register({
          organizationName: String(form.get('organizationName')),
          firstName: String(form.get('firstName')),
          lastName: String(form.get('lastName')),
          email: String(form.get('email')),
          password: String(form.get('password')),
        }),
      );
    } catch (err) {
      const ax = err as AxiosError<{ message?: string | string[] }>;
      const msg = ax.response?.data?.message;
      setError(Array.isArray(msg) ? msg[0] : (msg ?? 'Registration failed'));
    }
  };

  if (slug) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <h1 className="text-2xl font-bold mb-1">Workspace created</h1>
          <p className="text-slate-500 text-sm mb-6">
            You will need this workspace slug every time you sign in. Save it
            somewhere safe.
          </p>

          <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 mb-6">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600 mb-1">
              Workspace slug
            </p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-lg font-semibold text-brand-700">
                {slug}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(slug);
                  setCopied(true);
                }}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <Button type="button" onClick={() => router.push('/dashboard')}>
            Go to dashboard
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-bold mb-1">Create your workspace</h1>
        <p className="text-slate-500 text-sm mb-6">
          Start your 6-phase CRM journey
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Organization name" name="organizationName" required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" required />
          </div>
          <Field label="Email" name="email" type="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            minLength={8}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={loading}>
            Create account
          </Button>
        </form>

        <p className="text-sm text-slate-500 mt-6 text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-600 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
