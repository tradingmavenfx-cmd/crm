'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  BadgeDefinition,
  Contest,
  ContestMetricValue,
  ContestStandings,
  Leaderboard,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const METRICS: { value: ContestMetricValue; label: string }[] = [
  { value: 'REVENUE_WON', label: 'Revenue won' },
  { value: 'DEALS_WON', label: 'Deals won' },
  { value: 'CALLS_MADE', label: 'Calls made' },
  { value: 'MEETINGS_HELD', label: 'Meetings held' },
  { value: 'TICKETS_RESOLVED', label: 'Tickets resolved' },
];

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const medal = ['🥇', '🥈', '🥉'];

const startOf = (window: 'month' | 'quarter' | 'all') => {
  const now = new Date();
  if (window === 'all') return '2000-01-01';
  const month =
    window === 'month'
      ? now.getUTCMonth()
      : Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), month, 1))
    .toISOString()
    .slice(0, 10);
};

export default function LeaderboardPage() {
  const qc = useQueryClient();
  const [window, setWindow] = useState<'month' | 'quarter' | 'all'>('month');
  const [metric, setMetric] = useState<ContestMetricValue | ''>('');
  const [contestOpen, setContestOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ['leaderboard', window, metric],
    queryFn: async () =>
      (
        await api.get<Leaderboard>('/leaderboard', {
          params: { from: startOf(window), ...(metric ? { metric } : {}) },
        })
      ).data,
  });

  const contests = useQuery({
    queryKey: ['contests'],
    queryFn: async () => (await api.get<Contest[]>('/contests')).data,
  });

  const badges = useQuery({
    queryKey: ['badges'],
    queryFn: async () => (await api.get<BadgeDefinition[]>('/badges')).data,
  });

  const standings = useQuery({
    queryKey: ['contests', viewing],
    queryFn: async () =>
      (await api.get<ContestStandings>(`/contests/${viewing}/standings`)).data,
    enabled: Boolean(viewing),
  });

  const createContest = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/contests', body)).data,
    onSuccess: () => {
      setContestOpen(false);
      qc.invalidateQueries({ queryKey: ['contests'] });
    },
  });

  const createBadge = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/badges', body)).data,
    onSuccess: () => {
      setBadgeOpen(false);
      qc.invalidateQueries({ queryKey: ['badges'] });
    },
  });

  const award = useMutation({
    mutationFn: async () =>
      (await api.post<{ awarded: number }>('/badges/award', {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['badges'] }),
  });

  const metricLabel = (m: ContestMetricValue) =>
    METRICS.find((x) => x.value === m)?.label ?? m;

  const formatValue = (m: ContestMetricValue | null, value: number) =>
    m === 'REVENUE_WON' ? inr(value) : value.toLocaleString('en-IN');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => award.mutate()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {award.isPending ? 'Checking…' : 'Award badges'}
            </button>
            <button
              onClick={() => setBadgeOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              New badge
            </button>
            <button
              onClick={() => setContestOpen(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New contest
            </button>
          </div>
        }
      />

      {award.data && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {award.data.awarded === 0
            ? 'Nothing new earned since the last check.'
            : `Awarded ${award.data.awarded} badge${award.data.awarded === 1 ? '' : 's'}.`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(['month', 'quarter', 'all'] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              window === w
                ? 'bg-brand-50 font-medium text-brand-700'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {w === 'all' ? 'All time' : `This ${w}`}
          </button>
        ))}
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as ContestMetricValue | '')}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Overall points</option>
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {board.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">#</th>
                <th className="px-4 py-3 text-left font-medium">Rep</th>
                <th className="px-4 py-3 text-right font-medium">
                  {metric ? metricLabel(metric) : 'Points'}
                </th>
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">Deals</th>
                <th className="px-4 py-3 text-right font-medium">Calls</th>
                <th className="px-4 py-3 text-right font-medium">Meetings</th>
                <th className="px-4 py-3 text-right font-medium">Tickets</th>
              </tr>
            </thead>
            <tbody>
              {board.data?.rows.map((r) => (
                <tr
                  key={r.userId}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3">
                    {medal[r.rank - 1] ?? r.rank}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {r.name}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {metric ? formatValue(metric, r.value ?? 0) : r.points}
                  </td>
                  <td className="px-4 py-3 text-right">{inr(r.revenueWon)}</td>
                  <td className="px-4 py-3 text-right">{r.dealsWon}</td>
                  <td className="px-4 py-3 text-right">{r.callsMade}</td>
                  <td className="px-4 py-3 text-right">{r.meetingsHeld}</td>
                  <td className="px-4 py-3 text-right">{r.ticketsResolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Points are worked out from the records every time this page loads — ₹1,000
        won is 1 point, a won deal 50, a meeting 5, a resolved ticket 3, a call 2.
        Nothing is banked, so a deal that later falls through takes its points
        with it.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Contests</h2>
          {contests.data?.length === 0 && (
            <p className="text-sm text-slate-500">No contests running.</p>
          )}
          <ul className="space-y-2">
            {contests.data?.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {metricLabel(c.metric)} ·{' '}
                      {new Date(c.startsAt).toLocaleDateString()} –{' '}
                      {new Date(c.endsAt).toLocaleDateString()}
                      {c.prize ? ` · ${c.prize}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setViewing(c.id)}
                    className="text-sm text-brand-700 hover:underline"
                  >
                    Standings
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Badges</h2>
          <ul className="space-y-2">
            {badges.data?.map((b) => (
              <li
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <p className="font-medium text-slate-900">{b.name}</p>
                <p className="text-xs text-slate-500">
                  {b.description} · {metricLabel(b.metric)} ≥{' '}
                  {formatValue(b.metric, Number(b.threshold))}
                </p>
                <p className="mt-1 text-xs">
                  {b.earned.length === 0 ? (
                    <span className="text-slate-400">Not earned yet</span>
                  ) : (
                    <span className="text-green-700">
                      {b.earned
                        .map(
                          (e) =>
                            `${e.user.firstName} (${formatValue(b.metric, Number(e.value))})`,
                        )
                        .join(', ')}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Modal
        open={Boolean(viewing)}
        title={standings.data?.contest.name ?? 'Standings'}
        onClose={() => setViewing(null)}
      >
        {!standings.data ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              {metricLabel(standings.data.contest.metric)} ·{' '}
              {standings.data.running ? 'running now' : 'finished'}
            </p>
            <ul className="space-y-2">
              {standings.data.rows.map((r) => (
                <li key={r.userId} className="flex justify-between text-sm">
                  <span>
                    {medal[r.rank - 1] ?? `${r.rank}.`} {r.name}
                  </span>
                  <span className="font-medium">
                    {formatValue(standings.data!.contest.metric, r.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal
        open={contestOpen}
        title="New contest"
        onClose={() => setContestOpen(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            createContest.mutate({
              name: String(form.get('name')),
              metric: String(form.get('metric')),
              startsAt: new Date(String(form.get('startsAt'))).toISOString(),
              endsAt: new Date(String(form.get('endsAt'))).toISOString(),
              prize: String(form.get('prize') || '') || undefined,
            });
          }}
        >
          <Field label="Name" name="name" required />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Measured on
            </label>
            <select
              name="metric"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Field label="Starts" name="startsAt" type="date" required />
          <Field label="Ends" name="endsAt" type="date" required />
          <Field label="Prize" name="prize" />
          <button
            type="submit"
            disabled={createContest.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createContest.isPending ? 'Saving…' : 'Start contest'}
          </button>
        </form>
      </Modal>

      <Modal open={badgeOpen} title="New badge" onClose={() => setBadgeOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            createBadge.mutate({
              key: String(form.get('key')),
              name: String(form.get('name')),
              description: String(form.get('description')),
              metric: String(form.get('metric')),
              threshold: Number(form.get('threshold')),
            });
          }}
        >
          <Field label="Name" name="name" required />
          <Field
            label="Key (lowercase, hyphens)"
            name="key"
            required
            pattern="[a-z0-9]+(?:[-_][a-z0-9]+)*"
          />
          <Field label="Description" name="description" required />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Earned on
            </label>
            <select
              name="metric"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Field label="Reaching" name="threshold" type="number" min={1} required />
          <p className="text-xs text-slate-500">
            Measured over all time and awarded once, so a later bad quarter
            cannot take it back.
          </p>
          <button
            type="submit"
            disabled={createBadge.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createBadge.isPending ? 'Saving…' : 'Create badge'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
