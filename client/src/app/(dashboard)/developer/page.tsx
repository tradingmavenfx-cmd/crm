'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiKeyRow, WebhookDeliveryRow, WebhookRow } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const statusStyle: Record<string, string> = {
  delivered: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

export default function DeveloperPage() {
  const [tab, setTab] = useState<'keys' | 'webhooks' | 'deliveries'>('keys');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer"
        action={
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            API reference
          </a>
        }
      />

      <div className="flex gap-4 border-b border-slate-200 text-sm">
        {(
          [
            ['keys', 'API keys'],
            ['webhooks', 'Webhooks'],
            ['deliveries', 'Deliveries'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-2 ${
              tab === key
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'keys' && <Keys />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'deliveries' && <Deliveries />}
    </div>
  );
}

function Keys() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ['developer', 'keys'],
    queryFn: async () => (await api.get<ApiKeyRow[]>('/developer/keys')).data,
  });

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<{ key: string }>('/developer/keys', body)).data,
    onSuccess: (result) => {
      setCreating(false);
      setIssued(result.key);
      qc.invalidateQueries({ queryKey: ['developer', 'keys'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not create the key'),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/developer/keys/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['developer', 'keys'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          A key authenticates a program rather than a person. Send it as{' '}
          <code className="rounded bg-slate-100 px-1">X-API-Key</code> or as{' '}
          <code className="rounded bg-slate-100 px-1">
            Authorization: Bearer crm_…
          </code>
          . What a key may do is decided by its scopes: the scope needed is the
          first path segment plus <code>read</code> for GET and{' '}
          <code>write</code> for anything else.
        </p>
        <button
          onClick={() => {
            setError(null);
            setIssued(null);
            setCreating(true);
          }}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New key
        </button>
      </div>

      {issued && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-900">
            Copy this now — it is shown once and cannot be recovered.
          </p>
          <p className="mt-2 break-all font-mono text-sm text-slate-800">
            {issued}
          </p>
          <button
            onClick={() => navigator.clipboard?.writeText(issued)}
            className="mt-2 text-sm text-brand-700 hover:underline"
          >
            Copy
          </button>
        </div>
      )}

      {keys.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className="space-y-2">
          {keys.data?.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="font-medium text-slate-800">
                  {k.name}
                  {k.revokedAt && (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      revoked
                    </span>
                  )}
                </p>
                <p className="font-mono text-xs text-slate-400">{k.prefix}…</p>
                <p className="mt-1 text-xs text-slate-500">
                  {k.scopes.join(', ')} · {k.rateLimitPerMinute}/min ·{' '}
                  {k.requestCount} request{k.requestCount === 1 ? '' : 's'} ·
                  last used {when(k.lastUsedAt)}
                </p>
              </div>
              {!k.revokedAt && (
                <button
                  onClick={() => revoke.mutate(k.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
          {keys.data?.length === 0 && (
            <li className="text-sm text-slate-500">No keys yet.</li>
          )}
        </ul>
      )}

      <Modal open={creating} title="New API key" onClose={() => setCreating(false)}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const scopes = String(form.get('scopes') || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            setError(null);
            create.mutate({
              name: String(form.get('name')),
              ...(scopes.length ? { scopes } : {}),
              rateLimitPerMinute: Number(form.get('rateLimitPerMinute')),
            });
          }}
        >
          <Field label="What is it for" name="name" required />
          <Field
            label="Scopes (comma separated, blank for full access)"
            name="scopes"
            placeholder="contacts:read, deals:write"
          />
          <Field
            label="Requests a minute"
            name="rateLimitPerMinute"
            type="number"
            min={1}
            max={6000}
            defaultValue={120}
          />
          <p className="text-xs text-slate-500">
            A key can never be used on <code>/auth</code> or{' '}
            <code>/security</code>, whatever its scopes.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Creating…' : 'Create key'}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webhooks = useQuery({
    queryKey: ['developer', 'webhooks'],
    queryFn: async () =>
      (await api.get<WebhookRow[]>('/developer/webhooks')).data,
  });

  const events = useQuery({
    queryKey: ['developer', 'events'],
    queryFn: async () => (await api.get<string[]>('/developer/events')).data,
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['developer', 'webhooks'] });

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<{ secret: string }>('/developer/webhooks', body)).data,
    onSuccess: (result) => {
      setCreating(false);
      setSecret(result.secret);
      refresh();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save the webhook'),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      (await api.patch(`/developer/webhooks/${id}`, { isActive: on })).data,
    onSuccess: refresh,
  });

  const test = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/developer/webhooks/${id}/test`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['developer'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/developer/webhooks/${id}`)).data,
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Every delivery is signed. Check{' '}
          <code className="rounded bg-slate-100 px-1">X-CRM-Signature</code>{' '}
          against an HMAC-SHA256 of{' '}
          <code className="rounded bg-slate-100 px-1">timestamp.body</code> using
          the signing secret, and reject anything whose{' '}
          <code className="rounded bg-slate-100 px-1">X-CRM-Timestamp</code> is
          not recent — that is what stops a captured delivery being replayed.
        </p>
        <button
          onClick={() => {
            setError(null);
            setSecret(null);
            setCreating(true);
          }}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + New webhook
        </button>
      </div>

      {secret && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-medium text-brand-900">
            Signing secret — shown once.
          </p>
          <p className="mt-2 break-all font-mono text-sm text-slate-800">
            {secret}
          </p>
          <button
            onClick={() => navigator.clipboard?.writeText(secret)}
            className="mt-2 text-sm text-brand-700 hover:underline"
          >
            Copy
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {webhooks.data?.map((w) => (
          <li
            key={w.id}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-800">
                  {w.name}
                  {!w.isActive && (
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      off
                      {w.disabledReason ? ` · ${w.disabledReason}` : ''}
                    </span>
                  )}
                </p>
                <p className="font-mono text-xs text-slate-400">{w.url}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {w.events.join(', ')} · {w._count.deliveries} deliver
                  {w._count.deliveries === 1 ? 'y' : 'ies'} · last{' '}
                  {when(w.lastDeliveryAt)}
                  {w.consecutiveFailures > 0 &&
                    ` · ${w.consecutiveFailures} failing in a row`}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button
                  onClick={() => test.mutate(w.id)}
                  className="text-brand-700 hover:underline"
                >
                  {test.isPending ? 'Sending…' : 'Send a test'}
                </button>
                <button
                  onClick={() => toggle.mutate({ id: w.id, on: !w.isActive })}
                  className="text-slate-600 hover:underline"
                >
                  {w.isActive ? 'Turn off' : 'Turn on'}
                </button>
                <button
                  onClick={() => remove.mutate(w.id)}
                  className="text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
        {webhooks.data?.length === 0 && (
          <li className="text-sm text-slate-500">Nothing subscribed yet.</li>
        )}
      </ul>

      <Modal
        open={creating}
        wide
        title="New webhook"
        onClose={() => setCreating(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const chosen = form.getAll('events').map(String);
            setError(null);
            if (chosen.length === 0) {
              setError('Choose at least one event');
              return;
            }
            create.mutate({
              name: String(form.get('name')),
              url: String(form.get('url')),
              events: chosen,
            });
          }}
        >
          <Field label="Name" name="name" required />
          <Field
            label="URL"
            name="url"
            type="url"
            required
            placeholder="https://example.com/hooks/crm"
          />
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">
              Send these events
            </p>
            <div className="grid gap-1 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              {events.data?.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input type="checkbox" name="events" value={event} />
                  <span className="font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Saving…' : 'Create webhook'}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function Deliveries() {
  const qc = useQueryClient();

  const deliveries = useQuery({
    queryKey: ['developer', 'deliveries'],
    queryFn: async () =>
      (await api.get<WebhookDeliveryRow[]>('/developer/deliveries')).data,
    refetchInterval: 15_000,
  });

  const replay = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/developer/deliveries/${id}/replay`, {})).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['developer', 'deliveries'] }),
  });

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Event</th>
            <th className="px-4 py-3 text-left font-medium">Destination</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Attempts</th>
            <th className="px-4 py-3 text-left font-medium">When</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {deliveries.data?.map((d) => (
            <tr key={d.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3 font-mono text-xs">{d.event}</td>
              <td className="px-4 py-3">{d.webhook?.name ?? '—'}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    statusStyle[d.status] ?? 'bg-slate-100'
                  }`}
                >
                  {d.status}
                </span>
                {d.error && (
                  <span className="ml-2 text-xs text-slate-400">{d.error}</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">{d.attempts}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {when(d.deliveredAt ?? d.createdAt)}
                {d.nextAttemptAt && (
                  <span className="block text-amber-700">
                    next try {when(d.nextAttemptAt)}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => replay.mutate(d.id)}
                  className="text-sm text-brand-700 hover:underline"
                >
                  Replay
                </button>
              </td>
            </tr>
          ))}
          {deliveries.data?.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-sm text-slate-500"
              >
                Nothing sent yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
