'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  TenantUser,
  Territory,
  TerritoryPerformance,
  TerritoryRules,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** Reads a rule set back as the sentence it stands for. */
function describe(rules: TerritoryRules): string {
  const parts: string[] = [];
  if (rules.industries?.length) parts.push(rules.industries.join(' or '));
  if (rules.cities?.length) parts.push(`in ${rules.cities.join(', ')}`);
  if (rules.states?.length) parts.push(`in ${rules.states.join(', ')}`);
  if (rules.countries?.length) parts.push(`in ${rules.countries.join(', ')}`);
  if (rules.domains?.length) parts.push(`domain ${rules.domains.join(', ')}`);
  if (rules.minEmployees != null) parts.push(`${rules.minEmployees}+ staff`);
  if (rules.maxEmployees != null) parts.push(`up to ${rules.maxEmployees} staff`);
  return parts.length ? parts.join(', ') : 'Hand-picked accounts only';
}

export default function TerritoriesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Territory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const territories = useQuery({
    queryKey: ['territories'],
    queryFn: async () => (await api.get<Territory[]>('/territories')).data,
  });

  const performance = useQuery({
    queryKey: ['territories', 'performance'],
    queryFn: async () =>
      (await api.get<TerritoryPerformance[]>('/territories/performance')).data,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<TenantUser[]>('/users')).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['territories'] });
  };

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      editing
        ? (await api.patch(`/territories/${editing.id}`, body)).data
        : (await api.post('/territories', body)).data,
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/territories/${id}`)).data,
    onSuccess: refresh,
  });

  const assign = useMutation({
    mutationFn: async (reassignAll: boolean) =>
      (await api.post<{ assigned: number; unmatched: number }>(
        '/territories/assign',
        { reassignAll },
      )).data,
    onSuccess: refresh,
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const rules: TerritoryRules = {};
    const countries = list(form.get('countries'));
    const states = list(form.get('states'));
    const cities = list(form.get('cities'));
    const industries = list(form.get('industries'));
    const minEmployees = String(form.get('minEmployees') || '');
    if (countries.length) rules.countries = countries;
    if (states.length) rules.states = states;
    if (cities.length) rules.cities = cities;
    if (industries.length) rules.industries = industries;
    if (minEmployees) rules.minEmployees = Number(minEmployees);

    setError(null);
    save.mutate({
      name: String(form.get('name')),
      description: String(form.get('description') || '') || undefined,
      parentId: String(form.get('parentId') || '') || undefined,
      managerId: String(form.get('managerId') || ''),
      rules,
    });
  };

  const perfFor = (id: string) => performance.data?.find((p) => p.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Territories"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => assign.mutate(false)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {assign.isPending ? 'Filing…' : 'File unassigned accounts'}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setError(null);
                setOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New territory
            </button>
          </div>
        }
      />

      {assign.data && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Filed {assign.data.assigned} account
          {assign.data.assigned === 1 ? '' : 's'}.{' '}
          {assign.data.unmatched > 0 && (
            <span className="text-amber-700">
              {assign.data.unmatched} matched no rule and belong nowhere.
            </span>
          )}
        </p>
      )}

      {territories.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-3">
          {territories.data?.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No territories yet. Carve up the market and accounts file
              themselves.
            </p>
          )}
          {territories.data?.map((t) => {
            const perf = perfFor(t.id);
            return (
              <div
                key={t.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
                style={{ marginLeft: t.parentId ? 24 : 0 }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {t.name}
                      {!t.isActive && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          inactive
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-600">{describe(t.rules)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {t._count.companies} account
                      {t._count.companies === 1 ? '' : 's'}
                      {t.manager
                        ? ` · led by ${t.manager.firstName} ${t.manager.lastName}`
                        : ''}
                      {t.members.length
                        ? ` · ${t.members.length} member${t.members.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <button
                      onClick={() => {
                        setEditing(t);
                        setError(null);
                        setOpen(true);
                      }}
                      className="text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove.mutate(t.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {perf && (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-400">Won</p>
                      <p className="font-medium text-green-700">
                        {inr(perf.won)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Open</p>
                      <p className="font-medium">{inr(perf.open)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Deals</p>
                      <p className="font-medium">{perf.deals}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Win rate</p>
                      <p className="font-medium">{perf.winRate}%</p>
                    </div>
                  </div>
                )}
                {perf && t._count.children > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Includes everything in {t._count.children} sub-territor
                    {t._count.children === 1 ? 'y' : 'ies'}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        wide
        title={editing ? `Edit ${editing.name}` : 'New territory'}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      >
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Name" name="name" required defaultValue={editing?.name} />
          <Field
            label="Description"
            name="description"
            defaultValue={editing?.description ?? ''}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Sits inside
              </label>
              <select
                name="parentId"
                defaultValue={editing?.parentId ?? ''}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Nothing — top level</option>
                {territories.data
                  ?.filter((t) => t.id !== editing?.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Manager
              </label>
              <select
                name="managerId"
                defaultValue={editing?.manager?.id ?? ''}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Nobody</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">
              Which accounts belong here
            </p>
            <p className="mb-3 mt-0.5 text-xs text-slate-500">
              Every line you fill in has to match. Leave them all blank to pick
              accounts by hand.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Countries"
                name="countries"
                placeholder="India, Sri Lanka"
                defaultValue={editing?.rules.countries?.join(', ') ?? ''}
              />
              <Field
                label="States"
                name="states"
                placeholder="Karnataka, Tamil Nadu"
                defaultValue={editing?.rules.states?.join(', ') ?? ''}
              />
              <Field
                label="Cities"
                name="cities"
                defaultValue={editing?.rules.cities?.join(', ') ?? ''}
              />
              <Field
                label="Industries"
                name="industries"
                defaultValue={editing?.rules.industries?.join(', ') ?? ''}
              />
              <Field
                label="Minimum staff"
                name="minEmployees"
                type="number"
                min={0}
                defaultValue={editing?.rules.minEmployees ?? ''}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={save.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {save.isPending ? 'Saving…' : 'Save territory'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
