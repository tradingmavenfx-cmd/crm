'use client';

import { FormEvent, use, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { PublicQuote } from '@/types';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const money = (value: string | number) =>
  Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * The customer-facing quote. Reached only by its unguessable token, so it uses
 * a bare axios call rather than the authenticated API client.
 */
export default function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quote = useQuery({
    queryKey: ['public-quote', token],
    queryFn: async () =>
      (await axios.get<PublicQuote>(`${API_BASE}/q/${token}`)).data,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async (body: { name: string; email?: string }) =>
      (await axios.post(`${API_BASE}/q/${token}/accept`, body)).data,
    onSuccess: () => setDone('accepted'),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not accept this quote'),
  });

  const decline = useMutation({
    mutationFn: async () =>
      (await axios.post(`${API_BASE}/q/${token}/decline`, {})).data,
    onSuccess: () => setDone('declined'),
  });

  const onAccept = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    accept.mutate({
      name: String(form.get('name')),
      email: String(form.get('email') || '') || undefined,
    });
  };

  if (quote.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </main>
    );
  }

  if (quote.isError || !quote.data) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Quote not available</h1>
          <p className="mt-2 text-sm text-slate-500">
            This link may have expired, or the quote may have been withdrawn.
          </p>
        </div>
      </main>
    );
  }

  const q = quote.data;
  const closed = done ?? (q.status === 'ACCEPTED' ? 'accepted' : null);
  const open = q.status === 'SENT' && !q.expired && !done;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 print:bg-white">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-500">{q.tenant.name}</p>
            <h1 className="text-2xl font-bold">Quote {q.number}</h1>
          </div>
          <div className="text-right text-sm text-slate-500">
            {q.company?.name && <p>{q.company.name}</p>}
            {q.contact && (
              <p>
                {q.contact.firstName} {q.contact.lastName}
              </p>
            )}
            {q.validUntil && (
              <p className="mt-1">
                Valid until {new Date(q.validUntil).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {q.expired && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This quote passed its validity date. Ask your contact for a fresh
            one.
          </p>
        )}

        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Disc</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2">
                  <p className="font-medium">{line.name}</p>
                  {line.description && (
                    <p className="text-xs text-slate-500">{line.description}</p>
                  )}
                </td>
                <td className="py-2 text-right">{Number(line.quantity)}</td>
                <td className="py-2 text-right">{money(line.unitPrice)}</td>
                <td className="py-2 text-right">
                  {Number(line.discountPercent)
                    ? `${Number(line.discountPercent)}%`
                    : '—'}
                </td>
                <td className="py-2 text-right">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-right text-sm">
          <p>Subtotal: {money(q.subtotal)}</p>
          {Number(q.discountAmount) > 0 && (
            <p className="text-green-700">
              Discount: −{money(q.discountAmount)}
            </p>
          )}
          <p>GST: {money(q.taxAmount)}</p>
          <p className="text-xl font-bold">
            Total: {money(q.total)} {q.currency}
          </p>
        </div>

        {q.notes && (
          <p className="mt-6 whitespace-pre-line text-sm text-slate-600">
            {q.notes}
          </p>
        )}
        {q.terms && (
          <p className="mt-4 whitespace-pre-line text-xs text-slate-400">
            {q.terms}
          </p>
        )}

        {closed === 'accepted' && (
          <div className="mt-8 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            Thank you — this quote has been accepted. Your contact will follow up
            with the paperwork.
          </div>
        )}

        {done === 'declined' && (
          <div className="mt-8 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            Thanks for letting us know. We have recorded your decision.
          </div>
        )}

        {open && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <h2 className="text-sm font-semibold">Accept this quote</h2>
            <p className="mt-1 text-xs text-slate-500">
              Typing your name records your acceptance of the amounts above,
              with the date and time.
            </p>
            <form onSubmit={onAccept} className="mt-3 flex flex-wrap gap-2">
              <input
                name="name"
                placeholder="Your full name"
                required
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <input
                name="email"
                type="email"
                placeholder="Email (optional)"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                type="submit"
                disabled={accept.isPending}
                className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => decline.mutate()}
                disabled={decline.isPending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Decline
              </button>
            </form>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
