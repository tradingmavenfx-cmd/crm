'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChatRatings, ChatVisitor } from '@/types';
import { useAuthStore } from '@/stores/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Skeleton } from '@/components/ui/Skeleton';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

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

export default function LiveChatPage() {
  const user = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  const visitors = useQuery({
    queryKey: ['chat', 'visitors'],
    queryFn: async () => (await api.get<ChatVisitor[]>('/chat/visitors')).data,
    refetchInterval: 10_000,
  });

  const ratings = useQuery({
    queryKey: ['chat', 'ratings'],
    queryFn: async () => (await api.get<ChatRatings>('/chat/ratings')).data,
  });

  // The widget is served per workspace, so the snippet needs the tenant id.
  const tenantId = user?.tenantId ?? visitors.data?.[0]?.id ?? '';
  const snippet = `<script src="${API_BASE}/chat/${tenantId || 'YOUR_WORKSPACE_ID'}/widget.js" async></script>`;

  const columns: Column<ChatVisitor>[] = [
    {
      key: 'online',
      header: '',
      render: (v) => (
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            v.online ? 'bg-green-500' : 'bg-slate-300'
          }`}
          title={v.online ? 'Online' : 'Offline'}
        />
      ),
    },
    {
      key: 'who',
      header: 'Visitor',
      render: (v) => v.name ?? v.email ?? `Anonymous ${v.visitorKey.slice(0, 6)}`,
    },
    {
      key: 'currentPage',
      header: 'On page',
      render: (v) => (
        <span className="text-slate-500">{v.currentPage ?? '—'}</span>
      ),
    },
    { key: 'pageViews', header: 'Pages seen' },
    {
      key: 'lastSeenAt',
      header: 'Last seen',
      render: (v) => new Date(v.lastSeenAt).toLocaleTimeString(),
    },
    {
      key: 'conversationId',
      header: 'Chat',
      render: (v) =>
        v.conversationId ? (
          <a
            href="/inbox"
            className="text-brand-600 hover:text-brand-700"
            title="Open in the unified inbox"
          >
            Open thread
          </a>
        ) : (
          <span className="text-slate-400">not started</span>
        ),
    },
  ];

  const r = ratings.data;

  return (
    <div>
      <PageHeader title="Live Chat" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {visitors.isLoading || ratings.isLoading || !r ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        ) : (
          <>
            <Stat
              label="Online now"
              value={visitors.data?.filter((v) => v.online).length ?? 0}
            />
            <Stat label="Visitors tracked" value={visitors.data?.length ?? 0} />
            <Stat label="Chats rated" value={r.total} />
            <Stat label="Avg rating" value={r.total ? `${r.average} / 5` : '—'} />
          </>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">
          Install the widget
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Paste this before <code>&lt;/body&gt;</code> on your website. Chats
          land in the unified inbox and follow your auto-assignment rules.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {snippet}
          </code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(snippet);
              setCopied(true);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-500">Visitors</h2>
      <DataTable
        columns={columns}
        rows={visitors.data ?? []}
        loading={visitors.isLoading}
        emptyText="No visitors yet. Install the widget to start tracking."
      />

      {r && r.comments.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">
            Recent feedback
          </h2>
          <div className="space-y-2">
            {r.comments.map((c, i) => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="mr-2 font-medium text-amber-600">
                  {'★'.repeat(c.rating ?? 0)}
                </span>
                <span className="text-slate-600">{c.comment}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
