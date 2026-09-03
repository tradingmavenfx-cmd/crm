'use client';

import { FormEvent, Suspense, use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { PublicPage } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

export default function LandingPageRoute({
  params,
}: {
  params: Promise<{ tenantId: string; slug: string }>;
}) {
  const { tenantId, slug } = use(params);
  return (
    <Suspense fallback={<main className="p-10 text-sm text-slate-500">Loading…</main>}>
      <Landing tenantId={tenantId} slug={slug} />
    </Suspense>
  );
}

/**
 * A published landing page. Public, so it uses a bare axios call; the API
 * decides which A/B variant this visitor sees and counts the view.
 */
function Landing({ tenantId, slug }: { tenantId: string; slug: string }) {
  const search = useSearchParams();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page = useQuery({
    queryKey: ['landing', tenantId, slug],
    queryFn: async () =>
      (await axios.get<PublicPage>(`${API_BASE}/p/${tenantId}/${slug}`)).data,
    retry: false,
    // One view per visit: refetching on a tab switch would inflate the count
    // the conversion rate is measured against.
    refetchOnWindowFocus: false,
  });

  const submit = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const utm: Record<string, string> = {};
      for (const key of UTM_KEYS) {
        const value = search.get(key);
        if (value) utm[key] = value;
      }
      return (
        await axios.post(
          `${API_BASE}/p/${tenantId}/forms/${page.data!.form!.id}`,
          { pageId: page.data!.variantId, data, utm },
        )
      ).data;
    },
    onSuccess: (result: { message: string }) => setSent(result.message),
    onError: () => setError('Something went wrong. Please try again.'),
  });

  if (page.isError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-slate-600">
          This page may have been unpublished.
        </p>
      </main>
    );
  }

  const p = page.data;

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {!p ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            {p.blocks.map((block, i) => {
              if (block.type === 'heading') {
                return (
                  <h1
                    key={i}
                    className="mb-4 text-4xl font-bold leading-tight text-slate-900"
                  >
                    {block.text}
                  </h1>
                );
              }
              if (block.type === 'text') {
                return (
                  <p key={i} className="mb-6 text-lg leading-8 text-slate-600">
                    {block.text}
                  </p>
                );
              }
              if (block.type === 'image' && block.src) {
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={block.src}
                    alt={block.alt ?? ''}
                    className="mb-6 w-full rounded-2xl"
                  />
                );
              }
              if (block.type === 'button' && block.href) {
                return (
                  <a
                    key={i}
                    href={block.href}
                    className="mb-6 inline-block rounded-lg bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700"
                  >
                    {block.text ?? 'Continue'}
                  </a>
                );
              }
              if (block.type === 'form' && p.form) {
                return (
                  <div
                    key={i}
                    className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-6"
                  >
                    {sent ? (
                      <p className="text-slate-800">{sent}</p>
                    ) : (
                      <form
                        className="space-y-3"
                        onSubmit={(e: FormEvent<HTMLFormElement>) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          setError(null);
                          submit.mutate(
                            Object.fromEntries(
                              [...data.entries()].map(([k, v]) => [
                                k,
                                String(v),
                              ]),
                            ),
                          );
                        }}
                      >
                        {p.form.fields.map((field) => (
                          <div key={field.name}>
                            <label
                              htmlFor={field.name}
                              className="mb-1 block text-sm font-medium text-slate-700"
                            >
                              {field.label}
                              {field.required && (
                                <span className="text-red-500"> *</span>
                              )}
                            </label>
                            {field.type === 'textarea' ? (
                              <textarea
                                id={field.name}
                                name={field.name}
                                required={field.required}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              />
                            ) : (
                              <input
                                id={field.name}
                                name={field.name}
                                type={field.type}
                                required={field.required}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                              />
                            )}
                          </div>
                        ))}
                        {error && (
                          <p className="text-sm text-red-600">{error}</p>
                        )}
                        <button
                          type="submit"
                          disabled={submit.isPending}
                          className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          {submit.isPending ? 'Sending…' : 'Send'}
                        </button>
                      </form>
                    )}
                  </div>
                );
              }
              return null;
            })}

            <p className="mt-10 text-xs text-slate-400">{p.tenant.name}</p>
          </>
        )}
      </div>
    </main>
  );
}
