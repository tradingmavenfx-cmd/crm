'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Ticket,
  TicketDetail,
  TicketRule,
  TicketStats,
  TenantUser,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const STATUSES = ['OPEN', 'PENDING', 'ON_HOLD', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const priorityStyle: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-slate-100 text-slate-600',
};

const statusStyle: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-slate-100 text-slate-600',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-500',
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

export default function TicketsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Ticket | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tickets = useQuery({
    queryKey: ['tickets', status, breachedOnly],
    queryFn: async () =>
      (
        await api.get<Ticket[]>('/tickets', {
          params: {
            ...(status ? { status } : {}),
            ...(breachedOnly ? { breached: 'true' } : {}),
          },
        })
      ).data,
    refetchInterval: 20_000,
  });

  const stats = useQuery({
    queryKey: ['tickets', 'stats'],
    queryFn: async () => (await api.get<TicketStats>('/tickets/stats')).data,
    refetchInterval: 30_000,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<TenantUser[]>('/users')).data,
  });

  const rules = useQuery({
    queryKey: ['ticket-rules'],
    queryFn: async () => (await api.get<TicketRule[]>('/ticket-rules')).data,
    enabled: rulesOpen,
  });

  const detail = useQuery({
    queryKey: ['tickets', viewing?.id],
    queryFn: async () =>
      (await api.get<TicketDetail>(`/tickets/${viewing!.id}`)).data,
    enabled: Boolean(viewing),
  });

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/tickets', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setOpen(false);
    },
  });

  const update = useMutation({
    mutationFn: async (payload: {
      id: string;
      body: Record<string, unknown>;
    }) => (await api.patch(`/tickets/${payload.id}`, payload.body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Update failed'),
  });

  const addComment = useMutation({
    mutationFn: async (payload: {
      id: string;
      body: string;
      isInternal: boolean;
    }) =>
      (
        await api.post(`/tickets/${payload.id}/comments`, {
          body: payload.body,
          isInternal: payload.isInternal,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setComment('');
    },
  });

  const columns: Column<Ticket>[] = [
    { key: 'number', header: 'Ticket' },
    { key: 'subject', header: 'Subject' },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            priorityStyle[t.priority]
          }`}
        >
          {t.priority.toLowerCase()}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            statusStyle[t.status]
          }`}
        >
          {t.status.toLowerCase().replace('_', ' ')}
        </span>
      ),
    },
    { key: 'category', header: 'Category', render: (t) => t.category ?? '—' },
    {
      key: 'assignee',
      header: 'Assignee',
      render: (t) =>
        t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : '—',
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (t) =>
        t.firstResponseBreached || t.resolutionBreached ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
            breached
          </span>
        ) : (
          <span className="text-xs text-slate-400">on track</span>
        ),
    },
  ];

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      subject: String(form.get('subject')),
      description: String(form.get('description') || '') || undefined,
      // Left blank, the routing rules decide priority, category and owner.
      priority: String(form.get('priority') || '') || undefined,
    });
  };

  const s = stats.data;

  return (
    <div>
      <PageHeader
        title="Tickets"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setRulesOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Routing rules
            </button>
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New ticket
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.isLoading || !s ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <Stat label="Open" value={s.byStatus.OPEN ?? 0} />
            <Stat label="Urgent" value={s.openByPriority.URGENT ?? 0} />
            <Stat label="SLA breached" value={s.breached} />
            <Stat label="SLA compliance" value={`${s.slaCompliance}%`} />
            <Stat
              label="CSAT"
              value={s.csatResponses ? `${s.csatAverage} / 5` : '—'}
            />
          </>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatus('')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            status === '' ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
          }`}
        >
          All
        </button>
        {STATUSES.map((st) => (
          <button
            key={st}
            onClick={() => setStatus(st)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              status === st ? 'bg-brand-50 text-brand-700' : 'text-slate-500'
            }`}
          >
            {st.toLowerCase().replace('_', ' ')}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={breachedOnly}
            onChange={(e) => setBreachedOnly(e.target.checked)}
          />
          SLA breached only
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={tickets.data ?? []}
        loading={tickets.isLoading}
        emptyText="No tickets."
        actions={(t) => (
          <button
            onClick={() => setViewing(t)}
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            Open
          </button>
        )}
      />

      {/* New ticket */}
      <Modal open={open} title="New ticket" onClose={() => setOpen(false)}>
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Subject" name="subject" required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Description
            </span>
            <textarea
              name="description"
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Priority
            </span>
            <select
              name="priority"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Let the rules decide</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" loading={create.isPending}>
            Create ticket
          </Button>
        </form>
      </Modal>

      {/* Detail */}
      <Modal
        open={Boolean(viewing)}
        title={viewing ? `${viewing.number} — ${viewing.subject}` : ''}
        onClose={() => setViewing(null)}
      >
        {detail.data && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <select
                value={detail.data.status}
                onChange={(e) =>
                  update.mutate({
                    id: detail.data!.id,
                    body: { status: e.target.value },
                  })
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st.toLowerCase().replace('_', ' ')}
                  </option>
                ))}
              </select>
              <select
                value={detail.data.priority}
                onChange={(e) =>
                  update.mutate({
                    id: detail.data!.id,
                    body: { priority: e.target.value },
                  })
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </select>
              <select
                value={detail.data.assignee?.id ?? ''}
                onChange={(e) =>
                  update.mutate({
                    id: detail.data!.id,
                    body: { assigneeId: e.target.value },
                  })
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="">Unassigned</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>

            {detail.data.description && (
              <p className="whitespace-pre-line text-slate-600">
                {detail.data.description}
              </p>
            )}

            <div className="text-xs text-slate-400">
              {detail.data.channel && <span>via {detail.data.channel} · </span>}
              first response due{' '}
              {detail.data.firstResponseDueAt
                ? new Date(detail.data.firstResponseDueAt).toLocaleString()
                : '—'}
              {(detail.data.firstResponseBreached ||
                detail.data.resolutionBreached) && (
                <span className="ml-1 font-semibold text-red-600">
                  · SLA breached
                </span>
              )}
            </div>

            {detail.data.parent && (
              <p className="text-xs text-slate-500">
                Child of {detail.data.parent.number}
              </p>
            )}
            {(detail.data.children?.length ?? 0) > 0 && (
              <p className="text-xs text-slate-500">
                Children: {detail.data.children!.map((c) => c.number).join(', ')}
              </p>
            )}

            <div className="max-h-52 space-y-2 overflow-y-auto border-t border-slate-200 pt-3">
              {detail.data.comments?.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    c.isInternal
                      ? 'border border-amber-200 bg-amber-50 text-amber-900'
                      : 'bg-slate-50'
                  }`}
                >
                  {c.isInternal && (
                    <p className="text-[10px] font-semibold uppercase text-amber-600">
                      Internal note
                    </p>
                  )}
                  <p>{c.body}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {new Date(c.createdAt).toLocaleString()}
                    {c.channel && ` · sent on ${c.channel}`}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-slate-200 pt-3">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Reply to the customer, or add an internal note…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    comment.trim() &&
                    addComment.mutate({
                      id: detail.data!.id,
                      body: comment,
                      isInternal: false,
                    })
                  }
                  disabled={addComment.isPending}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  Reply to customer
                </button>
                <button
                  onClick={() =>
                    comment.trim() &&
                    addComment.mutate({
                      id: detail.data!.id,
                      body: comment,
                      isInternal: true,
                    })
                  }
                  disabled={addComment.isPending}
                  className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                >
                  Internal note
                </button>
              </div>
            </div>

            {detail.data.csatRating && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
                Rated {detail.data.csatRating}/5
                {detail.data.csatComment && ` — ${detail.data.csatComment}`}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Rules */}
      <Modal
        open={rulesOpen}
        title="Ticket routing rules"
        onClose={() => setRulesOpen(false)}
      >
        <p className="mb-3 text-sm text-slate-500">
          The first matching rule sets the category, priority and owner of a new
          ticket. Anything set explicitly when raising the ticket wins.
        </p>
        <div className="space-y-2">
          {rules.data?.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-slate-400">
                {r.conditions.keywords?.length
                  ? `keywords: ${r.conditions.keywords.join(', ')}`
                  : 'catch-all'}
                {r.conditions.channel && ` · ${r.conditions.channel}`} →{' '}
                {r.setCategory ?? 'no category'}
                {r.setPriority && ` · ${r.setPriority.toLowerCase()}`} ·{' '}
                {r.strategy === 'specific'
                  ? (r.assignTo
                      ? `${r.assignTo.firstName} ${r.assignTo.lastName}`
                      : 'unassigned')
                  : 'least busy agent'}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
