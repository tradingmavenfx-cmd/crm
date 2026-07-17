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

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await register({
        organizationName: String(form.get('organizationName')),
        firstName: String(form.get('firstName')),
        lastName: String(form.get('lastName')),
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      router.push('/dashboard');
    } catch (err) {
      const ax = err as AxiosError<{ message?: string | string[] }>;
      const msg = ax.response?.data?.message;
      setError(Array.isArray(msg) ? msg[0] : msg ?? 'Registration failed');
    }
  };

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
