'use client';

import { Suspense, use, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { HelpArticle } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default function HelpArticlePage({
  params,
}: {
  params: Promise<{ tenantId: string; slug: string }>;
}) {
  const { tenantId, slug } = use(params);
  return (
    <Suspense fallback={<p className="p-10 text-sm text-slate-500">Loading…</p>}>
      <ArticleView tenantId={tenantId} slug={slug} />
    </Suspense>
  );
}

function ArticleView({ tenantId, slug }: { tenantId: string; slug: string }) {
  const locale = useSearchParams().get('locale') ?? 'en';
  const [voted, setVoted] = useState<boolean | null>(null);
  const [commenting, setCommenting] = useState(false);

  const article = useQuery({
    queryKey: ['help', tenantId, slug, locale],
    queryFn: async () =>
      (
        await axios.get<HelpArticle>(`${API_BASE}/help/${tenantId}/${slug}`, {
          params: { locale },
        })
      ).data,
    retry: false,
  });

  const vote = useMutation({
    mutationFn: async (body: { helpful: boolean; comment?: string }) =>
      (
        await axios.post(
          `${API_BASE}/help/${tenantId}/${slug}/feedback`,
          body,
          { params: { locale } },
        )
      ).data,
  });

  if (article.isError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Article not found</h1>
        <p className="mt-2 text-slate-600">
          It may have been unpublished or moved.
        </p>
        <Link
          href={`/help/${tenantId}`}
          className="mt-4 inline-block text-sm text-brand-700 hover:underline"
        >
          Back to the help centre
        </Link>
      </main>
    );
  }

  const a = article.data;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Link
            href={`/help/${tenantId}`}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← {a?.tenant.name ?? 'Help centre'}
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-10">
        {article.isLoading || !a ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            {a.category && (
              <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                {a.category.name}
              </p>
            )}
            <h1 className="mt-2 text-3xl font-bold text-slate-900">{a.title}</h1>
            <p className="mt-2 text-xs text-slate-400">
              Updated {new Date(a.updatedAt).toLocaleDateString()}
            </p>

            {/* Article bodies are plain text written by agents, so they are
                rendered as text with paragraph breaks — never as HTML. */}
            <div className="mt-6 space-y-4 text-[15px] leading-7 text-slate-700">
              {a.body.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {para}
                </p>
              ))}
            </div>

            {a.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {a.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {a.translations.length > 0 && (
              <div className="mt-6 text-sm">
                <span className="text-slate-500">Also available in: </span>
                {a.translations.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/help/${tenantId}/${t.slug}?locale=${t.locale}`}
                    className="mr-3 text-brand-700 hover:underline"
                  >
                    {t.title}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-5">
              {vote.isSuccess ? (
                <p className="text-sm text-slate-600">
                  Thanks — that helps us decide what to rewrite.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-700">
                    Did this answer your question?
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        setVoted(true);
                        vote.mutate({ helpful: true });
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => {
                        setVoted(false);
                        setCommenting(true);
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                    >
                      No
                    </button>
                  </div>

                  {commenting && voted === false && (
                    <form
                      className="mt-4 space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        vote.mutate({
                          helpful: false,
                          comment:
                            String(form.get('comment') || '') || undefined,
                        });
                      }}
                    >
                      <textarea
                        name="comment"
                        rows={3}
                        placeholder="What were you looking for?"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        Send
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </article>
    </main>
  );
}
