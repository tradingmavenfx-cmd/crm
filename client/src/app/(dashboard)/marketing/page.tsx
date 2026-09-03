'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import {
  AttributionReport,
  CampaignRoi,
  LandingPage,
  MarketingForm,
  PageBlock,
  PageStat,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const MODELS = [
  { value: 'first', label: 'First touch' },
  { value: 'last', label: 'Last touch' },
  { value: 'linear', label: 'Linear' },
] as const;

export default function MarketingPage() {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const [model, setModel] = useState<'first' | 'last' | 'linear'>('linear');
  const [editing, setEditing] = useState<LandingPage | null>(null);
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = useQuery({
    queryKey: ['marketing', 'pages'],
    queryFn: async () =>
      (await api.get<LandingPage[]>('/marketing/pages')).data,
  });

  const stats = useQuery({
    queryKey: ['marketing', 'pages', 'stats'],
    queryFn: async () =>
      (await api.get<PageStat[]>('/marketing/pages/stats')).data,
  });

  const forms = useQuery({
    queryKey: ['marketing', 'forms'],
    queryFn: async () =>
      (await api.get<MarketingForm[]>('/marketing/forms')).data,
  });

  const attribution = useQuery({
    queryKey: ['marketing', 'attribution', model],
    queryFn: async () =>
      (
        await api.get<AttributionReport>('/marketing/attribution', {
          params: { model },
        })
      ).data,
  });

  const roi = useQuery({
    queryKey: ['marketing', 'roi', model],
    queryFn: async () =>
      (await api.get<CampaignRoi>('/marketing/roi', { params: { model } })).data,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['marketing'] });

  const savePage = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      editing
        ? (await api.patch(`/marketing/pages/${editing.id}`, body)).data
        : (await api.post('/marketing/pages', body)).data,
    onSuccess: () => {
      setEditing(null);
      setCreating(false);
      refresh();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save'),
  });

  const publish = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      (
        await api.post(
          `/marketing/pages/${id}/${on ? 'publish' : 'unpublish'}`,
          {},
        )
      ).data,
    onSuccess: refresh,
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not publish'),
  });

  const createForm = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/marketing/forms', body)).data,
    onSuccess: () => {
      setFormOpen(false);
      refresh();
    },
  });

  const statFor = (id: string) => stats.data?.find((s) => s.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setFormOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              New form
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setError(null);
                setCreating(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New landing page
            </button>
          </div>
        }
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Landing pages</h2>
        {pages.isLoading ? (
          <Skeleton className="h-32" />
        ) : pages.data?.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No pages yet. A published page collects leads on its own.
          </p>
        ) : (
          pages.data?.map((p) => {
            const stat = statFor(p.id);
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
                style={{ marginLeft: p.variantOfId ? 24 : 0 }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {p.title}
                      {p.variantOf && (
                        <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">
                          variant of {p.variantOf.title}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      /{p.slug} · {p.status.toLowerCase()}
                      {p.form ? ` · form: ${p.form.name}` : ' · no form'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {p.status === 'PUBLISHED' && tenantId && (
                      <a
                        href={`/p/${tenantId}/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-700 hover:underline"
                      >
                        View
                      </a>
                    )}
                    <button
                      onClick={() => {
                        setError(null);
                        setEditing(p);
                      }}
                      className="text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() =>
                        publish.mutate({
                          id: p.id,
                          on: p.status !== 'PUBLISHED',
                        })
                      }
                      className="text-slate-600 hover:underline"
                    >
                      {p.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                    </button>
                  </div>
                </div>

                {stat && (
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">Views</p>
                      <p className="font-medium">{stat.views}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Submissions</p>
                      <p className="font-medium">{stat.submissions}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Converting at</p>
                      <p className="font-medium">{stat.conversionRate}%</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Forms</h2>
        <ul className="space-y-2">
          {forms.data?.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="font-medium text-slate-900">{f.name}</p>
                <p className="text-xs text-slate-500">
                  {(f.fields ?? []).map((x) => x.label).join(', ') || 'No fields'}
                  {f.assignTo
                    ? ` · goes to ${f.assignTo.firstName}`
                    : ' · shared out by lead load'}
                </p>
              </div>
              <span className="text-sm text-slate-500">
                {f._count.submissions} submission
                {f._count.submissions === 1 ? '' : 's'}
              </span>
            </li>
          ))}
          {forms.data?.length === 0 && (
            <li className="text-sm text-slate-500">No forms yet.</li>
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Where the won revenue came from
          </h2>
          <div className="flex gap-1">
            {MODELS.map((m) => (
              <button
                key={m.value}
                onClick={() => setModel(m.value)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  model === m.value
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {attribution.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Won
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {inr(attribution.data.wonRevenue)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Traceable to marketing
                </p>
                <p className="mt-1 text-2xl font-bold text-green-700">
                  {inr(attribution.data.creditedRevenue)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  No marketing touch
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-500">
                  {inr(attribution.data.uncreditedRevenue)}
                </p>
              </div>
            </div>

            <ul className="space-y-2">
              {attribution.data.rows.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-sm"
                >
                  <span>
                    <span className="mr-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {r.kind}
                    </span>
                    {r.label}
                  </span>
                  <span className="font-semibold">{inr(r.revenue)}</span>
                </li>
              ))}
              {attribution.data.rows.length === 0 && (
                <li className="text-sm text-slate-500">
                  Nothing won yet can be traced back to a campaign or a page.
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Campaign return, on the same split
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Campaign</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
                <th className="px-4 py-3 text-right font-medium">Sent</th>
                <th className="px-4 py-3 text-right font-medium">Opened</th>
                <th className="px-4 py-3 text-right font-medium">Clicked</th>
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {roi.data?.rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {c.name}
                    <span className="ml-2 text-xs text-slate-400">
                      {c.channel.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{inr(c.cost)}</td>
                  <td className="px-4 py-3 text-right">{c.sent}</td>
                  <td className="px-4 py-3 text-right">{c.opened}</td>
                  <td className="px-4 py-3 text-right">{c.clicked}</td>
                  <td className="px-4 py-3 text-right">{inr(c.revenue)}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      c.roi === null
                        ? 'text-slate-400'
                        : c.roi >= 0
                          ? 'text-green-700'
                          : 'text-red-600'
                    }`}
                  >
                    {c.roi === null ? 'no spend' : `${c.roi}%`}
                  </td>
                </tr>
              ))}
              {roi.data?.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No campaigns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <PageEditor
        open={creating || Boolean(editing)}
        page={editing}
        forms={forms.data ?? []}
        pages={pages.data ?? []}
        saving={savePage.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={(body) => savePage.mutate(body)}
      />

      <Modal open={formOpen} title="New form" onClose={() => setFormOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const fields = String(data.get('fields') || '')
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
              .map((name) => ({
                name,
                label: name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
                type: name.toLowerCase().includes('email') ? 'email' : 'text',
                required: name === 'email' || name === 'firstName',
              }));
            createForm.mutate({
              name: String(data.get('name')),
              fields,
              thankYou: String(data.get('thankYou') || '') || undefined,
            });
          }}
        >
          <Field label="Name" name="name" required />
          <Field
            label="Fields (comma separated)"
            name="fields"
            defaultValue="firstName, email, company"
          />
          <Field label="Thank-you message" name="thankYou" />
          <p className="text-xs text-slate-500">
            firstName, email, phone, company and jobTitle are recognised and go
            onto the lead; anything else is kept with the submission.
          </p>
          <button
            type="submit"
            disabled={createForm.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {createForm.isPending ? 'Saving…' : 'Create form'}
          </button>
        </form>
      </Modal>
    </div>
  );
}

/** Blocks are edited as a list — the same data a drag-and-drop editor produces. */
function PageEditor({
  open,
  page,
  forms,
  pages,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  page: LandingPage | null;
  forms: MarketingForm[];
  pages: LandingPage[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [blocks, setBlocks] = useState<PageBlock[]>(page?.blocks ?? []);
  const [key, setKey] = useState(page?.id ?? 'new');

  // Reset the block list when a different page is opened.
  if (key !== (page?.id ?? 'new')) {
    setKey(page?.id ?? 'new');
    setBlocks(page?.blocks ?? []);
  }

  const move = (i: number, by: number) => {
    const next = [...blocks];
    const target = i + by;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target], next[i]];
    setBlocks(next);
  };

  return (
    <Modal
      open={open}
      wide
      title={page ? `Edit ${page.title}` : 'New landing page'}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          onSave({
            title: String(form.get('title')),
            metaTitle: String(form.get('metaTitle') || '') || undefined,
            metaDescription:
              String(form.get('metaDescription') || '') || undefined,
            formId: String(form.get('formId') || ''),
            blocks,
            ...(page
              ? {}
              : {
                  variantOfId:
                    String(form.get('variantOfId') || '') || undefined,
                }),
          });
        }}
      >
        <Field label="Title" name="title" required defaultValue={page?.title} />

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-2 text-sm font-medium text-slate-700">Content</p>
          <ul className="space-y-2">
            {blocks.map((b, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {b.type}
                  </span>
                  {b.type !== 'form' && (
                    <input
                      value={b.type === 'image' ? (b.src ?? '') : (b.text ?? '')}
                      onChange={(e) => {
                        const next = [...blocks];
                        next[i] =
                          b.type === 'image'
                            ? { ...b, src: e.target.value }
                            : { ...b, text: e.target.value };
                        setBlocks(next);
                      }}
                      placeholder={
                        b.type === 'image' ? 'Image URL' : 'Text to show'
                      }
                      className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm"
                    />
                  )}
                  {b.type === 'form' && (
                    <span className="flex-1 text-xs text-slate-500">
                      The form chosen below is rendered here.
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    className="text-xs text-slate-500"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    className="text-xs text-slate-500"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlocks(blocks.filter((_, x) => x !== i))}
                    className="text-xs text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['heading', 'text', 'image', 'form', 'button'] as const).map(
              (type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBlocks([...blocks, { type }])}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white"
                >
                  + {type}
                </button>
              ),
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Form
          </label>
          <select
            name="formId"
            defaultValue={page?.form?.id ?? ''}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">No form</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {!page && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Test against an existing page
            </label>
            <select
              name="variantOfId"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">No — this is its own page</option>
              {pages
                .filter((p) => !p.variantOfId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Visitors are split between the two, and each one&apos;s views and
              submissions are counted separately.
            </p>
          </div>
        )}

        <Field
          label="SEO title"
          name="metaTitle"
          defaultValue={page?.metaTitle ?? ''}
        />
        <Field
          label="SEO description"
          name="metaDescription"
          defaultValue={page?.metaDescription ?? ''}
        />

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save page'}
        </button>
      </form>
    </Modal>
  );
}
