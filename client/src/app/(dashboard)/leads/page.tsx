'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  FunnelStep,
  Lead,
  LeadDetail,
  LeadSourceRow,
  LeadStatusValue,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const STATUSES: LeadStatusValue[] = [
  'NEW',
  'WORKING',
  'NURTURING',
  'QUALIFIED',
  'CONVERTED',
  'DISQUALIFIED',
];

const statusStyle: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  WORKING: 'bg-amber-100 text-amber-700',
  NURTURING: 'bg-indigo-100 text-indigo-700',
  QUALIFIED: 'bg-green-100 text-green-700',
  CONVERTED: 'bg-slate-100 text-slate-500',
  DISQUALIFIED: 'bg-red-100 text-red-700',
};

const touchLabel: Record<string, string> = {
  page_view: 'Looked at a page',
  form_submit: 'Filled in a form',
  campaign_send: 'Sent a campaign',
  email_open: 'Opened the email',
  email_click: 'Clicked a link',
};

export default function LeadsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leads = useQuery({
    queryKey: ['leads', status, search],
    queryFn: async () =>
      (
        await api.get<Lead[]>('/leads', {
          params: {
            ...(status ? { status } : {}),
            ...(search ? { search } : {}),
          },
        })
      ).data,
  });

  const funnel = useQuery({
    queryKey: ['marketing', 'funnel'],
    queryFn: async () =>
      (await api.get<FunnelStep[]>('/marketing/funnel')).data,
  });

  const sources = useQuery({
    queryKey: ['marketing', 'sources'],
    queryFn: async () =>
      (await api.get<LeadSourceRow[]>('/marketing/sources')).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['marketing'] });
  };

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<Lead>('/leads', body)).data,
    onSuccess: () => {
      setComposing(false);
      refresh();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save the lead'),
  });

  const columns: Column<Lead>[] = [
    {
      key: 'score',
      header: 'Score',
      render: (l) => (
        <span
          className={`font-semibold ${
            l.score >= 70
              ? 'text-green-700'
              : l.score >= 40
                ? 'text-amber-700'
                : 'text-slate-400'
          }`}
        >
          {l.score}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Lead',
      render: (l) => (
        <button
          className="text-left font-medium text-slate-800 hover:text-brand-700"
          onClick={() => setOpenId(l.id)}
        >
          {l.firstName} {l.lastName ?? ''}
          <span className="block text-xs text-slate-400">
            {l.email ?? l.phone ?? 'no contact details'}
          </span>
        </button>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      render: (l) => (
        <span className="text-sm text-slate-600">{l.company ?? '—'}</span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (l) => (
        <span className="text-xs text-slate-500">
          {l.source ?? 'unknown'}
          {l.utmSource && (
            <span className="block text-slate-400">via {l.utmSource}</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            statusStyle[l.status] ?? 'bg-slate-100'
          }`}
        >
          {l.status.toLowerCase()}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (l) => (
        <span className="text-sm text-slate-600">
          {l.owner ? `${l.owner.firstName} ${l.owner.lastName}` : 'Unassigned'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        action={
          <button
            onClick={() => {
              setError(null);
              setComposing(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New lead
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            From first touch to a deal
          </h2>
          {funnel.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="space-y-2">
              {funnel.data?.map((s) => (
                <li key={s.step}>
                  <div className="flex justify-between text-sm">
                    <span>{s.step}</span>
                    <span className="font-medium">
                      {s.count}
                      <span className="ml-2 text-xs text-slate-400">
                        {s.ofTotal}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-brand-500"
                      style={{ width: `${s.ofTotal}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Where leads come from
          </h2>
          {sources.data?.length === 0 && (
            <p className="text-sm text-slate-500">No leads yet.</p>
          )}
          <table className="w-full text-sm">
            <tbody>
              {sources.data?.map((s) => (
                <tr key={s.source} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">{s.source}</td>
                  <td className="py-2 text-right">{s.leads} leads</td>
                  <td className="py-2 text-right text-slate-500">
                    {s.conversionRate}% converted
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    avg score {s.averageScore}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads…"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={leads.data ?? []}
        loading={leads.isLoading}
        emptyText="No leads yet. Publish a landing page and they arrive here."
      />

      <Modal
        open={composing}
        title="New lead"
        onClose={() => setComposing(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            create.mutate({
              firstName: String(form.get('firstName')),
              lastName: String(form.get('lastName') || '') || undefined,
              email: String(form.get('email') || '') || undefined,
              phone: String(form.get('phone') || '') || undefined,
              company: String(form.get('company') || '') || undefined,
              jobTitle: String(form.get('jobTitle') || '') || undefined,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" />
          </div>
          <Field label="Email" name="email" type="email" />
          <Field label="Phone" name="phone" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" name="company" />
            <Field label="Job title" name="jobTitle" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Saving…' : 'Save lead'}
          </button>
        </form>
      </Modal>

      {openId && (
        <LeadModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function LeadModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lead = useQuery({
    queryKey: ['leads', id],
    queryFn: async () => (await api.get<LeadDetail>(`/leads/${id}`)).data,
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['leads', id] });
    onChanged();
  };

  const update = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.patch(`/leads/${id}`, body)).data,
    onSuccess: done,
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save'),
  });

  const convert = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post(`/leads/${id}/convert`, body)).data,
    onSuccess: () => {
      setConverting(false);
      done();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not convert'),
  });

  const l = lead.data;

  return (
    <Modal
      open
      wide
      title={l ? `${l.firstName} ${l.lastName ?? ''}` : 'Lead'}
      onClose={onClose}
    >
      {!l ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                statusStyle[l.status] ?? 'bg-slate-100'
              }`}
            >
              {l.status.toLowerCase()}
            </span>
            {l.status !== 'CONVERTED' && (
              <select
                value={l.status}
                onChange={(e) => update.mutate({ status: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                {STATUSES.filter((s) => s !== 'CONVERTED').map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-slate-400">
              {l.email ?? '—'} · {l.phone ?? '—'} · {l.company ?? '—'}
            </span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium text-slate-700">
              Score {l.score}
              <span className="ml-2 text-xs font-normal text-slate-500">
                and why
              </span>
            </p>
            <ul className="mt-2 space-y-1">
              {l.factors.map((f) => (
                <li key={f.label} className="flex justify-between text-xs">
                  <span className="text-slate-600">{f.label}</span>
                  <span className="font-medium text-slate-700">+{f.points}</span>
                </li>
              ))}
              {l.factors.length === 0 && (
                <li className="text-xs text-slate-500">
                  Nothing known about them yet.
                </li>
              )}
            </ul>
          </div>

          <div>
            <p className="mb-2 font-medium text-slate-700">What they have done</p>
            {l.touchpoints.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-1">
                {l.touchpoints.map((t) => (
                  <li key={t.id} className="flex justify-between text-xs">
                    <span>
                      {touchLabel[t.type] ?? t.type}
                      {t.page && (
                        <span className="text-slate-400"> · {t.page.title}</span>
                      )}
                      {t.campaign && (
                        <span className="text-slate-400">
                          {' '}
                          · {t.campaign.name}
                        </span>
                      )}
                    </span>
                    <span className="text-slate-400">
                      {new Date(t.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {l.status === 'CONVERTED' ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Converted. The lead is kept as the record of where this customer
              came from, and the trail now hangs off the contact.
            </p>
          ) : converting ? (
            <form
              className="space-y-3 rounded-lg border border-slate-200 p-3"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const title = String(form.get('dealTitle') || '');
                setError(null);
                convert.mutate({
                  ...(title ? { dealTitle: title } : {}),
                  ...(form.get('dealValue')
                    ? { dealValue: Number(form.get('dealValue')) }
                    : {}),
                });
              }}
            >
              <p className="text-xs text-slate-500">
                A contact is always created. An account is created from
                “{l.company ?? 'no company given'}” if one does not exist. A deal
                is created only if you name one.
              </p>
              <Field label="Deal title (optional)" name="dealTitle" />
              <Field
                label="Deal value (₹)"
                name="dealValue"
                type="number"
                min={0}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={convert.isPending}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {convert.isPending ? 'Converting…' : 'Convert'}
                </button>
                <button
                  type="button"
                  onClick={() => setConverting(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setConverting(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Convert to a contact
            </button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
