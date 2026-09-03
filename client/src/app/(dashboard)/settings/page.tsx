'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

interface TenantSettings {
  productName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  loginHeadline: string | null;
  loginSubtext: string | null;
  supportEmail: string | null;
  customDomain: string | null;
  showPoweredBy: boolean;
  timezone: string;
  currency: string;
  locale: string;
  gstin: string | null;
  upiVpa: string | null;
  upiName: string | null;
}

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

export default function SettingsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<TenantSettings>('/settings')).data,
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.put<TenantSettings>('/settings', body)).data,
    onSuccess: () => {
      setSaved(true);
      setError(null);
      // The colour is read by the branding provider, so the whole interface
      // repaints once this lands.
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['branding'] });
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message[0] : (message ?? 'Could not save'));
      setSaved(false);
    },
  });

  const s = settings.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {!s ? (
        <Skeleton className="h-64" />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const text = (name: string) =>
              String(form.get(name) || '') || undefined;

            save.mutate({
              productName: text('productName'),
              logoUrl: text('logoUrl'),
              primaryColor: text('primaryColor'),
              loginHeadline: text('loginHeadline'),
              loginSubtext: text('loginSubtext'),
              supportEmail: text('supportEmail'),
              customDomain: text('customDomain'),
              showPoweredBy: form.get('showPoweredBy') === 'on',
              timezone: String(form.get('timezone')),
              currency: String(form.get('currency')),
              gstin: text('gstin'),
              upiVpa: text('upiVpa'),
              upiName: text('upiName'),
            });
          }}
        >
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">
              How it looks
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Applied everywhere, including the pages customers see — the help
              centre, the portal, quotes and shared documents.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field
                label="Product name"
                name="productName"
                defaultValue={s.productName ?? ''}
                placeholder="CRM Pro"
              />
              <Field
                label="Logo URL"
                name="logoUrl"
                defaultValue={s.logoUrl ?? ''}
                placeholder="https://…/logo.svg"
              />
            </div>

            <div className="mt-3 flex items-end gap-3">
              <div>
                <label
                  htmlFor="primaryColor"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Brand colour
                </label>
                <input
                  id="primaryColor"
                  name="primaryColor"
                  type="color"
                  defaultValue={s.primaryColor}
                  className="h-10 w-20 rounded-lg border border-slate-200"
                />
              </div>
              <p className="pb-2 text-xs text-slate-500">
                One colour is enough — the lighter and darker shades the
                interface needs are worked out from it.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">
              The sign-in page
            </h2>
            <div className="mt-3 space-y-3">
              <Field
                label="Headline"
                name="loginHeadline"
                defaultValue={s.loginHeadline ?? ''}
                placeholder="Welcome back"
              />
              <Field
                label="Subtext"
                name="loginSubtext"
                defaultValue={s.loginSubtext ?? ''}
                placeholder="Sign in to your workspace"
              />
              <Field
                label="Custom domain"
                name="customDomain"
                defaultValue={s.customDomain ?? ''}
                placeholder="crm.yourcompany.com"
              />
              <p className="text-xs text-slate-500">
                Point a CNAME at us and this workspace answers on that
                hostname, branded, without anyone having to type a workspace
                slug.
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="showPoweredBy"
                  defaultChecked={s.showPoweredBy}
                />
                Show “powered by” on public pages
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">
              Region and billing details
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Timezone
                </label>
                <select
                  name="timezone"
                  defaultValue={s.timezone}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Currency
                </label>
                <select
                  name="currency"
                  defaultValue={s.currency}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <Field
                label="Support email"
                name="supportEmail"
                type="email"
                defaultValue={s.supportEmail ?? ''}
              />
              <Field
                label="GSTIN"
                name="gstin"
                defaultValue={s.gstin ?? ''}
                placeholder="29ABCDE1234F1Z5"
              />
              <Field
                label="UPI id"
                name="upiVpa"
                defaultValue={s.upiVpa ?? ''}
                placeholder="yourcompany@okhdfcbank"
              />
              <Field
                label="Name on the UPI account"
                name="upiName"
                defaultValue={s.upiName ?? ''}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              With a UPI id set, an invoice can show a payment request any
              Indian banking app opens. It asks for the money; whether it
              arrived still has to be reconciled by hand, because that needs a
              payment provider.
            </p>
          </section>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              Saved.
            </p>
          )}

          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      )}
    </div>
  );
}
