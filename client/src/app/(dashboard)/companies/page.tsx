'use client';

import { FormEvent, useState } from 'react';
import {
  useList,
  useCreate,
  useUpdate,
  useRemove,
} from '@/lib/hooks/useResource';
import { Company } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SearchBar } from '@/components/ui/SearchBar';
import { Pagination } from '@/components/ui/Pagination';

const columns: Column<Company>[] = [
  { key: 'name', header: 'Name' },
  { key: 'industry', header: 'Industry', render: (c) => c.industry ?? '—' },
  { key: 'domain', header: 'Domain', render: (c) => c.domain ?? '—' },
  { key: 'employees', header: 'Employees', render: (c) => c.employees ?? '—' },
];

export default function CompaniesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useList<Company>('companies', { search, page, limit: 10 });
  const create = useCreate<Company>('companies');
  const update = useUpdate<Company>('companies');
  const remove = useRemove('companies');

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: Company) => {
    setEditing(c);
    setOpen(true);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      name: String(form.get('name')),
      industry: (form.get('industry') as string) || undefined,
      domain: (form.get('domain') as string) || undefined,
      employees: form.get('employees') ? Number(form.get('employees')) : undefined,
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
        title="Companies"
        action={
          <div className="flex items-center gap-3">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search companies…"
            />
            <button
              onClick={openCreate}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New company
            </button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        loading={isLoading}
        emptyText="No companies found."
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
        title={editing ? 'Edit company' : 'New company'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Company name" name="name" defaultValue={editing?.name} required />
          <Field
            label="Industry"
            name="industry"
            defaultValue={editing?.industry ?? ''}
          />
          <Field
            label="Domain"
            name="domain"
            placeholder="example.com"
            defaultValue={editing?.domain ?? ''}
          />
          <Field
            label="Employees"
            name="employees"
            type="number"
            min={0}
            defaultValue={editing?.employees ?? ''}
          />
          <Button type="submit" loading={create.isPending || update.isPending}>
            {editing ? 'Save changes' : 'Create company'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
