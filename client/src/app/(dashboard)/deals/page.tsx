'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Deal, DealStage } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const DEFAULT_STAGES = [
  { name: 'Lead In', order: 0, probability: 10 },
  { name: 'Qualified', order: 1, probability: 25 },
  { name: 'Proposal', order: 2, probability: 50 },
  { name: 'Negotiation', order: 3, probability: 75 },
  { name: 'Closed Won', order: 4, probability: 100 },
];

function formatValue(value: string, currency: string) {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function DealsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const stages = useQuery({
    queryKey: ['deals', 'stages'],
    queryFn: async () => (await api.get<DealStage[]>('/deals/stages')).data,
  });

  const deals = useQuery({
    queryKey: ['deals', 'list'],
    queryFn: async () => (await api.get<Deal[]>('/deals')).data,
  });

  const setupPipeline = useMutation({
    mutationFn: async () => {
      for (const s of DEFAULT_STAGES) {
        await api.post('/deals/stages', s);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals', 'stages'] }),
  });

  const createDeal = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<Deal>('/deals', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      setOpen(false);
    },
  });

  const stageList = stages.data ?? [];
  const dealList = deals.data ?? [];
  const hasStages = stageList.length > 0;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await createDeal.mutateAsync({
      title: String(form.get('title')),
      value: (form.get('value') as string) || '0',
      stageId: String(form.get('stageId')),
    });
  };

  return (
    <div>
      <PageHeader
        title="Deals"
        action={
          hasStages ? (
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New deal
            </button>
          ) : null
        }
      />

      {!hasStages && !stages.isLoading ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">
            No pipeline stages yet. Set up a default 5-stage pipeline to start
            tracking deals.
          </p>
          <button
            onClick={() => setupPipeline.mutate()}
            disabled={setupPipeline.isPending}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {setupPipeline.isPending ? 'Setting up…' : 'Set up default pipeline'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stages.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <Skeleton className="mb-3 h-4 w-20" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))
            : stageList
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((stage) => {
                  const items = dealList.filter((d) => d.stageId === stage.id);
                  return (
                    <div
                      key={stage.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {stage.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {stage.probability}%
                        </span>
                      </div>
                      <div className="space-y-2">
                        {items.length === 0 ? (
                          <p className="text-xs text-slate-300">No deals</p>
                        ) : (
                          items.map((d) => (
                            <div
                              key={d.id}
                              className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                            >
                              <p className="text-sm font-medium">{d.title}</p>
                              <p className="text-xs text-slate-500">
                                {formatValue(d.value, d.currency)}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
        </div>
      )}

      <Modal open={open} title="New deal" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Title" name="title" required />
          <Field label="Value" name="value" type="number" min={0} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Stage
            </span>
            <select
              name="stageId"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            >
              {stageList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" loading={createDeal.isPending}>
            Create deal
          </Button>
        </form>
      </Modal>
    </div>
  );
}
