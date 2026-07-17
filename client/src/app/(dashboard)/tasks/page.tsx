'use client';

import { FormEvent, useState } from 'react';
import {
  useList,
  useCreate,
  useUpdate,
  useRemove,
} from '@/lib/hooks/useResource';
import { Task } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const priorityStyle: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export default function TasksPage() {
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [open, setOpen] = useState(false);

  const params = status ? { status, limit: 20 } : { limit: 20 };
  const { data, isLoading } = useList<Task>('tasks', params);
  const create = useCreate<Task>('tasks');
  const update = useUpdate<Task>('tasks');
  const remove = useRemove('tasks');

  const columns: Column<Task>[] = [
    { key: 'title', header: 'Title' },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            priorityStyle[t.priority] ?? priorityStyle.low
          }`}
        >
          {t.priority}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <select
          value={t.status}
          onChange={(e) =>
            update.mutate({ id: t.id, body: { status: e.target.value } })
          }
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        >
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="done">done</option>
        </select>
      ),
    },
    {
      key: 'dueAt',
      header: 'Due',
      render: (t) => (t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—'),
    },
  ];

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setOpen(true);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const due = form.get('dueAt') as string;
    const body = {
      title: String(form.get('title')),
      description: (form.get('description') as string) || undefined,
      priority: (form.get('priority') as string) || 'medium',
      dueAt: due ? new Date(due).toISOString() : undefined,
    };
    if (editing) {
      await update.mutateAsync({ id: editing.id, body });
    } else {
      await create.mutateAsync(body);
    }
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        action={
          <button
            onClick={openCreate}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New task
          </button>
        }
      />

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
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
        rows={data?.data ?? []}
        loading={isLoading}
        emptyText="No tasks found."
        actions={(t) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => openEdit(t)}
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

      <Modal
        open={open}
        title={editing ? 'Edit task' : 'New task'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title" name="title" defaultValue={editing?.title} required />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description ?? ''}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Priority
            </span>
            <select
              name="priority"
              defaultValue={editing?.priority ?? 'medium'}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <Field
            label="Due date"
            name="dueAt"
            type="date"
            defaultValue={editing?.dueAt ? editing.dueAt.slice(0, 10) : ''}
          />
          <Button type="submit" loading={create.isPending || update.isPending}>
            {editing ? 'Save changes' : 'Create task'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
