'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Dashboard, RenderedDashboard, ReportMeta } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Chart } from '@/components/ui/Chart';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const ROLES = [
  'TENANT_ADMIN',
  'MANAGER',
  'SALES_REP',
  'SUPPORT_AGENT',
  'VIEWER',
];

export default function DashboardsPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [reportKey, setReportKey] = useState('sales.pipeline');

  const dashboards = useQuery({
    queryKey: ['dashboards'],
    queryFn: async () => (await api.get<Dashboard[]>('/dashboards')).data,
  });

  // Land on the default dashboard the first time the list arrives.
  useEffect(() => {
    if (!activeId && dashboards.data?.length) setActiveId(dashboards.data[0].id);
  }, [dashboards.data, activeId]);

  const rendered = useQuery({
    queryKey: ['dashboards', 'render', activeId],
    queryFn: async () =>
      (await api.get<RenderedDashboard>(`/dashboards/${activeId}/render`)).data,
    enabled: Boolean(activeId),
    refetchInterval: 60_000,
  });

  const catalogue = useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: async () => (await api.get<ReportMeta[]>('/reports')).data,
  });

  const createDashboard = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/dashboards', body)).data,
    onSuccess: (d: Dashboard) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      setActiveId(d.id);
      setNewOpen(false);
    },
  });

  const addWidget = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post(`/dashboards/${activeId}/widgets`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      setWidgetOpen(false);
    },
  });

  const removeWidget = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/widgets/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const reorder = useMutation({
    mutationFn: async (widgetIds: string[]) =>
      (await api.patch(`/dashboards/${activeId}/widgets/reorder`, { widgetIds }))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const removeDashboard = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/dashboards/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      setActiveId(null);
    },
  });

  const move = (index: number, delta: number) => {
    const ids = rendered.data?.widgets.map((w) => w.id) ?? [];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    createDashboard.mutate({
      name: String(form.get('name')),
      description: String(form.get('description') || '') || undefined,
      isDefault: form.get('isDefault') === 'on',
      visibleToRoles: form.getAll('roles').map(String),
    });
  };

  const onAddWidget = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    addWidget.mutate({
      title: String(form.get('title')),
      reportKey,
      chart: String(form.get('chart')),
      width: String(form.get('width')),
      params: form.get('days') ? { days: Number(form.get('days')) } : {},
    });
  };

  const selectedMeta = catalogue.data?.find((r) => r.key === reportKey);

  return (
    <div>
      <PageHeader
        title="Dashboards"
        action={
          <div className="flex gap-2">
            {activeId && (
              <button
                onClick={() => setWidgetOpen(true)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                + Add widget
              </button>
            )}
            <button
              onClick={() => setNewOpen(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New dashboard
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {dashboards.isLoading ? (
          <Skeleton className="h-8 w-64" />
        ) : (
          dashboards.data?.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveId(d.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                activeId === d.id
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {d.name}
              {d.isDefault && <span className="ml-1 text-[10px]">★</span>}
            </button>
          ))
        )}
      </div>

      {!activeId ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
          No dashboards yet — create one and add widgets from any report.
        </div>
      ) : rendered.isLoading || !rendered.data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {rendered.data.description && (
            <p className="mb-3 text-sm text-slate-500">
              {rendered.data.description}
              {rendered.data.visibleToRoles.length > 0 && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  visible to {rendered.data.visibleToRoles.join(', ')}
                </span>
              )}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rendered.data.widgets.map((w, i) => (
              <div
                key={w.id}
                className={`rounded-2xl border border-slate-200 bg-white p-4 ${
                  w.width === 'full' ? 'md:col-span-2' : ''
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{w.title}</h3>
                    <p className="font-mono text-[10px] text-slate-400">
                      {w.reportKey}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="hover:text-slate-600 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === rendered.data!.widgets.length - 1}
                      className="hover:text-slate-600 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeWidget.mutate(w.id)}
                      className="hover:text-red-600"
                      aria-label="Remove widget"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {w.error ? (
                  <p className="py-8 text-center text-sm text-red-600">
                    {w.error}
                  </p>
                ) : w.report ? (
                  <Chart report={w.report} type={w.chart} />
                ) : null}
              </div>
            ))}
          </div>

          {rendered.data.widgets.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
              This dashboard has no widgets yet.
            </div>
          )}

          <button
            onClick={() => removeDashboard.mutate(activeId)}
            className="mt-6 text-sm text-slate-400 hover:text-red-600"
          >
            Delete this dashboard
          </button>
        </>
      )}

      {/* New dashboard */}
      <Modal open={newOpen} title="New dashboard" onClose={() => setNewOpen(false)}>
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="Name" name="name" required />
          <Field label="Description" name="description" />
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Visible to (none selected = everyone)
            </span>
            <div className="space-y-1">
              {ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roles" value={role} />
                  {role.replace('_', ' ').toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isDefault" />
            Make this the default dashboard
          </label>
          <Button type="submit" loading={createDashboard.isPending}>
            Create dashboard
          </Button>
        </form>
      </Modal>

      {/* Add widget */}
      <Modal open={widgetOpen} title="Add widget" onClose={() => setWidgetOpen(false)}>
        <form onSubmit={onAddWidget} className="space-y-4">
          <Field label="Title" name="title" required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Report
            </span>
            <select
              value={reportKey}
              onChange={(e) => setReportKey(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {catalogue.data?.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
            {selectedMeta && (
              <span className="mt-1 block text-xs text-slate-500">
                {selectedMeta.description}
              </span>
            )}
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Chart
              </span>
              <select
                name="chart"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {(selectedMeta?.charts ?? ['bar', 'table']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Width
              </span>
              <select
                name="width"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="half">Half</option>
                <option value="full">Full</option>
              </select>
            </label>
            <Field label="Days" name="days" type="number" placeholder="30" />
          </div>
          <Button type="submit" loading={addWidget.isPending}>
            Add widget
          </Button>
        </form>
      </Modal>
    </div>
  );
}
