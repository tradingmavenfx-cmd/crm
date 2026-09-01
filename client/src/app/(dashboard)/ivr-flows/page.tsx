'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { IvrActionType, IvrFlow, IvrOption, TenantUser } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const ACTIONS: { value: IvrActionType; label: string; hint: string }[] = [
  { value: 'transfer', label: 'Transfer to agent', hint: 'Pick an agent below' },
  { value: 'menu', label: 'Go to submenu', hint: 'Pick a flow below' },
  { value: 'voicemail', label: 'Take a voicemail', hint: '' },
  { value: 'message', label: 'Read out a message', hint: 'Text to speak' },
  {
    value: 'crm_lookup',
    label: 'Read live CRM data',
    hint: '"deal" (order status) or "task"',
  },
  { value: 'hangup', label: 'Say goodbye and hang up', hint: '' },
];

const blankOption = (): IvrOption => ({
  digit: '',
  label: '',
  action: 'voicemail',
  value: '',
});

export default function IvrFlowsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IvrFlow | null>(null);
  const [options, setOptions] = useState<IvrOption[]>([blankOption()]);
  const [error, setError] = useState<string | null>(null);

  const flows = useQuery({
    queryKey: ['voice', 'ivr-flows'],
    queryFn: async () => (await api.get<IvrFlow[]>('/voice/ivr-flows')).data,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<TenantUser[]>('/users')).data,
  });

  useEffect(() => {
    setOptions(editing?.options.length ? editing.options : [blankOption()]);
  }, [editing]);

  const save = useMutation({
    mutationFn: async (body: {
      id?: string;
      name: string;
      description?: string;
      greeting: string;
      isActive: boolean;
      options: IvrOption[];
    }) => {
      const { id, ...payload } = body;
      if (id) return (await api.patch(`/voice/ivr-flows/${id}`, payload)).data;
      return (await api.post('/voice/ivr-flows', payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice', 'ivr-flows'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : message ?? 'Save failed');
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/voice/ivr-flows/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice', 'ivr-flows'] }),
  });

  const activate = useMutation({
    mutationFn: async (id: string) =>
      (await api.patch(`/voice/ivr-flows/${id}`, { isActive: true })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voice', 'ivr-flows'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setOptions([blankOption()]);
    setError(null);
    setOpen(true);
  };

  const openEdit = (flow: IvrFlow) => {
    setEditing(flow);
    setError(null);
    setOpen(true);
  };

  const setOption = (index: number, patch: Partial<IvrOption>) =>
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    );

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save
      .mutateAsync({
        id: editing?.id,
        name: String(form.get('name')),
        description: String(form.get('description') || '') || undefined,
        greeting: String(form.get('greeting')),
        isActive: form.get('isActive') === 'on',
        options: options
          .filter((o) => o.digit && o.label)
          .map((o) => ({ ...o, value: o.value || undefined })),
      })
      .catch(() => undefined);
  };

  return (
    <div>
      <PageHeader
        title="IVR Flows"
        action={
          <button
            onClick={openCreate}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New flow
          </button>
        }
      />

      <p className="mb-4 text-sm text-slate-500">
        The active flow answers every inbound call. Build multi-level menus by
        pointing a key at another flow.
      </p>

      {flows.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : (flows.data?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
          No IVR flows yet. Callers hear a voicemail prompt until you add one.
        </div>
      ) : (
        <div className="space-y-4">
          {flows.data!.map((flow) => (
            <div
              key={flow.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{flow.name}</h2>
                    {flow.isActive ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                        ACTIVE
                      </span>
                    ) : (
                      <button
                        onClick={() => activate.mutate(flow.id)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        SET ACTIVE
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    &ldquo;{flow.greeting}&rdquo;
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => openEdit(flow)}
                    className="text-sm text-brand-600 hover:text-brand-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove.mutate(flow.id)}
                    className="text-sm text-slate-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <ul className="mt-3 space-y-1">
                {flow.options.map((o) => (
                  <li key={o.digit} className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 font-mono text-xs font-semibold">
                      {o.digit}
                    </span>
                    <span>{o.label}</span>
                    <span className="text-xs text-slate-400">
                      · {ACTIONS.find((a) => a.value === o.action)?.label ?? o.action}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'New IVR flow'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" defaultValue={editing?.name} required />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description ?? ''}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Greeting (read out before the menu)
            </span>
            <textarea
              name="greeting"
              rows={2}
              defaultValue={editing?.greeting}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Menu keys
            </span>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex gap-2">
                    <input
                      value={o.digit}
                      onChange={(e) => setOption(i, { digit: e.target.value })}
                      placeholder="1"
                      maxLength={1}
                      className="w-12 rounded-md border border-slate-300 px-2 py-1 text-center font-mono text-sm outline-none focus:border-brand-500"
                    />
                    <input
                      value={o.label}
                      onChange={(e) => setOption(i, { label: e.target.value })}
                      placeholder="sales"
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setOptions((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="px-1 text-slate-400 hover:text-red-600"
                      aria-label="Remove key"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <select
                      value={o.action}
                      onChange={(e) =>
                        setOption(i, {
                          action: e.target.value as IvrActionType,
                          value: '',
                        })
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
                    >
                      {ACTIONS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>

                    {o.action === 'transfer' && (
                      <select
                        value={o.value ?? ''}
                        onChange={(e) => setOption(i, { value: e.target.value })}
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        <option value="">Select an agent…</option>
                        {users.data?.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName} {u.lastName}
                          </option>
                        ))}
                      </select>
                    )}

                    {o.action === 'menu' && (
                      <select
                        value={o.value ?? ''}
                        onChange={(e) => setOption(i, { value: e.target.value })}
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        <option value="">Select a flow…</option>
                        {flows.data
                          ?.filter((f) => f.id !== editing?.id)
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                    )}

                    {(o.action === 'message' || o.action === 'crm_lookup') && (
                      <input
                        value={o.value ?? ''}
                        onChange={(e) => setOption(i, { value: e.target.value })}
                        placeholder={
                          ACTIONS.find((a) => a.value === o.action)?.hint
                        }
                        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, blankOption()])}
              className="mt-2 text-sm text-brand-600 hover:text-brand-700"
            >
              + Add key
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing?.isActive ?? false}
            />
            Answer inbound calls with this flow
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create flow'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
