'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import {
  Article,
  ArticleCategory,
  ArticleDetail,
  KbSearchAnalytics,
  KbStats,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const statusStyle: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-700',
  DRAFT: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const qc = useQueryClient();
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const articles = useQuery({
    queryKey: ['kb', 'articles', status, categoryId, search],
    queryFn: async () =>
      (
        await api.get<Article[]>('/kb/articles', {
          params: {
            ...(status ? { status } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(search ? { search } : {}),
          },
        })
      ).data,
  });

  const categories = useQuery({
    queryKey: ['kb', 'categories'],
    queryFn: async () =>
      (await api.get<ArticleCategory[]>('/kb/categories')).data,
  });

  const stats = useQuery({
    queryKey: ['kb', 'stats'],
    queryFn: async () => (await api.get<KbStats>('/kb/stats')).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['kb'] });
  };

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post<Article>('/kb/articles', body)).data,
    onSuccess: (article) => {
      setComposing(false);
      refresh();
      setOpenId(article.id);
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save the article'),
  });

  const columns: Column<Article>[] = [
    {
      key: 'title',
      header: 'Article',
      render: (a) => (
        <div>
          <button
            className="font-medium text-slate-800 hover:text-brand-700"
            onClick={() => setOpenId(a.id)}
          >
            {a.title}
          </button>
          <p className="text-xs text-slate-400">/{a.slug}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            statusStyle[a.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {a.status}
        </span>
      ),
    },
    {
      key: 'visibility',
      header: 'Audience',
      render: (a) => (
        <span className="text-xs text-slate-600">
          {a.visibility === 'INTERNAL' ? 'Internal only' : 'Help centre'}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (a) => (
        <span className="text-sm text-slate-600">
          {a.category?.name ?? '—'}
        </span>
      ),
    },
    { key: 'locale', header: 'Language' },
    {
      key: 'viewCount',
      header: 'Reads',
      render: (a) => (
        <span className="text-sm">
          {a.viewCount}
          {a.helpfulCount + a.notHelpfulCount > 0 && (
            <span className="ml-2 text-xs text-slate-400">
              {a.helpfulCount}↑ {a.notHelpfulCount}↓
            </span>
          )}
        </span>
      ),
    },
  ];

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tags = String(form.get('tags') || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setError(null);
    create.mutate({
      title: String(form.get('title')),
      excerpt: String(form.get('excerpt') || '') || undefined,
      body: String(form.get('body')),
      visibility: String(form.get('visibility')),
      locale: String(form.get('locale') || 'en'),
      categoryId: String(form.get('categoryId') || '') || undefined,
      ...(tags.length ? { tags } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setInsightsOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Search insights
            </button>
            <button
              onClick={() => setCategoriesOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Categories
            </button>
            {tenantId && (
              <a
                href={`/help/${tenantId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                View help centre
              </a>
            )}
            <button
              onClick={() => setComposing(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + New article
            </button>
          </div>
        }
      />

      {stats.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        stats.data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Articles" value={stats.data.total} />
            <Stat label="Published" value={stats.data.published} />
            <Stat label="Drafts" value={stats.data.drafts} />
            <Stat label="Internal only" value={stats.data.internal} />
            <Stat label="Reads" value={stats.data.totalViews} />
          </div>
        )
      )}

      {stats.data && stats.data.needsWork.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            Voted down more often than up — worth a rewrite
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {stats.data.needsWork.map((a) => (
              <li key={a.slug}>
                {a.title}{' '}
                <span className="text-xs">
                  ({a.helpful} helpful / {a.notHelpful} not)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search articles…"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Any status</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={articles.data ?? []}
        loading={articles.isLoading}
        emptyText="No articles yet. Write the answer you keep repeating."
      />

      <Modal
        open={composing}
        wide
        title="New article"
        onClose={() => setComposing(false)}
      >
        <form onSubmit={onCreate} className="space-y-3">
          <Field label="Title" name="title" required />
          <Field label="Short summary" name="excerpt" />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Body
            </label>
            <textarea
              name="body"
              required
              rows={8}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Audience
              </label>
              <select
                name="visibility"
                defaultValue="PUBLIC"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="PUBLIC">Help centre (customers)</option>
                <option value="INTERNAL">Internal only (agents)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                name="categoryId"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">No category</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Language" name="locale" defaultValue="en" />
            <Field label="Tags (comma separated)" name="tags" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-slate-500">
            Saved as a draft. Nothing reaches the help centre until you publish
            it.
          </p>
          <Button type="submit" loading={create.isPending}>
            Save draft
          </Button>
        </form>
      </Modal>

      {openId && (
        <ArticleModal
          id={openId}
          categories={categories.data ?? []}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}

      <CategoriesModal
        open={categoriesOpen}
        categories={categories.data ?? []}
        onClose={() => setCategoriesOpen(false)}
        onChanged={refresh}
      />

      <InsightsModal
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
      />
    </div>
  );
}

/** Editing, publishing and version history for one article. */
function ArticleModal({
  id,
  categories,
  onClose,
  onChanged,
}: {
  id: string;
  categories: ArticleCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'edit' | 'history' | 'feedback'>('edit');

  const article = useQuery({
    queryKey: ['kb', 'article', id],
    queryFn: async () => (await api.get<ArticleDetail>(`/kb/articles/${id}`)).data,
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['kb', 'article', id] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.patch(`/kb/articles/${id}`, body)).data,
    onSuccess: done,
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not save'),
  });

  const publish = useMutation({
    mutationFn: async (note?: string) =>
      (await api.post(`/kb/articles/${id}/publish`, { note })).data,
    onSuccess: done,
  });

  const archive = useMutation({
    mutationFn: async () =>
      (await api.post(`/kb/articles/${id}/archive`, {})).data,
    onSuccess: done,
  });

  const restore = useMutation({
    mutationFn: async (version: number) =>
      (await api.post(`/kb/articles/${id}/restore`, { version })).data,
    onSuccess: done,
  });

  const onSave = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const tags = String(form.get('tags') || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    setError(null);
    save.mutate({
      title: String(form.get('title')),
      excerpt: String(form.get('excerpt') || ''),
      body: String(form.get('body')),
      visibility: String(form.get('visibility')),
      categoryId: String(form.get('categoryId') || '') || undefined,
      tags,
    });
  };

  const a = article.data;

  return (
    <Modal open wide title={a?.title ?? 'Article'} onClose={onClose}>
      {article.isLoading || !a ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                statusStyle[a.status] ?? 'bg-slate-100'
              }`}
            >
              {a.status}
            </span>
            <span className="text-slate-500">
              v{a.version} · {a.locale} ·{' '}
              {a.visibility === 'INTERNAL' ? 'internal only' : 'help centre'}
            </span>
          </div>

          {a.unpublishedChanges && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This draft differs from the published version. Customers still see
              v{a.version} until you publish.
            </p>
          )}

          <div className="flex gap-4 border-b border-slate-200 text-sm">
            {(['edit', 'history', 'feedback'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-2 capitalize ${
                  tab === t
                    ? 'border-brand-600 font-medium text-brand-700'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {t === 'history' ? `history (${a.versions.length})` : t}
              </button>
            ))}
          </div>

          {tab === 'edit' && (
            <form onSubmit={onSave} className="space-y-3">
              <Field label="Title" name="title" defaultValue={a.title} required />
              <Field
                label="Short summary"
                name="excerpt"
                defaultValue={a.excerpt ?? ''}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Body
                </label>
                <textarea
                  name="body"
                  defaultValue={a.body}
                  rows={10}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Audience
                  </label>
                  <select
                    name="visibility"
                    defaultValue={a.visibility}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="PUBLIC">Help centre (customers)</option>
                    <option value="INTERNAL">Internal only (agents)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Category
                  </label>
                  <select
                    name="categoryId"
                    defaultValue={a.category?.id ?? ''}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">No category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Field
                label="Tags (comma separated)"
                name="tags"
                defaultValue={a.tags.join(', ')}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {save.isPending ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  disabled={publish.isPending}
                  onClick={() => {
                    const note = window.prompt('What changed? (optional)') ?? '';
                    publish.mutate(note || undefined);
                  }}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {publish.isPending ? 'Publishing…' : 'Publish'}
                </button>
                {a.status !== 'ARCHIVED' && (
                  <button
                    type="button"
                    onClick={() => archive.mutate()}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Archive
                  </button>
                )}
              </div>
            </form>
          )}

          {tab === 'history' && (
            <ul className="space-y-2">
              {a.versions.length === 0 && (
                <li className="text-sm text-slate-500">
                  Never published, so there is nothing to roll back to yet.
                </li>
              )}
              {a.versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">
                      v{v.version}
                      {v.version === a.version && (
                        <span className="ml-2 text-xs text-green-700">live</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {v.note || 'No note'} ·{' '}
                      {new Date(v.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {/* Restoring the live version is how an agent throws away a
                      draft they no longer want. */}
                  {(v.version !== a.version || a.unpublishedChanges) && (
                    <button
                      className="text-sm text-brand-700 hover:underline"
                      onClick={() => restore.mutate(v.version)}
                    >
                      {v.version === a.version ? 'Discard draft' : 'Restore'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {tab === 'feedback' && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {a.helpfulCount} found this helpful, {a.notHelpfulCount} did not.
              </p>
              {a.feedback.filter((f) => f.comment).length === 0 && (
                <p className="text-sm text-slate-500">
                  No written comments yet.
                </p>
              )}
              {a.feedback
                .filter((f) => f.comment)
                .map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className={f.helpful ? 'text-green-700' : 'text-red-600'}>
                      {f.helpful ? 'Helpful' : 'Not helpful'}
                    </span>
                    <p className="text-slate-700">{f.comment}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CategoriesModal({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: ArticleCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const create = useMutation({
    mutationFn: async (body: { name: string; description?: string }) =>
      (await api.post('/kb/categories', body)).data,
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/kb/categories/${id}`)).data,
    onSuccess: onChanged,
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      name: String(form.get('name')),
      description: String(form.get('description') || '') || undefined,
    });
    e.currentTarget.reset();
  };

  return (
    <Modal open={open} title="Categories" onClose={onClose}>
      <div className="space-y-4">
        <ul className="space-y-2">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c._count?.articles ?? 0} articles
                </p>
              </div>
              <button
                className="text-sm text-red-600 hover:underline"
                onClick={() => remove.mutate(c.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onSubmit} className="space-y-3 border-t border-slate-200 pt-4">
          <Field label="Name" name="name" required />
          <Field label="Description" name="description" />
          <Button type="submit" loading={create.isPending}>
            Add category
          </Button>
        </form>
      </div>
    </Modal>
  );
}

/** What customers searched for, and what the knowledge base could not answer. */
function InsightsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const analytics = useQuery({
    queryKey: ['kb', 'search-analytics'],
    queryFn: async () =>
      (await api.get<KbSearchAnalytics>('/kb/search-analytics')).data,
    enabled: open,
  });

  return (
    <Modal open={open} title="What people search for" onClose={onClose}>
      {analytics.isLoading || !analytics.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {analytics.data.totalSearches} searches in the last 30 days ·{' '}
            {analytics.data.noResults} found nothing (
            {analytics.data.noResultRate}%)
          </p>

          <div>
            <p className="mb-2 text-sm font-semibold">
              Gaps worth writing about
            </p>
            {analytics.data.gaps.length === 0 ? (
              <p className="text-sm text-slate-500">
                Every search found something.
              </p>
            ) : (
              <ul className="space-y-1">
                {analytics.data.gaps.map((g) => (
                  <li
                    key={g.query}
                    className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>{g.query}</span>
                    <span className="text-xs text-slate-500">
                      {g.searches} searches · {g.misses} with no answer
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Most searched</p>
            <ul className="space-y-1">
              {analytics.data.topQueries.map((q) => (
                <li
                  key={q.query}
                  className="flex justify-between px-1 text-sm text-slate-700"
                >
                  <span>{q.query}</span>
                  <span className="text-xs text-slate-500">{q.searches}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
