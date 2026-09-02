'use client';

import { FormEvent, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  PORTAL_API,
  portalApi,
  portalSession,
} from '@/lib/portal';
import {
  PortalAccount,
  PortalInvoice,
  PortalQuote,
  PortalTicket,
  PortalTicketDetail,
} from '@/types';

const statusStyle: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-slate-100 text-slate-600',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};

/**
 * The customer portal. Signed in with a link emailed to the customer, so this
 * page never asks for or handles a password.
 */
export default function PortalPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Read on the client only: the server has no idea whether there is a session.
  useEffect(() => {
    setSignedIn(Boolean(portalSession.get(tenantId)));
  }, [tenantId]);

  if (signedIn === null) return null;

  return signedIn ? (
    <SignedIn tenantId={tenantId} onSignOut={() => setSignedIn(false)} />
  ) : (
    <SignIn tenantId={tenantId} />
  );
}

// ── Signing in ─────────────────────────────────

function SignIn({ tenantId }: { tenantId: string }) {
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: async (email: string) =>
      (
        await axios.post(`${PORTAL_API}/portal/${tenantId}/request-link`, {
          email,
        })
      ).data,
    onSuccess: () => setSent(true),
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8">
        <h1 className="text-2xl font-bold text-slate-900">Your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Track your requests, replies and quotes.
        </p>

        {sent ? (
          <div className="mt-6 rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-700">
            <p className="font-medium">Check your email.</p>
            <p className="mt-1 text-slate-600">
              If that address is on file, a sign-in link is on its way. It works
              once and expires in 15 minutes.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-3 text-sm text-brand-700 hover:underline"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              request.mutate(String(form.get('email')));
            }}
          >
            <div>
              <label
                htmlFor="portal-email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email address
              </label>
              <input
                id="portal-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={request.isPending}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {request.isPending ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <p className="text-xs text-slate-500">
              No password needed — we send a one-time link instead.
            </p>
          </form>
        )}

        <Link
          href={`/help/${tenantId}`}
          className="mt-6 block text-sm text-brand-700 hover:underline"
        >
          Browse the help centre instead →
        </Link>
      </div>
    </main>
  );
}

// ── Signed in ──────────────────────────────────

function SignedIn({
  tenantId,
  onSignOut,
}: {
  tenantId: string;
  onSignOut: () => void;
}) {
  const qc = useQueryClient();
  const api = portalApi(tenantId);
  const [tab, setTab] = useState<'requests' | 'quotes'>('requests');
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const account = useQuery({
    queryKey: ['portal', tenantId, 'me'],
    queryFn: async () => (await api.get<PortalAccount>('/portal/me')).data,
    retry: false,
  });

  const tickets = useQuery({
    queryKey: ['portal', tenantId, 'tickets'],
    queryFn: async () =>
      (await api.get<PortalTicket[]>('/portal/tickets')).data,
    enabled: account.isSuccess,
  });

  const quotes = useQuery({
    queryKey: ['portal', tenantId, 'quotes'],
    queryFn: async () => (await api.get<PortalQuote[]>('/portal/quotes')).data,
    enabled: account.isSuccess && tab === 'quotes',
  });

  const invoices = useQuery({
    queryKey: ['portal', tenantId, 'invoices'],
    queryFn: async () =>
      (await api.get<PortalInvoice[]>('/portal/invoices')).data,
    enabled: account.isSuccess && tab === 'quotes',
  });

  const signOut = () => {
    api.post('/portal/logout').catch(() => undefined);
    portalSession.clear(tenantId);
    qc.removeQueries({ queryKey: ['portal', tenantId] });
    onSignOut();
  };

  // An expired or revoked session drops back to the sign-in screen rather than
  // leaving an empty page behind.
  useEffect(() => {
    if (account.isError) {
      portalSession.clear(tenantId);
      onSignOut();
    }
  }, [account.isError, tenantId, onSignOut]);

  const raise = useMutation({
    mutationFn: async (body: { subject: string; description: string }) =>
      (await api.post<{ id: string }>('/portal/tickets', body)).data,
    onSuccess: (created) => {
      setComposing(false);
      qc.invalidateQueries({ queryKey: ['portal', tenantId, 'tickets'] });
      setOpenId(created.id);
    },
  });

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-semibold text-slate-900">
              {account.data?.tenant ?? 'Your account'}
            </p>
            {account.data && (
              <p className="text-xs text-slate-500">
                {account.data.firstName} {account.data.lastName}
                {account.data.company ? ` · ${account.data.company}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={signOut}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex gap-4 text-sm">
            {(['requests', 'quotes'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setOpenId(null);
                }}
                className={`capitalize ${
                  tab === t
                    ? 'font-medium text-brand-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
            <Link
              href={`/help/${tenantId}`}
              className="text-slate-500 hover:text-slate-700"
            >
              Help centre
            </Link>
          </div>
          {tab === 'requests' && (
            <button
              onClick={() => setComposing(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              New request
            </button>
          )}
        </div>

        {composing && (
          <form
            className="mb-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              raise.mutate({
                subject: String(form.get('subject')),
                description: String(form.get('description')),
              });
            }}
          >
            <p className="font-medium text-slate-800">What can we help with?</p>
            <input
              name="subject"
              required
              maxLength={200}
              placeholder="Short summary"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              name="description"
              required
              rows={5}
              placeholder="Tell us what happened, and what you expected instead."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={raise.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {raise.isPending ? 'Sending…' : 'Send request'}
              </button>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {tab === 'requests' &&
          (openId ? (
            <TicketThread
              tenantId={tenantId}
              id={openId}
              onBack={() => setOpenId(null)}
            />
          ) : (
            <ul className="space-y-3">
              {tickets.data?.length === 0 && !composing && (
                <li className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                  Nothing open. Raise a request and it lands straight with the
                  support team.
                </li>
              )}
              {tickets.data?.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setOpenId(t.id)}
                    className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-300"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-900">
                        {t.subject}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          statusStyle[t.status] ?? 'bg-slate-100'
                        }`}
                      >
                        {t.status.toLowerCase().replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {t.number} · raised{' '}
                      {new Date(t.createdAt).toLocaleDateString()}
                      {t.category ? ` · ${t.category}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'quotes' && (
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                Quotes
              </h2>
              {quotes.data?.length === 0 && (
                <p className="text-sm text-slate-500">
                  No quotes have been sent to you yet.
                </p>
              )}
              <ul className="space-y-2">
                {quotes.data?.map((q) => (
                  <li
                    key={q.number}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{q.number}</p>
                      <p className="text-xs text-slate-500">
                        {q.status.toLowerCase()}
                        {q.validUntil
                          ? ` · valid until ${new Date(
                              q.validUntil,
                            ).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {q.currency} {Number(q.total).toLocaleString('en-IN')}
                      </p>
                      <a
                        href={q.path}
                        className="text-xs text-brand-700 hover:underline"
                      >
                        Open quote
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                Invoices
              </h2>
              {invoices.data?.length === 0 && (
                <p className="text-sm text-slate-500">Nothing raised yet.</p>
              )}
              <ul className="space-y-2">
                {invoices.data?.map((inv) => (
                  <li
                    key={inv.number}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{inv.number}</p>
                      <p className="text-xs text-slate-500">
                        {inv.status.toLowerCase()}
                        {inv.dueAt
                          ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    <p className="font-semibold">
                      {inv.currency} {Number(inv.total).toLocaleString('en-IN')}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

/** One request and its conversation. */
function TicketThread({
  tenantId,
  id,
  onBack,
}: {
  tenantId: string;
  id: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const api = portalApi(tenantId);

  const ticket = useQuery({
    queryKey: ['portal', tenantId, 'ticket', id],
    queryFn: async () =>
      (await api.get<PortalTicketDetail>(`/portal/tickets/${id}`)).data,
  });

  const reply = useMutation({
    mutationFn: async (body: string) =>
      (await api.post(`/portal/tickets/${id}/comments`, { body })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', tenantId] });
    },
  });

  const t = ticket.data;

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 text-sm text-slate-500 hover:text-slate-700"
      >
        ← All requests
      </button>

      {!t ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {t.subject}
              </h1>
              <p className="text-xs text-slate-400">
                {t.number} · raised {new Date(t.createdAt).toLocaleString()}
                {t.assignee ? ` · with ${t.assignee.firstName}` : ''}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                statusStyle[t.status] ?? 'bg-slate-100'
              }`}
            >
              {t.status.toLowerCase().replace('_', ' ')}
            </span>
          </div>

          {t.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
              {t.description}
            </p>
          )}

          <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
            {t.comments.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg px-3 py-2 text-sm ${
                  c.mine
                    ? 'ml-8 bg-brand-50 text-slate-800'
                    : 'mr-8 bg-slate-50 text-slate-800'
                }`}
              >
                <p className="text-xs font-medium text-slate-500">{c.from}</p>
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <form
            className="mt-4 space-y-2"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              const body = String(data.get('body') || '').trim();
              if (!body) return;
              reply.mutate(body);
              form.reset();
            }}
          >
            <textarea
              name="body"
              rows={3}
              placeholder={
                t.status === 'RESOLVED' || t.status === 'CLOSED'
                  ? 'Still not right? Reply and this request reopens.'
                  : 'Add to this request…'
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={reply.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {reply.isPending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
