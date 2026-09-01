'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SmsOptOut, SmsTemplate } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const columns: Column<SmsTemplate>[] = [
  { key: 'name', header: 'Name' },
  {
    key: 'body',
    header: 'Body',
    render: (t) => <span className="text-slate-500">{t.body}</span>,
  },
];

const optOutColumns: Column<SmsOptOut>[] = [
  { key: 'phone', header: 'Number' },
  {
    key: 'reason',
    header: 'Reason',
    render: (o) => (
      <span className="text-slate-500">{o.reason.replace('_', ' ')}</span>
    ),
  },
  {
    key: 'createdAt',
    header: 'Added',
    render: (o) => new Date(o.createdAt).toLocaleDateString(),
  },
];

export default function SmsTemplatesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [optOutOpen, setOptOutOpen] = useState(false);

  const templates = useQuery({
    queryKey: ['sms', 'templates'],
    queryFn: async () => (await api.get<SmsTemplate[]>('/sms/templates')).data,
  });

  const optOuts = useQuery({
    queryKey: ['sms', 'opt-outs'],
    queryFn: async () => (await api.get<SmsOptOut[]>('/sms/opt-outs')).data,
  });

  const save = useMutation({
    mutationFn: async (body: { id?: string; name: string; body: string }) => {
      if (body.id) return (await api.patch(`/sms/templates/${body.id}`, body)).data;
      return (await api.post('/sms/templates', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms', 'templates'] });
      setOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sms/templates/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms', 'templates'] }),
  });

  const addOptOut = useMutation({
    mutationFn: async (phone: string) =>
      (await api.post('/sms/opt-outs', { phone, reason: 'manual' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sms', 'opt-outs'] });
      setOptOutOpen(false);
    },
  });

  const removeOptOut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sms/opt-outs/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms', 'opt-outs'] }),
  });

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save.mutateAsync({
      id: editing?.id,
      name: String(form.get('name')),
      body: String(form.get('body')),
    });
  };

  const onAddOptOut = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await addOptOut.mutateAsync(String(form.get('phone')));
  };

  return (
    <div>
      <PageHeader
        title="SMS Templates"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New template
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={templates.data ?? []}
        loading={templates.isLoading}
        emptyText="No SMS templates yet."
        actions={(t) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setEditing(t);
                setOpen(true);
              }}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Edit
            </button>
            <button
              onClick={() => remove.mutate(t.id)}
              className="text-sm text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        )}
      />

      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-500">
              DND / opt-out list
            </h2>
            <p className="text-xs text-slate-400">
              These numbers are skipped on every send. Replying STOP adds a
              number automatically.
            </p>
          </div>
          <button
            onClick={() => setOptOutOpen(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            + Add number
          </button>
        </div>

        <DataTable
          columns={optOutColumns}
          rows={optOuts.data ?? []}
          loading={optOuts.isLoading}
          emptyText="No opted-out numbers."
          actions={(o) => (
            <button
              onClick={() => removeOptOut.mutate(o.id)}
              className="text-sm text-slate-400 hover:text-red-600"
            >
              Remove
            </button>
          )}
        />
      </div>

      <Modal
        open={open}
        title={editing ? 'Edit template' : 'New SMS template'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" defaultValue={editing?.name} required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Body (supports {'{{merge}}'} fields)
            </span>
            <textarea
              name="body"
              rows={4}
              defaultValue={editing?.body}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create template'}
          </Button>
        </form>
      </Modal>

      <Modal
        open={optOutOpen}
        title="Add to DND list"
        onClose={() => setOptOutOpen(false)}
      >
        <form onSubmit={onAddOptOut} className="space-y-4">
          <Field
            label="Phone (E.164)"
            name="phone"
            placeholder="+919812345678"
            required
          />
          <Button type="submit" loading={addOptOut.isPending}>
            Add number
          </Button>
        </form>
      </Modal>
    </div>
  );
}
