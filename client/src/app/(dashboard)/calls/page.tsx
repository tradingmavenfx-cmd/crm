'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Call, CallAnalytics, Paginated } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'COMPLETED', label: 'Answered' },
  { value: 'MISSED', label: 'Missed' },
  { value: 'VOICEMAIL', label: 'Voicemail' },
];

const statusStyle: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  IN_PROGRESS: 'bg-green-100 text-green-700',
  MISSED: 'bg-red-100 text-red-700',
  BUSY: 'bg-red-100 text-red-700',
  FAILED: 'bg-red-100 text-red-700',
  VOICEMAIL: 'bg-amber-100 text-amber-700',
  RINGING: 'bg-slate-100 text-slate-600',
  QUEUED: 'bg-slate-100 text-slate-600',
};

function duration(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function CallsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialOpen, setDialOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calls = useQuery({
    queryKey: ['voice', 'calls', status, page],
    queryFn: async () =>
      (
        await api.get<Paginated<Call>>('/voice/calls', {
          params: { page, limit: 20, ...(status ? { status } : {}) },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const analytics = useQuery({
    queryKey: ['voice', 'analytics'],
    queryFn: async () =>
      (await api.get<CallAnalytics>('/voice/analytics')).data,
    refetchInterval: 30_000,
  });

  const dial = useMutation({
    mutationFn: async (body: { to: string; agentNumber?: string }) =>
      (await api.post('/voice/calls', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice'] });
      setDialOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Call failed'),
  });

  const columns: Column<Call>[] = [
    {
      key: 'direction',
      header: 'Direction',
      render: (c) => (
        <span className="text-slate-500">
          {c.direction === 'INBOUND' ? '↓ In' : '↑ Out'}
        </span>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (c) =>
        c.contact ? `${c.contact.firstName} ${c.contact.lastName}` : '—',
    },
    {
      key: 'number',
      header: 'Number',
      render: (c) => (c.direction === 'INBOUND' ? c.from : c.to),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            statusStyle[c.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {c.status.toLowerCase().replace('_', ' ')}
        </span>
      ),
    },
    { key: 'durationSec', header: 'Duration', render: (c) => duration(c.durationSec) },
    {
      key: 'ivrPath',
      header: 'IVR keys',
      render: (c) =>
        c.ivrPath.length ? (
          <span className="text-slate-500">{c.ivrPath.join(' → ')}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'agent',
      header: 'Agent',
      render: (c) => (c.agent ? `${c.agent.firstName} ${c.agent.lastName}` : '—'),
    },
    {
      key: 'startedAt',
      header: 'When',
      render: (c) => new Date(c.startedAt).toLocaleString(),
    },
  ];

  const onDial = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await dial
      .mutateAsync({
        to: String(form.get('to')),
        agentNumber: (form.get('agentNumber') as string) || undefined,
      })
      .catch(() => undefined);
  };

  const a = analytics.data;

  return (
    <div>
      <PageHeader
        title="Calls"
        action={
          <button
            onClick={() => {
              setError(null);
              setDialOpen(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Click to call
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {analytics.isLoading || !a ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <Stat label="Total calls" value={a.total} />
            <Stat label="Answer rate" value={`${a.answerRate}%`} />
            <Stat label="Missed" value={a.missed} />
            <Stat label="Voicemails" value={a.voicemails} />
            <Stat label="Avg duration" value={duration(a.avgDurationSec)} />
          </>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              status === f.value
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={calls.data?.data ?? []}
        loading={calls.isLoading}
        emptyText="No calls logged yet."
        actions={(c) =>
          c.recordingUrl ? (
            <a
              href={c.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Recording
            </a>
          ) : null
        }
      />

      {calls.data && (
        <Pagination
          page={calls.data.meta.page}
          pages={calls.data.meta.pages}
          total={calls.data.meta.total}
          onPage={setPage}
        />
      )}

      {a && a.byAgent.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">
            Agent performance
          </h2>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Calls</th>
                  <th className="px-4 py-3 font-medium">Talk time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {a.byAgent.map((row) => (
                  <tr key={row.agentId ?? row.name}>
                    <td className="px-4 py-3">{row.name}</td>
                    <td className="px-4 py-3">{row.calls}</td>
                    <td className="px-4 py-3">{duration(row.talkTimeSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={dialOpen}
        title="Click to call"
        onClose={() => setDialOpen(false)}
      >
        <form onSubmit={onDial} className="space-y-4">
          <p className="text-sm text-slate-500">
            We ring your phone first, then connect the customer.
          </p>
          <Field
            label="Customer number (E.164)"
            name="to"
            placeholder="+919812345678"
            required
          />
          <Field
            label="Your number (optional)"
            name="agentNumber"
            placeholder="Defaults to the phone on your profile"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={dial.isPending}>
            Place call
          </Button>
        </form>
      </Modal>
    </div>
  );
}
