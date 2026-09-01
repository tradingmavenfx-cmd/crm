'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/lib/api';
import { ReportMeta, ReportResult, ReportSchedule } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Chart } from '@/components/ui/Chart';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const FAMILY_LABELS: Record<string, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  service: 'Service',
  communication: 'Communication',
};

export default function ReportsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('sales.pipeline');
  const [chart, setChart] = useState<string>('funnel');
  const [days, setDays] = useState<number | ''>('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogue = useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: async () => (await api.get<ReportMeta[]>('/reports')).data,
  });

  const meta = catalogue.data?.find((r) => r.key === selected);

  const report = useQuery({
    queryKey: ['reports', selected, days],
    queryFn: async () =>
      (
        await api.get<ReportResult>(`/reports/${selected}`, {
          params: days ? { days } : {},
        })
      ).data,
  });

  const schedules = useQuery({
    queryKey: ['report-schedules'],
    queryFn: async () =>
      (await api.get<ReportSchedule[]>('/report-schedules')).data,
  });

  const saveSchedule = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/report-schedules', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-schedules'] });
      setScheduleOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const sendNow = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/report-schedules/${id}/send`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  });

  const removeSchedule = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/report-schedules/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedules'] }),
  });

  const pick = (key: string) => {
    setSelected(key);
    const next = catalogue.data?.find((r) => r.key === key);
    setChart(next?.charts[0] ?? 'bar');
  };

  /**
   * The export endpoint needs the auth header, so fetch it and hand the browser
   * a blob rather than linking straight at the URL.
   */
  const exportCsv = async () => {
    const res = await fetch(
      `${API_BASE}/reports/${selected}/export.csv${days ? `?days=${days}` : ''}`,
      { headers: { Authorization: `Bearer ${tokenStore.getAccess()}` } },
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.replace('.', '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onSchedule = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await saveSchedule
      .mutateAsync({
        name: String(form.get('name')),
        reportKey: selected,
        frequency: String(form.get('frequency')),
        sendAt: String(form.get('sendAt') || '09:00'),
        recipients: String(form.get('recipients'))
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
        params: days ? { days } : {},
      })
      .catch(() => undefined);
  };

  const families = [...new Set(catalogue.data?.map((r) => r.family) ?? [])];

  return (
    <div>
      <PageHeader
        title="Reports"
        action={
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Export CSV
            </button>
            <button
              onClick={() => {
                setError(null);
                setScheduleOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Email on a schedule
            </button>
          </div>
        }
      />

      <div className="flex gap-6">
        {/* Catalogue */}
        <div className="w-64 shrink-0">
          {catalogue.isLoading ? (
            <Skeleton className="h-64 w-full rounded-2xl" />
          ) : (
            families.map((family) => (
              <div key={family} className="mb-4">
                <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {FAMILY_LABELS[family] ?? family}
                </p>
                <div className="space-y-0.5">
                  {catalogue
                    .data!.filter((r) => r.family === family)
                    .map((r) => (
                      <button
                        key={r.key}
                        onClick={() => pick(r.key)}
                        className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                          selected === r.key
                            ? 'bg-brand-50 font-medium text-brand-700'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {r.name}
                      </button>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Report */}
        <div className="flex-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{meta?.name ?? selected}</h2>
                {meta && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {meta.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={days}
                  onChange={(e) =>
                    setDays(e.target.value ? Number(e.target.value) : '')
                  }
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  title="Look-back window"
                >
                  <option value="">Default window</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="365">Last year</option>
                </select>
                <select
                  value={chart}
                  onChange={(e) => setChart(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  {(meta?.charts ?? ['bar', 'table']).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {report.isLoading || !report.data ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <>
                {(report.data.stats?.length ?? 0) > 0 && chart !== 'stat' && (
                  <div className="mb-4 flex flex-wrap gap-4">
                    {report.data.stats!.map((s) => (
                      <div key={s.label}>
                        <p className="text-xs uppercase tracking-wide text-slate-400">
                          {s.label}
                        </p>
                        <p className="text-lg font-bold">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Chart report={report.data} type={chart} />
              </>
            )}
          </div>

          {/* Schedules */}
          {(schedules.data?.length ?? 0) > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-slate-500">
                Scheduled report emails
              </h2>
              <div className="space-y-2">
                {schedules.data!.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-slate-400">
                        {s.reportKey} · {s.frequency} at {s.sendAt} ·{' '}
                        {s.recipients.join(', ')}
                        {s.lastSentAt &&
                          ` · last sent ${new Date(s.lastSentAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => sendNow.mutate(s.id)}
                        disabled={sendNow.isPending}
                        className="text-xs text-brand-600 hover:text-brand-700"
                      >
                        Send now
                      </button>
                      <button
                        onClick={() => removeSchedule.mutate(s.id)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={scheduleOpen}
        title={`Email "${meta?.name ?? selected}" on a schedule`}
        onClose={() => setScheduleOpen(false)}
      >
        <form onSubmit={onSchedule} className="space-y-4">
          <Field label="Name" name="name" placeholder="Monday pipeline" required />
          <Field
            label="Recipients (comma separated)"
            name="recipients"
            placeholder="sales@acme.com, ceo@acme.com"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Frequency
              </span>
              <select
                name="frequency"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <Field label="Send at (HH:MM)" name="sendAt" defaultValue="09:00" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={saveSchedule.isPending}>
            Create schedule
          </Button>
        </form>
      </Modal>
    </div>
  );
}
