'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { EmailTemplate } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const columns: Column<EmailTemplate>[] = [
  { key: 'name', header: 'Name' },
  { key: 'subject', header: 'Subject' },
];

export default function EmailTemplatesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);

  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: async () =>
      (await api.get<EmailTemplate[]>('/email/templates')).data,
  });

  const save = useMutation({
    mutationFn: async (body: {
      id?: string;
      name: string;
      subject: string;
      body: string;
    }) => {
      if (body.id) {
        return (await api.patch(`/email/templates/${body.id}`, body)).data;
      }
      return (await api.post('/email/templates', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email', 'templates'] });
      setOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/email/templates/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email', 'templates'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (t: EmailTemplate) => {
    setEditing(t);
    setOpen(true);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save.mutateAsync({
      id: editing?.id,
      name: String(form.get('name')),
      subject: String(form.get('subject')),
      body: String(form.get('body')),
    });
  };

  return (
    <div>
      <PageHeader
        title="Email Templates"
        action={
          <button
            onClick={openCreate}
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
        emptyText="No email templates yet."
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
        title={editing ? 'Edit template' : 'New email template'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" defaultValue={editing?.name} required />
          <Field
            label="Subject"
            name="subject"
            defaultValue={editing?.subject}
            required
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Body (HTML or text, supports {'{{merge}}'} fields)
            </span>
            <textarea
              name="body"
              rows={6}
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
    </div>
  );
}
