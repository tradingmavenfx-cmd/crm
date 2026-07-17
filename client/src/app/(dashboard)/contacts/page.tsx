'use client';

import { FormEvent, useState } from 'react';
import {
  useList,
  useCreate,
  useUpdate,
  useRemove,
} from '@/lib/hooks/useResource';
import { Company, Contact } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SearchBar } from '@/components/ui/SearchBar';
import { Pagination } from '@/components/ui/Pagination';

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useList<Contact>('contacts', { search, page, limit: 10 });
  const companies = useList<Company>('companies', { limit: 100 });
  const create = useCreate<Contact>('contacts');
  const update = useUpdate<Contact>('contacts');
  const remove = useRemove('contacts');

  const companyName = (id: string | null) =>
    companies.data?.data.find((c) => c.id === id)?.name ?? '—';

  const columns: Column<Contact>[] = [
    { key: 'name', header: 'Name', render: (c) => `${c.firstName} ${c.lastName}` },
    { key: 'email', header: 'Email', render: (c) => c.email ?? '—' },
    { key: 'phone', header: 'Phone', render: (c) => c.phone ?? '—' },
    { key: 'company', header: 'Company', render: (c) => companyName(c.companyId) },
    { key: 'score', header: 'Score' },
  ];

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: Contact) => {
    setEditing(c);
    setOpen(true);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      firstName: String(form.get('firstName')),
      lastName: String(form.get('lastName')),
      email: (form.get('email') as string) || undefined,
      phone: (form.get('phone') as string) || undefined,
      jobTitle: (form.get('jobTitle') as string) || undefined,
      companyId: (form.get('companyId') as string) || undefined,
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
        title="Contacts"
        action={
          <div className="flex items-center gap-3">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search contacts…"
            />
            <button
              onClick={openCreate}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New contact
            </button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        loading={isLoading}
        emptyText="No contacts found."
        actions={(c) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => openEdit(c)}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Edit
            </button>
            <button
              onClick={() => remove.mutate(c.id)}
              className="text-sm text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        )}
      />

      <Pagination
        page={data?.meta.page ?? 1}
        pages={data?.meta.pages ?? 1}
        total={data?.meta.total ?? 0}
        onPage={setPage}
      />

      <Modal
        open={open}
        title={editing ? 'Edit contact' : 'New contact'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="First name"
              name="firstName"
              defaultValue={editing?.firstName}
              required
            />
            <Field
              label="Last name"
              name="lastName"
              defaultValue={editing?.lastName}
              required
            />
          </div>
          <Field
            label="Email"
            name="email"
            type="email"
            defaultValue={editing?.email ?? ''}
          />
          <Field label="Phone" name="phone" defaultValue={editing?.phone ?? ''} />
          <Field
            label="Job title"
            name="jobTitle"
            defaultValue={editing?.jobTitle ?? ''}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Company
            </span>
            <select
              name="companyId"
              defaultValue={editing?.companyId ?? ''}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            >
              <option value="">— None —</option>
              {companies.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            loading={create.isPending || update.isPending}
          >
            {editing ? 'Save changes' : 'Create contact'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
