'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Workflow,
  WorkflowAction,
  WorkflowAnalytics,
  WorkflowRun,
  WorkflowTemplate,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const TRIGGERS = [
  { value: 'RECORD_CREATED', label: 'A record is created' },
  { value: 'RECORD_UPDATED', label: 'A record is updated' },
  { value: 'FIELD_CHANGED', label: 'A field changes' },
  { value: 'DEAL_STAGE_CHANGED', label: 'A deal moves stage' },
  { value: 'MESSAGE_RECEIVED', label: 'A message arrives' },
  { value: 'CALL_COMPLETED', label: 'A call ends' },
  { value: 'SCHEDULE', label: 'On a schedule' },
  { value: 'WEBHOOK', label: 'An inbound webhook' },
];

const ACTION_TYPES = [
  { value: 'create_task', label: 'Create a task' },
  { value: 'assign_owner', label: 'Assign an owner' },
  { value: 'send_email', label: 'Send an email' },
  { value: 'send_sms', label: 'Send an SMS' },
  { value: 'send_whatsapp', label: 'Send a WhatsApp template' },
  { value: 'create_activity', label: 'Log an activity' },
  { value: 'add_to_sequence', label: 'Add to a sequence' },
  { value: 'update_field', label: 'Update a field' },
  { value: 'webhook', label: 'Call a webhook' },
];

const runStyle: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-slate-100 text-slate-600',
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

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [trigger, setTrigger] = useState('RECORD_CREATED');
  const [actions, setActions] = useState<WorkflowAction[]>([
    { type: 'create_task', config: { title: '', priority: 'medium', dueInHours: 24 } },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Workflow | null>(null);

  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => (await api.get<Workflow[]>('/workflows')).data,
    refetchInterval: 15_000,
  });

  const analytics = useQuery({
    queryKey: ['workflows', 'analytics'],
    queryFn: async () =>
      (await api.get<WorkflowAnalytics>('/workflows/analytics')).data,
    refetchInterval: 30_000,
  });

  const templates = useQuery({
    queryKey: ['workflows', 'templates'],
    queryFn: async () =>
      (await api.get<WorkflowTemplate[]>('/workflows/templates')).data,
    enabled: templatesOpen,
  });

  const runs = useQuery({
    queryKey: ['workflows', 'runs', viewing?.id],
    queryFn: async () =>
      (await api.get<WorkflowRun[]>(`/workflows/${viewing!.id}/runs`)).data,
    enabled: Boolean(viewing),
    refetchInterval: 10_000,
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/workflows', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const install = useMutation({
    mutationFn: async (templateId: string) =>
      (await api.post('/workflows/templates/install', { templateId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      setTemplatesOpen(false);
    },
  });

  const toggle = useMutation({
    mutationFn: async (w: Workflow) =>
      (await api.patch(`/workflows/${w.id}`, { isActive: !w.isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/workflows/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const setAction = (index: number, patch: Partial<WorkflowAction>) =>
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );

  const setActionConfig = (index: number, key: string, value: unknown) =>
    setActions((prev) =>
      prev.map((a, i) =>
        i === index ? { ...a, config: { ...a.config, [key]: value } } : a,
      ),
    );

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    const triggerConfig: Record<string, unknown> = {};
    if (trigger === 'FIELD_CHANGED') triggerConfig.field = String(form.get('field') || '');
    if (trigger === 'MESSAGE_RECEIVED') {
      const channel = String(form.get('channel') || '');
      if (channel) triggerConfig.channel = channel;
    }
    if (trigger === 'WEBHOOK') triggerConfig.key = String(form.get('webhookKey') || '');
    if (trigger === 'SCHEDULE') {
      const daily = String(form.get('dailyAt') || '');
      if (daily) triggerConfig.dailyAt = daily;
      else triggerConfig.everyMinutes = Number(form.get('everyMinutes') || 60);
    }

    // One optional condition keeps the form honest; richer trees come from the API.
    const condField = String(form.get('condField') || '');
    const conditions = condField
      ? {
          all: [
            {
              field: condField,
              op: String(form.get('condOp')),
              value: String(form.get('condValue') || ''),
            },
          ],
        }
      : {};

    const entity = String(form.get('triggerEntity') || '');

    await save
      .mutateAsync({
        name: String(form.get('name')),
        description: String(form.get('description') || '') || undefined,
        trigger,
        triggerEntity: entity || undefined,
        triggerConfig,
        conditions,
        actions,
      })
      .catch(() => undefined);
  };

  const a = analytics.data;

  return (
    <div>
      <PageHeader
        title="Workflows"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setTemplatesOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Templates
            </button>
            <button
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New workflow
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {analytics.isLoading || !a ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <Stat label="Active" value={a.activeWorkflows} />
            <Stat label="Runs" value={a.totalRuns} />
            <Stat label="Success rate" value={`${a.successRate}%`} />
            <Stat label="Skipped" value={a.skipped} />
            <Stat label="Avg duration" value={`${a.avgDurationMs}ms`} />
          </>
        )}
      </div>

      {workflows.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (workflows.data?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
          No workflows yet — install a template to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {workflows.data!.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{w.name}</h2>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        w.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {w.isActive ? 'ACTIVE' : 'PAUSED'}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {w.trigger}
                      {w.triggerEntity ? ` · ${w.triggerEntity}` : ''}
                    </span>
                  </div>
                  {w.description && (
                    <p className="mt-1 text-sm text-slate-500">{w.description}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {w.runCount} runs
                    {w.lastRunAt &&
                      ` · last ${new Date(w.lastRunAt).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setViewing(w)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    History
                  </button>
                  <button
                    onClick={() => toggle.mutate(w)}
                    className="text-sm text-brand-600 hover:text-brand-700"
                  >
                    {w.isActive ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    onClick={() => remove.mutate(w.id)}
                    className="text-sm text-slate-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <ol className="mt-3 flex flex-wrap gap-2">
                {w.actions.map((act, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600"
                  >
                    {i + 1}.{' '}
                    {ACTION_TYPES.find((t) => t.value === act.type)?.label ??
                      act.type}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* Templates */}
      <Modal
        open={templatesOpen}
        title="Workflow templates"
        onClose={() => setTemplatesOpen(false)}
      >
        <p className="mb-3 text-sm text-slate-500">
          Installed paused so you can review and edit before it starts firing.
        </p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {templates.data?.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-slate-200 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.description}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    {t.trigger} · {t.actionCount} actions
                  </p>
                </div>
                <button
                  onClick={() => install.mutate(t.id)}
                  disabled={install.isPending}
                  className="shrink-0 text-sm text-brand-600 hover:text-brand-700"
                >
                  Install
                </button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Create */}
      <Modal open={open} title="New workflow" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" required />
          <Field label="Description" name="description" />

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              When
            </span>
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {['RECORD_CREATED', 'RECORD_UPDATED', 'FIELD_CHANGED'].includes(
            trigger,
          ) && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Record type
              </span>
              <select
                name="triggerEntity"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="contact">Contact</option>
                <option value="deal">Deal</option>
              </select>
            </label>
          )}

          {trigger === 'FIELD_CHANGED' && (
            <Field label="Field to watch" name="field" placeholder="score" required />
          )}

          {trigger === 'MESSAGE_RECEIVED' && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Channel (blank = any)
              </span>
              <select
                name="channel"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Any</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="LIVE_CHAT">Live chat</option>
              </select>
            </label>
          )}

          {trigger === 'WEBHOOK' && (
            <Field
              label="Webhook key (part of the URL)"
              name="webhookKey"
              placeholder="contact-form"
              required
            />
          )}

          {trigger === 'SCHEDULE' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily at (HH:MM)" name="dailyAt" placeholder="09:00" />
              <Field
                label="…or every N minutes"
                name="everyMinutes"
                type="number"
                placeholder="60"
              />
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">
              Only if (optional)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <input
                name="condField"
                placeholder="score"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <select
                name="condOp"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="gte">≥</option>
                <option value="gt">&gt;</option>
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="lt">&lt;</option>
                <option value="lte">≤</option>
                <option value="contains">contains</option>
                <option value="is_not_empty">is set</option>
                <option value="is_empty">is empty</option>
              </select>
              <input
                name="condValue"
                placeholder="80"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Then
            </span>
            <div className="space-y-2">
              {actions.map((action, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="mb-2 flex gap-2">
                    <select
                      value={action.type}
                      onChange={(e) =>
                        setAction(i, { type: e.target.value, config: {} })
                      }
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {ACTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setActions((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="px-1 text-slate-400 hover:text-red-600"
                      aria-label="Remove action"
                    >
                      ✕
                    </button>
                  </div>

                  {action.type === 'create_task' && (
                    <input
                      value={String(action.config.title ?? '')}
                      onChange={(e) => setActionConfig(i, 'title', e.target.value)}
                      placeholder="Task title — supports {{firstName}}"
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  )}

                  {action.type === 'send_email' && (
                    <div className="space-y-2">
                      <input
                        value={String(action.config.subject ?? '')}
                        onChange={(e) =>
                          setActionConfig(i, 'subject', e.target.value)
                        }
                        placeholder="Subject"
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                      <textarea
                        value={String(action.config.body ?? '')}
                        onChange={(e) => setActionConfig(i, 'body', e.target.value)}
                        rows={2}
                        placeholder="Body"
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                  )}

                  {(action.type === 'send_sms' ||
                    action.type === 'create_activity') && (
                    <input
                      value={String(
                        action.config[
                          action.type === 'send_sms' ? 'text' : 'subject'
                        ] ?? '',
                      )}
                      onChange={(e) =>
                        setActionConfig(
                          i,
                          action.type === 'send_sms' ? 'text' : 'subject',
                          e.target.value,
                        )
                      }
                      placeholder={
                        action.type === 'send_sms' ? 'Message text' : 'Subject'
                      }
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  )}

                  {action.type === 'assign_owner' && (
                    <select
                      value={String(action.config.strategy ?? 'round_robin')}
                      onChange={(e) =>
                        setActionConfig(i, 'strategy', e.target.value)
                      }
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="round_robin">
                        Round robin (fewest open tasks)
                      </option>
                    </select>
                  )}

                  {action.type === 'webhook' && (
                    <input
                      value={String(action.config.url ?? '')}
                      onChange={(e) => setActionConfig(i, 'url', e.target.value)}
                      placeholder="https://hooks.example.com/crm"
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  { type: 'create_task', config: {} },
                ])
              }
              className="mt-2 text-sm text-brand-600 hover:text-brand-700"
            >
              + Add action
            </button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={save.isPending}>
            Create workflow
          </Button>
        </form>
      </Modal>

      {/* Run history */}
      <Modal
        open={Boolean(viewing)}
        title={viewing ? `${viewing.name} — history` : ''}
        onClose={() => setViewing(null)}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {runs.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (runs.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">No runs yet.</p>
          ) : (
            runs.data!.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      runStyle[r.status]
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(r.createdAt).toLocaleString()} · {r.durationMs}ms
                  </span>
                </div>
                {r.message && (
                  <p className="mt-1 text-xs text-slate-500">{r.message}</p>
                )}
                {r.steps.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {r.steps.map((s, i) => (
                      <li key={i} className="text-xs text-slate-500">
                        {s.status === 'ok' ? '✓' : '✕'} {s.type}
                        {s.detail ? ` — ${s.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
