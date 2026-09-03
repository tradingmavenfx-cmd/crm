'use client';

import { FormEvent, use, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { SharedDocument } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const kb = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * A document somebody was sent a link to. Reached only by its token, so it
 * talks to the API with a bare axios call.
 */
export default function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef(Date.now());

  const document = useQuery({
    queryKey: ['shared-document', token],
    queryFn: async () =>
      (await axios.get<SharedDocument>(`${API_BASE}/d/${token}`)).data,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Tells the sender how long the document was actually open. Sent on the way
  // out, because that is the only moment the answer is known.
  useEffect(() => {
    const report = () => {
      const seconds = Math.round((Date.now() - openedAt.current) / 1000);
      if (seconds < 2) return;
      navigator.sendBeacon?.(
        `${API_BASE}/d/${token}/reading-time`,
        new Blob([JSON.stringify({ seconds })], { type: 'application/json' }),
      );
    };
    window.addEventListener('pagehide', report);
    return () => {
      window.removeEventListener('pagehide', report);
      report();
    };
  }, [token]);

  const sign = useMutation({
    mutationFn: async (body: { name: string; email?: string }) =>
      (await axios.post(`${API_BASE}/d/${token}/sign`, body)).data,
    onSuccess: () => document.refetch(),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not record your name'),
  });

  if (document.isError) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link is no longer available</h1>
        <p className="mt-2 text-slate-600">
          It may have been withdrawn or have expired. Ask whoever sent it for a
          new one.
        </p>
      </main>
    );
  }

  const d = document.data;
  const canDownload = d && (!d.requireSignature || d.signed);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-6 py-16">
        {!d ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Shared by {d.sharedBy}
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">{d.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {kb(d.size)} · {d.mimeType}
              {d.expiresAt &&
                ` · link expires ${new Date(d.expiresAt).toLocaleDateString()}`}
            </p>

            {d.requireSignature && !d.signed && (
              <form
                className="mt-6 space-y-3 rounded-lg bg-slate-50 p-4"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  setError(null);
                  sign.mutate({
                    name: String(form.get('name')),
                    email: String(form.get('email') || '') || undefined,
                  });
                }}
              >
                <p className="text-sm text-slate-700">
                  Please put your name to this document before downloading it.
                </p>
                <div>
                  <label
                    htmlFor="sign-name"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Your full name
                  </label>
                  <input
                    id="sign-name"
                    name="name"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sign-email"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Email (optional)
                  </label>
                  <input
                    id="sign-email"
                    name="email"
                    type="email"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={sign.isPending}
                  className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {sign.isPending ? 'Recording…' : 'Accept and continue'}
                </button>
                <p className="text-xs text-slate-500">
                  This records that you accepted this version, with the date and
                  time. It is an acceptance record, not a certified electronic
                  signature.
                </p>
              </form>
            )}

            {d.signed && (
              <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                Accepted{d.signedName ? ` by ${d.signedName}` : ''}.
              </p>
            )}

            {canDownload && (
              <a
                href={`${API_BASE}/d/${token}/file`}
                className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700"
              >
                Download {d.name}
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
