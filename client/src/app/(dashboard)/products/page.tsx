'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PriceBook, Product } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SearchBar } from '@/components/ui/SearchBar';

const money = (value: string | number) =>
  Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', search],
    queryFn: async () =>
      (await api.get<Product[]>('/products', { params: search ? { search } : {} }))
        .data,
  });

  const priceBooks = useQuery({
    queryKey: ['price-books'],
    queryFn: async () => (await api.get<PriceBook[]>('/price-books')).data,
    enabled: booksOpen,
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) return (await api.patch(`/products/${editing.id}`, body)).data;
      return (await api.post('/products', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<{ deactivated: boolean; reason?: string }>(
        `/products/${id}`,
      )).data,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      if (result.deactivated) setError(result.reason ?? null);
    },
  });

  const createBook = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/price-books', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-books'] }),
  });

  const columns: Column<Product>[] = [
    { key: 'sku', header: 'SKU' },
    { key: 'name', header: 'Name' },
    {
      key: 'unitPrice',
      header: 'List price',
      render: (p) => `${money(p.unitPrice)} ${p.currency}`,
    },
    { key: 'taxRate', header: 'GST %', render: (p) => `${Number(p.taxRate)}%` },
    { key: 'hsnCode', header: 'HSN/SAC', render: (p) => p.hsnCode ?? '—' },
    {
      key: 'isActive',
      header: 'Status',
      render: (p) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            p.isActive
              ? 'bg-green-100 text-green-700'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {p.isActive ? 'active' : 'inactive'}
        </span>
      ),
    },
  ];

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save
      .mutateAsync({
        ...(editing ? {} : { sku: String(form.get('sku')) }),
        name: String(form.get('name')),
        description: String(form.get('description') || '') || undefined,
        unitPrice: Number(form.get('unitPrice')),
        taxRate: Number(form.get('taxRate') || 18),
        hsnCode: String(form.get('hsnCode') || '') || undefined,
      })
      .catch(() => undefined);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setBooksOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Price books
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setError(null);
                setOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New product
            </button>
          </div>
        }
      />

      <div className="mb-4">
        <SearchBar value={search} onChange={setSearch} placeholder="Search SKU or name…" />
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={products.data ?? []}
        loading={products.isLoading}
        emptyText="No products yet."
        actions={(p) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setEditing(p);
                setError(null);
                setOpen(true);
              }}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              Edit
            </button>
            <button
              onClick={() => remove.mutate(p.id)}
              className="text-sm text-slate-400 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        )}
      />

      <Modal
        open={open}
        title={editing ? `Edit ${editing.sku}` : 'New product'}
        onClose={() => setOpen(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {!editing && <Field label="SKU" name="sku" required />}
          <Field label="Name" name="name" defaultValue={editing?.name} required />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description ?? ''}
          />
          <div className="grid grid-cols-3 gap-3">
            <Field
              label="List price"
              name="unitPrice"
              type="number"
              step="0.01"
              defaultValue={editing ? String(editing.unitPrice) : ''}
              required
            />
            <Field
              label="GST %"
              name="taxRate"
              type="number"
              step="0.01"
              defaultValue={editing ? String(editing.taxRate) : '18'}
            />
            <Field
              label="HSN/SAC"
              name="hsnCode"
              defaultValue={editing?.hsnCode ?? ''}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create product'}
          </Button>
        </form>
      </Modal>

      <Modal
        open={booksOpen}
        title="Price books"
        onClose={() => setBooksOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            A quote takes its prices from the book it names, falling back to the
            default book and then the product&rsquo;s list price.
          </p>
          <div className="space-y-2">
            {priceBooks.data?.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {b.name}
                    {b.isDefault && (
                      <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                        DEFAULT
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {b.currency} · {b._count?.entries ?? 0} prices
                  </p>
                </div>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              createBook.mutate({
                name: String(form.get('name')),
                currency: String(form.get('currency') || 'INR'),
              });
              e.currentTarget.reset();
            }}
            className="space-y-3 border-t border-slate-200 pt-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" name="name" required />
              <Field label="Currency" name="currency" defaultValue="INR" />
            </div>
            <Button type="submit" loading={createBook.isPending}>
              Add price book
            </Button>
          </form>
        </div>
      </Modal>
    </div>
  );
}
