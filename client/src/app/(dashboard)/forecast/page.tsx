'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Forecast,
  ForecastAccuracy,
  Quota,
  QuotaPeriodValue,
  TenantUser,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function ForecastPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<QuotaPeriodValue>('QUARTER');
  const [odds, setOdds] = useState({ commit: 0.9, bestCase: 0.5, pipeline: 0.2 });
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The what-if endpoint returns the plain forecast plus the projection, so
  // one call covers both views.
  const forecast = useQuery({
    queryKey: ['forecast', period, odds],
    queryFn: async () =>
      (
        await api.get<Forecast>('/forecast/what-if', {
          params: {
            period,
            commitOdds: odds.commit,
            bestCaseOdds: odds.bestCase,
            pipelineOdds: odds.pipeline,
          },
        })
      ).data,
  });

  const quotas = useQuery({
    queryKey: ['quotas'],
    queryFn: async () => (await api.get<Quota[]>('/quotas')).data,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<TenantUser[]>('/users')).data,
  });

  const accuracy = useQuery({
    queryKey: ['forecast', 'accuracy'],
    queryFn: async () =>
      (await api.get<ForecastAccuracy[]>('/forecast/accuracy')).data,
  });

  const setQuota = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/quotas', body)).data,
    onSuccess: () => {
      setQuotaOpen(false);
      qc.invalidateQueries({ queryKey: ['quotas'] });
      qc.invalidateQueries({ queryKey: ['forecast'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save the quota'),
  });

  const snapshot = useMutation({
    mutationFn: async () =>
      (await api.post('/forecast/snapshot', { period })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forecast', 'accuracy'] }),
  });

  const f = forecast.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forecast"
        action={
          <div className="flex gap-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as QuotaPeriodValue)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="MONTH">This month</option>
              <option value="QUARTER">This quarter</option>
              <option value="YEAR">This year</option>
            </select>
            <button
              onClick={() => snapshot.mutate()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {snapshot.isPending ? 'Saving…' : 'Snapshot the call'}
            </button>
            <button
              onClick={() => {
                setError(null);
                setQuotaOpen(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Set a quota
            </button>
          </div>
        }
      />

      {forecast.isLoading || !f ? (
        <Skeleton className="h-24" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Quota" value={inr(f.total.quota)} />
            <Stat
              label="Closed"
              value={inr(f.total.closed)}
              hint={
                f.total.quota
                  ? `${Math.round((f.total.closed / f.total.quota) * 100)}% of quota`
                  : undefined
              }
            />
            <Stat label="Commit" value={inr(f.total.commit)} />
            <Stat
              label="Weighted pipeline"
              value={inr(f.total.weighted)}
              hint="value × stage probability"
            />
            <Stat
              label="Projected"
              value={inr(f.total.projected ?? 0)}
              hint={
                f.total.shortfall
                  ? `${inr(f.total.shortfall)} short`
                  : 'ahead of quota'
              }
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-700">
              What if the odds change?
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Nothing is saved — this only re-reads the same deals under
              different assumptions.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['commit', 'Commit'],
                  ['bestCase', 'Best case'],
                  ['pipeline', 'Pipeline'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="flex justify-between text-xs font-medium text-slate-600">
                    <span>{label} lands</span>
                    <span>{Math.round(odds[key] * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={odds[key] * 100}
                    onChange={(e) =>
                      setOdds({ ...odds, [key]: Number(e.target.value) / 100 })
                    }
                    className="mt-1 w-full accent-brand-600"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Rep</th>
                  <th className="px-4 py-3 text-right font-medium">Quota</th>
                  <th className="px-4 py-3 text-right font-medium">Closed</th>
                  <th className="px-4 py-3 text-right font-medium">Commit</th>
                  <th className="px-4 py-3 text-right font-medium">Best case</th>
                  <th className="px-4 py-3 text-right font-medium">Pipeline</th>
                  <th className="px-4 py-3 text-right font-medium">Projected</th>
                  <th className="px-4 py-3 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((r) => (
                  <tr
                    key={r.ownerId ?? 'unassigned'}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {r.owner}
                      {r.attainment !== null && (
                        <span className="ml-2 text-xs text-slate-400">
                          {r.attainment}% attained
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{inr(r.quota)}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-700">
                      {inr(r.closed)}
                    </td>
                    <td className="px-4 py-3 text-right">{inr(r.commit)}</td>
                    <td className="px-4 py-3 text-right">{inr(r.bestCase)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {inr(r.pipeline)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {inr(r.projected ?? 0)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right ${
                        (r.gap ?? 0) > 0 ? 'text-red-600' : 'text-slate-400'
                      }`}
                    >
                      {r.gap === null ? '—' : inr(r.gap)}
                    </td>
                  </tr>
                ))}
                {f.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      Nothing expected to close in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {f.dealsWithoutExpectedDate > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {f.dealsWithoutExpectedDate} open deal
              {f.dealsWithoutExpectedDate === 1 ? ' has' : 's have'} no expected
              close date, so {f.dealsWithoutExpectedDate === 1 ? 'it is' : 'they are'}{' '}
              not in any period&apos;s forecast.
            </p>
          )}
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            How good the calls turned out to be
          </h2>
          {accuracy.data?.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing to score yet — a period has to finish first, and a
              snapshot has to exist from near its start.
            </p>
          )}
          <ul className="space-y-2">
            {accuracy.data?.map((a, i) => (
              <li
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {a.owner}
                  <span className="ml-2 text-xs text-slate-400">
                    {new Date(a.periodStart).toLocaleDateString()}
                  </span>
                </span>
                <span>
                  called {inr(a.called)} · landed {inr(a.actual)}
                  {a.accuracy !== null && (
                    <span
                      className={`ml-2 font-medium ${
                        a.accuracy >= 90 ? 'text-green-700' : 'text-amber-700'
                      }`}
                    >
                      {a.accuracy}%
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Quotas</h2>
          {quotas.data?.length === 0 && (
            <p className="text-sm text-slate-500">No quotas set yet.</p>
          )}
          <ul className="space-y-2">
            {quotas.data?.map((q) => (
              <li key={q.id} className="flex justify-between text-sm">
                <span>
                  {q.owner
                    ? `${q.owner.firstName} ${q.owner.lastName}`
                    : (q.territory?.name ?? '—')}
                  <span className="ml-2 text-xs text-slate-400">
                    {q.period.toLowerCase()} from{' '}
                    {new Date(q.periodStart).toLocaleDateString()}
                  </span>
                </span>
                <span className="font-medium">{inr(Number(q.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Modal
        open={quotaOpen}
        title="Set a quota"
        onClose={() => setQuotaOpen(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            setQuota.mutate({
              ownerId: String(form.get('ownerId')),
              period: String(form.get('period')),
              periodStart: String(form.get('periodStart')),
              amount: Number(form.get('amount')),
            });
          }}
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Rep
            </label>
            <select
              name="ownerId"
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period
            </label>
            <select
              name="period"
              defaultValue="QUARTER"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="MONTH">Month</option>
              <option value="QUARTER">Quarter</option>
              <option value="YEAR">Year</option>
            </select>
          </div>
          <Field
            label="Any date inside the period"
            name="periodStart"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Field label="Amount (₹)" name="amount" type="number" min={0} required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={setQuota.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {setQuota.isPending ? 'Saving…' : 'Save quota'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
