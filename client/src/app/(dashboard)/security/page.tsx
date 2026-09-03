'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  AuditEntry,
  ErasureReport,
  LoginAttemptRow,
  SecurityPolicy,
  UserSessionRow,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const when = (value: string) => new Date(value).toLocaleString();

const reasonLabel: Record<string, string> = {
  bad_password: 'Wrong password',
  unknown_user: 'No such account',
  unknown_workspace: 'No such workspace',
  inactive: 'Account is switched off',
  locked_out: 'Locked out',
  ip_not_allowed: 'Blocked by the IP allowlist',
};

export default function SecurityPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'sessions' | 'history' | 'audit' | 'data'>(
    'sessions',
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Security" />

      <div className="flex gap-4 border-b border-slate-200 text-sm">
        {(
          [
            ['sessions', 'Devices'],
            ['history', 'Sign-in history'],
            ['audit', 'Audit trail'],
            ['data', 'Data & policy'],
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

      {tab === 'sessions' && <Devices onChanged={() => qc.invalidateQueries()} />}
      {tab === 'history' && <SignInHistory />}
      {tab === 'audit' && <AuditTrail />}
      {tab === 'data' && <DataAndPolicy />}
    </div>
  );
}

function Devices({ onChanged }: { onChanged: () => void }) {
  const qc = useQueryClient();

  const sessions = useQuery({
    queryKey: ['security', 'sessions'],
    queryFn: async () =>
      (await api.get<UserSessionRow[]>('/security/sessions')).data,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/security/sessions/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['security', 'sessions'] });
      onChanged();
    },
  });

  const revokeAll = useMutation({
    mutationFn: async () =>
      (await api.post('/security/sessions/revoke-all', {})).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['security', 'sessions'] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Where your account is signed in. Signing out here ends that device
          straight away.
        </p>
        <button
          onClick={() => revokeAll.mutate()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          {revokeAll.isPending ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </div>

      {sessions.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className="space-y-2">
          {sessions.data?.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="font-medium text-slate-800">
                  {s.device ?? 'Unknown device'}
                  {s.revokedAt && (
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      signed out
                      {s.revokedReason ? ` · ${s.revokedReason}` : ''}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {s.ipAddress ?? 'unknown address'} · last used{' '}
                  {when(s.lastSeenAt)}
                </p>
              </div>
              {!s.revokedAt && (
                <button
                  onClick={() => revoke.mutate(s.id)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
          {sessions.data?.length === 0 && (
            <li className="text-sm text-slate-500">No devices recorded yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function SignInHistory() {
  const [email, setEmail] = useState('');

  const history = useQuery({
    queryKey: ['security', 'login-history', email],
    queryFn: async () =>
      (
        await api.get<LoginAttemptRow[]>('/security/login-history', {
          params: { ...(email ? { email } : {}), limit: 100 },
        })
      ).data,
  });

  return (
    <div className="space-y-3">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Filter by email…"
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">When</th>
              <th className="px-4 py-3 text-left font-medium">Account</th>
              <th className="px-4 py-3 text-left font-medium">Result</th>
              <th className="px-4 py-3 text-left font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-500">{when(a.createdAt)}</td>
                <td className="px-4 py-3">{a.email}</td>
                <td className="px-4 py-3">
                  {a.success ? (
                    <span className="text-green-700">Signed in</span>
                  ) : (
                    <span className="text-red-600">
                      {reasonLabel[a.reason ?? ''] ?? 'Failed'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a.ipAddress ?? '—'}
                </td>
              </tr>
            ))}
            {history.data?.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  Nothing recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTrail() {
  const [entityType, setEntityType] = useState('');

  const entries = useQuery({
    queryKey: ['security', 'audit', entityType],
    queryFn: async () =>
      (
        await api.get<AuditEntry[]>('/security/audit', {
          params: { ...(entityType ? { entityType } : {}), limit: 100 },
        })
      ).data,
  });

  return (
    <div className="space-y-3">
      <input
        value={entityType}
        onChange={(e) => setEntityType(e.target.value)}
        placeholder="Filter by record type, e.g. security_policy…"
        className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />

      <ul className="space-y-2">
        {entries.data?.map((e) => (
          <li
            key={e.id}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">
                {e.by} {e.action} a {e.entityType.replace(/_/g, ' ')}
              </p>
              <p className="text-xs text-slate-400">
                {when(e.createdAt)}
                {e.ipAddress ? ` · ${e.ipAddress}` : ''}
              </p>
            </div>
            {e.changes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {e.changes.map((c) => (
                  <li key={c.field} className="text-xs text-slate-600">
                    <span className="font-medium">{c.field}</span>:{' '}
                    <span className="text-slate-400">{String(c.from)}</span> →{' '}
                    <span>{String(c.to)}</span>
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(e.metadata).length > 0 && (
              <p className="mt-2 font-mono text-xs text-slate-500">
                {JSON.stringify(e.metadata)}
              </p>
            )}
          </li>
        ))}
        {entries.data?.length === 0 && (
          <li className="text-sm text-slate-500">Nothing recorded yet.</li>
        )}
      </ul>
    </div>
  );
}

function DataAndPolicy() {
  const qc = useQueryClient();
  const [erasing, setErasing] = useState(false);
  const [report, setReport] = useState<ErasureReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const policy = useQuery({
    queryKey: ['security', 'policy'],
    queryFn: async () => (await api.get<SecurityPolicy>('/security/policy')).data,
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.put('/security/policy', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security', 'policy'] }),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save the policy'),
  });

  const erase = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<ErasureReport>('/security/erase', body)).data,
    onSuccess: (result) => {
      setErasing(false);
      setReport(result);
      qc.invalidateQueries();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not erase that person'),
  });

  const download = () => {
    // The export is JSON on an authenticated endpoint, so it is fetched with
    // the API client and saved from memory rather than linked to.
    api.get('/security/export').then(({ data }) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `workspace-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  const p = policy.data;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-700">Sign-in policy</h2>
        {!p ? (
          <Skeleton className="mt-3 h-24" />
        ) : (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setError(null);
              save.mutate({
                ipAllowlist: String(form.get('ipAllowlist') || '')
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                maxFailedAttempts: Number(form.get('maxFailedAttempts')),
                lockoutMinutes: Number(form.get('lockoutMinutes')),
                sessionDays: Number(form.get('sessionDays')),
              });
            }}
          >
            <Field
              label="Allowed networks (IPs or CIDR, comma separated)"
              name="ipAllowlist"
              defaultValue={p.ipAllowlist.join(', ')}
              placeholder="Leave empty to allow sign-in from anywhere"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Failures before lockout"
                name="maxFailedAttempts"
                type="number"
                min={1}
                max={50}
                defaultValue={p.maxFailedAttempts}
              />
              <Field
                label="Lockout minutes"
                name="lockoutMinutes"
                type="number"
                min={1}
                max={1440}
                defaultValue={p.lockoutMinutes}
              />
              <Field
                label="Stay signed in (days)"
                name="sessionDays"
                type="number"
                min={1}
                max={365}
                defaultValue={p.sessionDays}
              />
            </div>
            <p className="text-xs text-slate-500">
              An address that is not allowed is refused before the password is
              checked, so a blocked network cannot be used to test passwords.
            </p>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save policy'}
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-700">
          Export and erasure
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Everything this workspace holds, as one file — without password
          hashes, tokens or storage keys.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={download}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download workspace export
          </button>
          <button
            onClick={() => {
              setReport(null);
              setError(null);
              setErasing(true);
            }}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Erase a person
          </button>
        </div>

        {report && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800">Erased.</p>
            <p className="mt-1 text-slate-600">
              {report.contacts} contact{report.contacts === 1 ? '' : 's'},{' '}
              {report.leads} lead{report.leads === 1 ? '' : 's'},{' '}
              {report.messages} message{report.messages === 1 ? '' : 's'},{' '}
              {report.portalSessions} portal session
              {report.portalSessions === 1 ? '' : 's'} ended.
            </p>
          </div>
        )}
      </section>

      <Modal
        open={erasing}
        title="Erase a person"
        onClose={() => setErasing(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            erase.mutate({
              email: String(form.get('email')),
              reason: String(form.get('reason') || '') || undefined,
              confirm: true,
            });
          }}
        >
          <p className="text-sm text-slate-600">
            Their name, email, phone and message bodies are overwritten. The
            deals, invoices and tickets they are attached to are kept — a
            business has to keep those, and deleting the person would take them
            with it.
          </p>
          <Field label="Email address" name="email" type="email" required />
          <Field label="Why (kept in the audit trail)" name="reason" />
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            This cannot be undone.
          </p>
          <button
            type="submit"
            disabled={erase.isPending}
            className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {erase.isPending ? 'Erasing…' : 'Erase this person'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
