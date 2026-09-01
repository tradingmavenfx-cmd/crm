'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Campaign,
  CampaignPreview,
  CampaignStats,
  EmailStats,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const statusStyle: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const channelStyle: Record<string, string> = {
  EMAIL: 'bg-blue-100 text-blue-700',
  SMS: 'bg-purple-100 text-purple-700',
  WHATSAPP: 'bg-green-100 text-green-700',
};

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

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('EMAIL');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);

  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get<Campaign[]>('/campaigns')).data,
    refetchInterval: 15_000,
  });

  const emailStats = useQuery({
    queryKey: ['tracking', 'stats'],
    queryFn: async () => (await api.get<EmailStats>('/tracking/stats')).data,
  });

  const preview = useQuery({
    queryKey: ['campaigns', 'preview', selected?.id],
    queryFn: async () =>
      (await api.get<CampaignPreview>(`/campaigns/${selected!.id}/preview`)).data,
    enabled: Boolean(selected),
  });

  const stats = useQuery({
    queryKey: ['campaigns', 'stats', selected?.id],
    queryFn: async () =>
      (await api.get<CampaignStats>(`/campaigns/${selected!.id}/stats`)).data,
    enabled: Boolean(selected),
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/campaigns', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const send = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/campaigns/${id}/send`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/campaigns/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/campaigns/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const columns: Column<Campaign>[] = [
    { key: 'name', header: 'Name' },
    {
      key: 'channel',
      header: 'Channel',
      render: (c) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            channelStyle[c.channel] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {c.channel}
        </span>
      ),
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
          {c.status.toLowerCase()}
        </span>
      ),
    },
    {
      key: 'recipients',
      header: 'Recipients',
      render: (c) => c._count?.recipients ?? 0,
    },
    {
      key: 'scheduledAt',
      header: 'Scheduled',
      render: (c) =>
        c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : '—',
    },
  ];

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const minScore = String(form.get('minScore') || '');
    const scheduledAt = String(form.get('scheduledAt') || '');

    await save
      .mutateAsync({
        name: String(form.get('name')),
        channel,
        subject: String(form.get('subject') || '') || undefined,
        body: String(form.get('body') || '') || undefined,
        whatsappTemplateName:
          String(form.get('whatsappTemplateName') || '') || undefined,
        segment: minScore ? { minScore: Number(minScore) } : {},
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      })
      .catch(() => undefined);
  };

  const s = emailStats.data;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        action={
          <button
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New campaign
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {emailStats.isLoading || !s ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <Stat label="Emails sent" value={s.sent} />
            <Stat label="Open rate" value={`${s.openRate}%`} />
            <Stat label="Click rate" value={`${s.clickRate}%`} />
            <Stat label="Unique clicks" value={s.uniqueClicks} />
          </>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={campaigns.data ?? []}
        loading={campaigns.isLoading}
        emptyText="No campaigns yet."
        actions={(c) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setSelected(c)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Results
            </button>
            {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
              <button
                onClick={() => send.mutate(c.id)}
                disabled={send.isPending}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                Send now
              </button>
            )}
            {c.status === 'SCHEDULED' && (
              <button
                onClick={() => cancel.mutate(c.id)}
                className="text-sm text-slate-400 hover:text-amber-600"
              >
                Cancel
              </button>
            )}
            {c.status !== 'RUNNING' && (
              <button
                onClick={() => remove.mutate(c.id)}
                className="text-sm text-slate-400 hover:text-red-600"
              >
                Delete
              </button>
            )}
          </div>
        )}
      />

      {s && s.topLinks.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">
            Most clicked links
          </h2>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {s.topLinks.map((l) => (
                  <tr key={l.url}>
                    <td className="truncate px-4 py-3 text-slate-600">{l.url}</td>
                    <td className="w-24 px-4 py-3 text-right font-medium">
                      {l.clicks}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create */}
      <Modal open={open} title="New campaign" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Channel
            </span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
          </label>

          {channel === 'EMAIL' && (
            <Field label="Subject" name="subject" placeholder="Hi {{firstName}}" />
          )}

          {channel === 'WHATSAPP' ? (
            <Field
              label="Approved template name"
              name="whatsappTemplateName"
              placeholder="diwali_offer"
              required
            />
          ) : (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Body (supports {'{{firstName}}'}, {'{{fullName}}'})
              </span>
              <textarea
                name="body"
                rows={4}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          )}

          <Field
            label="Audience: minimum contact score (blank = everyone)"
            name="minScore"
            type="number"
            placeholder="50"
          />
          <Field
            label="Schedule for later (blank = send manually)"
            name="scheduledAt"
            type="datetime-local"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={save.isPending}>
            Create campaign
          </Button>
        </form>
      </Modal>

      {/* Results */}
      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.name} — results` : ''}
        onClose={() => setSelected(null)}
      >
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-medium text-slate-700">Audience</p>
            {preview.isLoading || !preview.data ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <p className="text-slate-500">
                {preview.data.reachable} reachable of {preview.data.total}
                {preview.data.unreachable > 0 &&
                  ` · ${preview.data.unreachable} without an address`}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 font-medium text-slate-700">Delivery</p>
            {stats.isLoading || !stats.data ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <ul className="space-y-1 text-slate-500">
                <li>Sent: {stats.data.sent}</li>
                <li>Skipped: {stats.data.skipped}</li>
                <li>Failed: {stats.data.failed}</li>
                <li>
                  Opened: {stats.data.opened} ({stats.data.openRate}%)
                </li>
                <li>
                  Clicked: {stats.data.clicked} ({stats.data.clickRate}%)
                </li>
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
