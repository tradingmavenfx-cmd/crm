'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Contact,
  Invoice,
  Paginated,
  PriceBook,
  Product,
  Quote,
  QuoteDraftLine,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

const statusStyle: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  SENT: 'bg-indigo-100 text-indigo-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  DECLINED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-slate-100 text-slate-500',
};

const money = (value: string | number) =>
  Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const blankLine = (): QuoteDraftLine => ({
  productId: '',
  quantity: 1,
  discountPercent: 0,
});

export default function QuotesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<QuoteDraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Quote | null>(null);
  const [invoicesOpen, setInvoicesOpen] = useState(false);

  const quotes = useQuery({
    queryKey: ['quotes'],
    queryFn: async () => (await api.get<Quote[]>('/quotes')).data,
    refetchInterval: 20_000,
  });

  const products = useQuery({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>('/products')).data,
  });

  const priceBooks = useQuery({
    queryKey: ['price-books'],
    queryFn: async () => (await api.get<PriceBook[]>('/price-books')).data,
  });

  const contacts = useQuery({
    queryKey: ['contacts', 'for-quotes'],
    queryFn: async () =>
      (await api.get<Paginated<Contact>>('/contacts', { params: { limit: 100 } }))
        .data.data,
  });

  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get<Invoice[]>('/invoices')).data,
    enabled: invoicesOpen,
  });

  const detail = useQuery({
    queryKey: ['quotes', viewing?.id],
    queryFn: async () => (await api.get<Quote>(`/quotes/${viewing!.id}`)).data,
    enabled: Boolean(viewing),
  });

  const onActionError = (err: {
    response?: { data?: { message?: string } };
  }) => setError(err.response?.data?.message ?? 'Action failed');

  const send = useMutation({
    mutationFn: async (id: string) => (await api.post(`/quotes/${id}/send`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
    onError: onActionError,
  });

  const approve = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/quotes/${id}/approve`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
    onError: onActionError,
  });

  const reject = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/quotes/${id}/reject`, { reason: 'Discount too high' }))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const invoice = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/quotes/${id}/invoice`, {})).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes', 'invoices'] });
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not invoice'),
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/quotes', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const setLine = (i: number, patch: Partial<QuoteDraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save
      .mutateAsync({
        contactId: String(form.get('contactId') || '') || undefined,
        priceBookId: String(form.get('priceBookId') || '') || undefined,
        discountPercent: Number(form.get('discountPercent') || 0),
        validUntil: form.get('validUntil')
          ? new Date(String(form.get('validUntil'))).toISOString()
          : undefined,
        notes: String(form.get('notes') || '') || undefined,
        lines: lines
          .filter((l) => l.productId)
          .map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            discountPercent: Number(l.discountPercent || 0),
          })),
      })
      .catch(() => undefined);
  };

  const columns: Column<Quote>[] = [
    { key: 'number', header: 'Number' },
    {
      key: 'status',
      header: 'Status',
      render: (q) => (
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
            statusStyle[q.status] ?? 'bg-slate-100'
          }`}
        >
          {q.status.toLowerCase().replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'contact',
      header: 'Customer',
      render: (q) =>
        q.contact
          ? `${q.contact.firstName} ${q.contact.lastName}`
          : (q.company?.name ?? '—'),
    },
    {
      key: 'total',
      header: 'Total',
      render: (q) => `${money(q.total)} ${q.currency}`,
    },
    {
      key: 'validUntil',
      header: 'Valid until',
      render: (q) =>
        q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quotes"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setInvoicesOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Invoices
            </button>
            <button
              onClick={() => {
                setLines([blankLine()]);
                setError(null);
                setOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New quote
            </button>
          </div>
        }
      />

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={quotes.data ?? []}
        loading={quotes.isLoading}
        emptyText="No quotes yet."
        actions={(q) => (
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setViewing(q)}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              View
            </button>
            {q.status === 'PENDING_APPROVAL' && (
              <>
                <button
                  onClick={() => approve.mutate(q.id)}
                  className="text-sm text-green-600 hover:text-green-700"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject.mutate(q.id)}
                  className="text-sm text-red-500 hover:text-red-700"
                >
                  Reject
                </button>
              </>
            )}
            {['DRAFT', 'APPROVED'].includes(q.status) && (
              <button
                onClick={() => send.mutate(q.id)}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                Send
              </button>
            )}
            {q.status === 'ACCEPTED' && (
              <button
                onClick={() => invoice.mutate(q.id)}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                Invoice
              </button>
            )}
          </div>
        )}
      />

      {/* Create */}
      <Modal open={open} title="New quote" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Customer
              </span>
              <select
                name="contactId"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {contacts.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Price book
              </span>
              <select
                name="priceBookId"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Default</option>
                {priceBooks.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Lines
            </span>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    value={line.productId}
                    onChange={(e) => setLine(i, { productId: e.target.value })}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">Select a product…</option>
                    {products.data
                      ?.filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) =>
                      setLine(i, { quantity: Number(e.target.value) })
                    }
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    title="Quantity"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={line.discountPercent}
                    onChange={(e) =>
                      setLine(i, { discountPercent: Number(e.target.value) })
                    }
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    title="Line discount %"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="px-1 text-slate-400 hover:text-red-600"
                    aria-label="Remove line"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
              className="mt-2 text-sm text-brand-600 hover:text-brand-700"
            >
              + Add line
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Quote discount %"
              name="discountPercent"
              type="number"
              step="0.01"
              defaultValue="0"
            />
            <Field label="Valid until" name="validUntil" type="date" />
          </div>
          <Field label="Notes" name="notes" />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={save.isPending}>
            Create quote
          </Button>
        </form>
      </Modal>

      {/* Detail */}
      <Modal
        open={Boolean(viewing)}
        title={viewing ? viewing.number : ''}
        onClose={() => setViewing(null)}
      >
        {detail.data && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  statusStyle[detail.data.status]
                }`}
              >
                {detail.data.status.toLowerCase().replace('_', ' ')}
              </span>
              {detail.data.approvalRequired && (
                <span className="text-xs text-amber-700">
                  discount needs approval
                </span>
              )}
            </div>

            <table className="w-full">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">Item</th>
                  <th className="py-1">Qty</th>
                  <th className="py-1">Price</th>
                  <th className="py-1">Disc</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.data.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1">{l.name}</td>
                    <td className="py-1">{Number(l.quantity)}</td>
                    <td className="py-1">{money(l.unitPrice)}</td>
                    <td className="py-1">{Number(l.discountPercent)}%</td>
                    <td className="py-1 text-right">{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1 border-t border-slate-200 pt-2 text-right">
              <p>Subtotal: {money(detail.data.subtotal)}</p>
              <p>Discount: −{money(detail.data.discountAmount)}</p>
              <p>GST: {money(detail.data.taxAmount)}</p>
              <p className="text-lg font-bold">
                Total: {money(detail.data.total)} {detail.data.currency}
              </p>
            </div>

            {detail.data.acceptedByName && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
                Accepted by {detail.data.acceptedByName}
                {detail.data.acceptedAt &&
                  ` on ${new Date(detail.data.acceptedAt).toLocaleString()}`}
                {detail.data.acceptedIp && ` from ${detail.data.acceptedIp}`}
              </p>
            )}
            {detail.data.rejectionReason && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                Rejected: {detail.data.rejectionReason}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Invoices */}
      <Modal
        open={invoicesOpen}
        title="Invoices"
        onClose={() => setInvoicesOpen(false)}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {(invoices.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">
              No invoices yet — accept a quote and convert it.
            </p>
          ) : (
            invoices.data!.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{inv.number}</p>
                  <p className="text-xs text-slate-400">
                    from {inv.quote?.number ?? '—'} ·{' '}
                    {inv.customerGstin ?? 'no GSTIN'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {money(inv.total)} {inv.currency}
                  </p>
                  <p className="text-xs text-slate-400">{inv.status}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
