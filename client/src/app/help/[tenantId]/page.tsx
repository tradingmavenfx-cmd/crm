'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { HelpCentre } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
];

/**
 * The customer-facing help centre. Public, so it talks to the API with a bare
 * axios call rather than the authenticated client.
 */
export default function HelpCentrePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [locale, setLocale] = useState('en');

  const centre = useQuery({
    queryKey: ['help', tenantId, query, locale],
    queryFn: async () =>
      (
        await axios.get<HelpCentre>(`${API_BASE}/help/${tenantId}`, {
          params: { ...(query ? { q: query } : {}), locale },
        })
      ).data,
    retry: false,
  });

  if (centre.isError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Help centre not found</h1>
        <p className="mt-2 text-slate-600">
          This link does not point at a help centre.
        </p>
      </main>
    );
  }

  const results = centre.data?.results ?? [];
  const categories = [
    ...new Map(
      results
        .filter((r) => r.category)
        .map((r) => [r.category!.id, r.category!]),
    ).values(),
  ];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <h1 className="text-3xl font-bold text-slate-900">
            {centre.data?.tenant.name ?? 'Help centre'}
          </h1>
          <p className="mt-2 text-slate-500">
            Search the answers, or browse by topic.
          </p>

          <form
            className="mx-auto mt-6 flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(term.trim());
            }}
          >
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="How do refunds work?"
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Search
            </button>
          </form>

          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <Link
              href={`/portal/${tenantId}`}
              className="rounded-full px-3 py-1 text-brand-700 hover:bg-brand-50"
            >
              Your account
            </Link>
            <span className="text-slate-300">|</span>
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                className={`rounded-full px-3 py-1 ${
                  locale === l.code
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {query && (
          <p className="mb-4 text-sm text-slate-500">
            {results.length === 0
              ? `Nothing matched “${query}”. Try different words, or contact support.`
              : `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”`}
          </p>
        )}

        {centre.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

        {!query && categories.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            {categories.map((c) => (
              <span
                key={c.id}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
              >
                {c.name}
              </span>
            ))}
          </div>
        )}

        <ul className="space-y-3">
          {results.map((a) => (
            <li key={a.slug}>
              <Link
                href={`/help/${tenantId}/${a.slug}?locale=${a.locale}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
              >
                <p className="font-semibold text-slate-900">{a.title}</p>
                {a.excerpt && (
                  <p className="mt-1 text-sm text-slate-600">{a.excerpt}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {a.category && <span>{a.category.name}</span>}
                  {a.tags.map((t) => (
                    <span key={t} className="rounded bg-slate-100 px-2 py-0.5">
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {!centre.isLoading && results.length === 0 && !query && (
          <p className="text-sm text-slate-500">
            No published articles in this language yet.
          </p>
        )}
      </div>
    </main>
  );
}
