'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  AiCoaching,
  AiInsight,
  AiQueryResult,
  AtRiskDeal,
  Contact,
  Paginated,
  ScoreboardRow,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Chart } from '@/components/ui/Chart';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';

const bandStyle: Record<string, string> = {
  hot: 'bg-red-100 text-red-700',
  warm: 'bg-amber-100 text-amber-700',
  cold: 'bg-slate-100 text-slate-600',
  healthy: 'bg-green-100 text-green-700',
  watch: 'bg-amber-100 text-amber-700',
  at_risk: 'bg-red-100 text-red-700',
};

export default function AiPage() {
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<AiQueryResult | null>(null);
  const [coaching, setCoaching] = useState<AiCoaching | null>(null);
  const [insights, setInsights] = useState<AiInsight[] | null>(null);

  const scoreboard = useQuery({
    queryKey: ['ai', 'scoreboard'],
    queryFn: async () => (await api.get<ScoreboardRow[]>('/ai/scoreboard')).data,
  });

  const atRisk = useQuery({
    queryKey: ['ai', 'at-risk'],
    queryFn: async () => (await api.get<AtRiskDeal[]>('/ai/deals/at-risk')).data,
  });

  const contacts = useQuery({
    queryKey: ['contacts', 'for-ai'],
    queryFn: async () =>
      (await api.get<Paginated<Contact>>('/contacts', { params: { limit: 100 } }))
        .data.data,
  });

  const scoreAll = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.post(`/ai/score/contact/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai'] }),
  });

  const coach = useMutation({
    mutationFn: async (contactId: string) =>
      (await api.get<AiCoaching>(`/ai/coach/contact/${contactId}`)).data,
    onSuccess: (data) => setCoaching(data),
  });

  const history = useMutation({
    mutationFn: async (contactId: string) =>
      (await api.get<AiInsight[]>(`/ai/insights/contact/${contactId}`)).data,
    onSuccess: (data) => setInsights(data),
  });

  const ask = useMutation({
    mutationFn: async (q: string) =>
      (await api.post<AiQueryResult>('/ai/ask', { question: q })).data,
    onSuccess: (data) => setAsked(data),
  });

  const onAsk = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (question.trim()) ask.mutate(question.trim());
  };

  return (
    <div>
      <PageHeader
        title="AI"
        action={
          <button
            onClick={() =>
              scoreAll.mutate((contacts.data ?? []).map((c) => c.id))
            }
            disabled={scoreAll.isPending || !contacts.data?.length}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {scoreAll.isPending ? 'Scoring…' : 'Rescore all contacts'}
          </button>
        }
      />

      {/* Ask */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Ask a question</h2>
        <p className="mt-0.5 mb-3 text-sm text-slate-500">
          Answered by running one of the reports — the model picks which, it
          never writes a query.
        </p>
        <form onSubmit={onAsk} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How is our pipeline looking by stage?"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={ask.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Ask
          </button>
        </form>

        {asked && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-700">{asked.answer}</p>
            {asked.report && (
              <div className="mt-3">
                <Chart report={asked.report} type="table" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lead scores */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">
            Lead scores
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Computed from replies, calls answered, email opens, open deals and
            recency — the model only writes the explanation.
          </p>

          {scoreboard.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (scoreboard.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No scores yet — run &ldquo;Rescore all contacts&rdquo;.
            </p>
          ) : (
            <div className="space-y-2">
              {scoreboard.data!.map((row) => (
                <div
                  key={row.contactId}
                  className="rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">{row.score}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          bandStyle[row.label ?? ''] ?? 'bg-slate-100'
                        }`}
                      >
                        {row.label}
                      </span>
                      <span className="text-sm font-medium">{row.name}</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => coach.mutate(row.contactId)}
                        className="text-brand-600 hover:text-brand-700"
                      >
                        Coach
                      </button>
                      <button
                        onClick={() => history.mutate(row.contactId)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        History
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{row.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* At-risk deals */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">
            Deals needing attention
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Stage probability adjusted for momentum: silence, age and overdue
            close dates pull it down.
          </p>

          {atRisk.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (atRisk.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Every open deal looks healthy.
            </p>
          ) : (
            <div className="space-y-2">
              {atRisk.data!.map((deal) => (
                <div
                  key={deal.dealId}
                  className="rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">
                      {deal.probability}%
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        bandStyle[deal.label] ?? 'bg-slate-100'
                      }`}
                    >
                      {deal.label.replace('_', ' ')}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {deal.title}
                    </span>
                  </div>
                  {deal.risks.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {deal.risks.map((r, i) => (
                        <li key={i} className="text-xs text-red-600">
                          {r.impact} {r.label} — {r.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Coaching */}
      <Modal
        open={Boolean(coaching)}
        title="Next best action"
        onClose={() => setCoaching(null)}
      >
        {coaching && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{coaching.action}</p>
            <p className="text-slate-500">{coaching.reason}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Best channel
                </p>
                <p className="mt-1 font-semibold">
                  {coaching.bestChannel ?? 'No reply history yet'}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Best time
                </p>
                <p className="mt-1 font-semibold">
                  {coaching.bestTime ?? 'Not enough history'}
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Insight history */}
      <Modal
        open={Boolean(insights)}
        title="Insight history"
        onClose={() => setInsights(null)}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {(insights?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">Nothing recorded yet.</p>
          ) : (
            insights!.map((i) => (
              <div
                key={i.id}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-slate-500">
                    {i.type}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(i.createdAt).toLocaleString()} · {i.source}
                  </span>
                </div>
                <p className="mt-1">{i.summary}</p>
                {i.factors.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {i.factors.map((f, idx) => (
                      <li
                        key={idx}
                        className={`text-xs ${
                          f.impact > 0 ? 'text-green-700' : 'text-red-600'
                        }`}
                      >
                        {f.impact > 0 ? '+' : ''}
                        {f.impact} {f.label} — {f.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>

      <p className="mt-6 text-xs text-slate-400">
        Scores and probabilities are computed from your CRM data and are
        identical with or without an AI provider configured. Set{' '}
        <code>OPENAI_API_KEY</code> to have a model write the explanations.
      </p>
    </div>
  );
}
