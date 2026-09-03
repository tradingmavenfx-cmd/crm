'use client';

import { FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  CrmDocument,
  DocumentActivity,
  DocumentDetail,
  DocumentFolder,
  DocumentTemplate,
  ExpiringDocument,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

const kb = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function DocumentsPage() {
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ['documents', folderId, search],
    queryFn: async () =>
      (
        await api.get<CrmDocument[]>('/documents', {
          params: {
            ...(folderId ? { folderId } : {}),
            ...(search ? { search } : {}),
          },
        })
      ).data,
  });

  const folders = useQuery({
    queryKey: ['documents', 'folders'],
    queryFn: async () =>
      (await api.get<DocumentFolder[]>('/documents/folders')).data,
  });

  const expiring = useQuery({
    queryKey: ['documents', 'expiring'],
    queryFn: async () =>
      (await api.get<ExpiringDocument[]>('/documents/expiring')).data,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['documents'] });

  const upload = useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post<CrmDocument>('/documents', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data,
    onSuccess: () => {
      setUploading(false);
      refresh();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      setError(err.response?.data?.message ?? 'Could not upload that file'),
  });

  const addFolder = useMutation({
    mutationFn: async (name: string) =>
      (await api.post('/documents/folders', { name })).data,
    onSuccess: refresh,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setTemplatesOpen(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Templates
            </button>
            <button
              onClick={() => {
                const name = window.prompt('Folder name');
                if (name) addFolder.mutate(name);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              New folder
            </button>
            <button
              onClick={() => {
                setError(null);
                setUploading(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              + Upload
            </button>
          </div>
        }
      />

      {expiring.data && expiring.data.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            Contracts running out
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {expiring.data.map((d) => (
              <li key={d.id}>
                {d.name}
                <span className="ml-2 text-xs">
                  {d.daysLeft <= 0
                    ? 'expired'
                    : `${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} left`}
                  {d.company ? ` · ${d.company}` : ''}
                  {d.owner ? ` · ${d.owner}` : ''}
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
          placeholder="Search documents…"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All folders</option>
          {folders.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f._count.documents})
            </option>
          ))}
        </select>
      </div>

      {documents.isLoading ? (
        <Skeleton className="h-40" />
      ) : documents.data?.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nothing here yet. Upload a contract or generate one from a template.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.data?.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div>
                <button
                  onClick={() => setOpenId(d.id)}
                  className="text-left font-medium text-slate-800 hover:text-brand-700"
                >
                  {d.name}
                </button>
                <p className="text-xs text-slate-400">
                  v{d.version} · {kb(d.size)}
                  {d.folder ? ` · ${d.folder.name}` : ''}
                  {d.tags.length ? ` · ${d.tags.join(', ')}` : ''}
                  {d.expiresAt
                    ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {d._count && d._count.shares > 0 && (
                  <span className="text-xs text-slate-400">
                    {d._count.shares} link
                    {d._count.shares === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  onClick={() => setOpenId(d.id)}
                  className="text-brand-700 hover:underline"
                >
                  Open
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={uploading}
        title="Upload a document"
        onClose={() => setUploading(false)}
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            setError(null);
            upload.mutate(new FormData(e.currentTarget));
          }}
        >
          <div>
            <label
              htmlFor="doc-file"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              File
            </label>
            <input
              id="doc-file"
              name="file"
              type="file"
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <Field label="Name (defaults to the filename)" name="name" />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Folder
            </label>
            <select
              name="folderId"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">No folder</option>
              {folders.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <Field label="Tags (comma separated)" name="tags" />
          <Field
            label="Expires on (for contracts)"
            name="expiresAt"
            type="date"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={upload.isPending}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </Modal>

      {openId && (
        <DocumentModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onGenerated={refresh}
      />
    </div>
  );
}

function DocumentModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'versions' | 'links' | 'activity'>('versions');
  const [newLink, setNewLink] = useState<string | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);

  const document = useQuery({
    queryKey: ['documents', id],
    queryFn: async () => (await api.get<DocumentDetail>(`/documents/${id}`)).data,
  });

  const activity = useQuery({
    queryKey: ['documents', id, 'activity'],
    queryFn: async () =>
      (await api.get<DocumentActivity>(`/documents/${id}/activity`)).data,
    enabled: tab === 'activity',
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['documents', id] });
    onChanged();
  };

  const addVersion = useMutation({
    mutationFn: async (form: FormData) =>
      (
        await api.post(`/documents/${id}/versions`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data,
    onSuccess: done,
  });

  const share = useMutation({
    mutationFn: async (requireSignature: boolean) =>
      (
        await api.post<{ token: string }>(`/documents/${id}/shares`, {
          requireSignature,
        })
      ).data,
    onSuccess: (result) => {
      setNewLink(`${window.location.origin}/d/${result.token}`);
      done();
    },
  });

  const revoke = useMutation({
    mutationFn: async (shareId: string) =>
      (await api.delete(`/documents/shares/${shareId}`)).data,
    onSuccess: done,
  });

  const d = document.data;

  return (
    <Modal open wide title={d?.name ?? 'Document'} onClose={onClose}>
      {!d ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-slate-400">
            v{d.version} · {kb(d.size)} · {d.mimeType}
            {d.contact
              ? ` · about ${d.contact.firstName} ${d.contact.lastName}`
              : ''}
            {d.company ? ` · ${d.company.name}` : ''}
          </p>

          <div className="flex gap-4 border-b border-slate-200">
            {(['versions', 'links', 'activity'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-2 capitalize ${
                  tab === t
                    ? 'border-brand-600 font-medium text-brand-700'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'versions' && (
            <div className="space-y-3">
              <ul className="space-y-2">
                {d.versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">
                        v{v.version}
                        {v.version === d.version && (
                          <span className="ml-2 text-xs text-green-700">
                            current
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {v.note || 'No note'} · {kb(v.size)} ·{' '}
                        {new Date(v.createdAt).toLocaleString()}
                        {v.author ? ` · ${v.author.firstName}` : ''}
                      </p>
                    </div>
                    <a
                      href={`/api/documents/${id}/download?version=${v.version}`}
                      className="text-brand-700 hover:underline"
                      onClick={(e) => {
                        // The API is on its own origin in development, so the
                        // download is opened against it directly.
                        e.preventDefault();
                        window.open(
                          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/documents/${id}/download?version=${v.version}`,
                          '_blank',
                        );
                      }}
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>

              <form
                className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  if (!versionInput.current?.files?.length) return;
                  addVersion.mutate(form);
                  e.currentTarget.reset();
                }}
              >
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Upload a new version
                  </label>
                  <input
                    ref={versionInput}
                    name="file"
                    type="file"
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <input
                  name="note"
                  placeholder="What changed?"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={addVersion.isPending}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {addVersion.isPending ? 'Uploading…' : 'Add version'}
                </button>
              </form>
            </div>
          )}

          {tab === 'links' && (
            <div className="space-y-3">
              {newLink && (
                <div className="rounded-lg bg-brand-50 p-3">
                  <p className="text-xs font-medium text-brand-800">
                    Copy this now — it is shown once.
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">
                    {newLink}
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(newLink);
                    }}
                    className="mt-2 text-xs text-brand-700 hover:underline"
                  >
                    Copy
                  </button>
                </div>
              )}

              <ul className="space-y-2">
                {d.shares.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm">
                        Pinned to v{s.version}
                        {s.requireSignature && (
                          <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            asks for a name
                          </span>
                        )}
                        {s.revokedAt && (
                          <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                            revoked
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {s.views} view{s.views === 1 ? '' : 's'} · {s.downloads}{' '}
                        download{s.downloads === 1 ? '' : 's'}
                        {s.signedName ? ` · signed by ${s.signedName}` : ''}
                      </p>
                    </div>
                    {!s.revokedAt && (
                      <button
                        onClick={() => revoke.mutate(s.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
                {d.shares.length === 0 && (
                  <li className="text-sm text-slate-500">
                    No links yet.
                  </li>
                )}
              </ul>

              <div className="flex gap-2 border-t border-slate-200 pt-3">
                <button
                  onClick={() => share.mutate(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Share a link
                </button>
                <button
                  onClick={() => share.mutate(true)}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Share and ask for a name
                </button>
              </div>
              <p className="text-xs text-slate-500">
                A link is pinned to the version that exists now, so a later
                edit cannot change what somebody was sent.
              </p>
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-3">
              {!activity.data ? (
                <Skeleton className="h-24" />
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    {activity.data.views} view
                    {activity.data.views === 1 ? '' : 's'} ·{' '}
                    {activity.data.downloads} download
                    {activity.data.downloads === 1 ? '' : 's'}
                    {activity.data.averageSeconds !== null &&
                      ` · open for ${activity.data.averageSeconds}s on average`}
                  </p>
                  <ul className="space-y-1">
                    {activity.data.events.map((e) => (
                      <li
                        key={e.id}
                        className="flex justify-between text-xs text-slate-600"
                      >
                        <span>
                          {e.type}
                          {e.seconds != null && ` · ${e.seconds}s`}
                        </span>
                        <span className="text-slate-400">
                          {e.ipAddress ?? ''}{' '}
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                    {activity.data.events.length === 0 && (
                      <li className="text-sm text-slate-500">
                        Nobody has opened it yet.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TemplatesModal({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState<DocumentTemplate | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ['documents', 'templates'],
    queryFn: async () =>
      (await api.get<DocumentTemplate[]>('/documents/templates')).data,
    enabled: open,
  });

  const contacts = useQuery({
    queryKey: ['contacts', 'for-templates'],
    queryFn: async () =>
      (
        await api.get<{ data?: { id: string; firstName: string; lastName: string }[] }>(
          '/contacts',
          { params: { limit: 100 } },
        )
      ).data,
    enabled: open,
  });

  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/documents/templates', body)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['documents', 'templates'] }),
  });

  const generate = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (
        await api.post<{ unfilledFields: string[] }>(
          '/documents/generate',
          body,
        )
      ).data,
    onSuccess: (created) => {
      setGenerating(null);
      setResult(
        created.unfilledFields.length
          ? `Generated, but these fields had nothing behind them: ${created.unfilledFields.join(', ')}`
          : 'Generated.',
      );
      onGenerated();
    },
  });

  const contactList = contacts.data?.data ?? [];

  return (
    <Modal open={open} wide title="Document templates" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {result && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">
            {result}
          </p>
        )}

        <ul className="space-y-2">
          {templates.data?.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
            >
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-slate-500">{t.kind}</p>
              </div>
              <button
                onClick={() => {
                  setResult(null);
                  setGenerating(t);
                }}
                className="text-brand-700 hover:underline"
              >
                Generate
              </button>
            </li>
          ))}
          {templates.data?.length === 0 && (
            <li className="text-slate-500">No templates yet.</li>
          )}
        </ul>

        {generating ? (
          <form
            className="space-y-3 rounded-lg border border-slate-200 p-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              generate.mutate({
                templateId: generating.id,
                name: String(form.get('name') || '') || undefined,
                contactId: String(form.get('contactId') || '') || undefined,
              });
            }}
          >
            <p className="font-medium">Generate “{generating.name}”</p>
            <Field label="Document name" name="name" defaultValue={generating.name} />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                For which contact
              </label>
              <select
                name="contactId"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Nobody in particular</option>
                {contactList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={generate.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {generate.isPending ? 'Generating…' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => setGenerating(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-3 border-t border-slate-200 pt-4"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              create.mutate({
                name: String(form.get('name')),
                kind: String(form.get('kind')),
                body: String(form.get('body')),
              });
              e.currentTarget.reset();
            }}
          >
            <p className="font-medium text-slate-700">New template</p>
            <Field label="Name" name="name" required />
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Kind
              </label>
              <select
                name="kind"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="contract">Contract</option>
                <option value="proposal">Proposal</option>
                <option value="letter">Letter</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Body
              </label>
              <textarea
                name="body"
                required
                rows={6}
                defaultValue={
                  'Between {{our.name}} and {{contact.fullName}} of {{company.name}}, on {{today}}.'
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-slate-500">
                Merge fields: our.name, today, contact.firstName,
                contact.fullName, contact.email, contact.jobTitle,
                company.name, deal.title, deal.value. A field with nothing
                behind it is left visible so you can see the hole.
              </p>
            </div>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {create.isPending ? 'Saving…' : 'Save template'}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
