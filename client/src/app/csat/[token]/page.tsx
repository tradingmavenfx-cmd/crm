'use client';

import { FormEvent, use, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { CsatSurvey } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

/**
 * The post-resolution survey. Reached only by its token, so it uses a bare
 * axios call rather than the authenticated API client.
 */
export default function CsatPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [rating, setRating] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const survey = useQuery({
    queryKey: ['csat', token],
    queryFn: async () =>
      (await axios.get<CsatSurvey>(`${API_BASE}/csat/${token}`)).data,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async (body: { rating: number; comment?: string }) =>
      (await axios.post(`${API_BASE}/csat/${token}`, body)).data,
    onSuccess: () => setSent(true),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not record your rating'),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!rating) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    submit.mutate({
      rating,
      comment: String(form.get('comment') || '') || undefined,
    });
  };

  if (survey.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </main>
    );
  }

  if (survey.isError || !survey.data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Survey not available</h1>
          <p className="mt-2 text-sm text-slate-500">
            This link may have expired, or the ticket may still be open.
          </p>
        </div>
      </main>
    );
  }

  const s = survey.data;
  const finished = sent || s.alreadyRated;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">{s.tenant.name}</p>
        <h1 className="mt-1 text-xl font-bold">How did we do?</h1>
        <p className="mt-2 text-sm text-slate-500">
          {s.number} — {s.subject}
        </p>

        {finished ? (
          <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            Thanks for the feedback
            {s.csatRating ? ` — you rated us ${s.csatRating}/5.` : '.'}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className={`h-12 w-12 rounded-full border text-lg transition ${
                    rating && n <= rating
                      ? 'border-amber-400 bg-amber-100 text-amber-600'
                      : 'border-slate-200 text-slate-300 hover:border-slate-300'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              name="comment"
              rows={3}
              placeholder="Anything you would like to add? (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={!rating || submit.isPending}
              className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submit.isPending ? 'Sending…' : 'Send feedback'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
