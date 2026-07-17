'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CannedResponse, Conversation, Message, TenantUser } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

function convLabel(c: Conversation) {
  return c.contact
    ? `${c.contact.firstName} ${c.contact.lastName}`
    : c.externalId;
}

export default function InboxPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [composer, setComposer] = useState('');

  // Poll conversations so new inbound chats appear without a manual refresh.
  const conversations = useQuery({
    queryKey: ['whatsapp', 'conversations'],
    queryFn: async () =>
      (await api.get<Conversation[]>('/whatsapp/conversations')).data,
    refetchInterval: 10_000,
  });

  const selected =
    conversations.data?.find((c) => c.id === selectedId) ?? null;

  const messages = useQuery({
    queryKey: ['whatsapp', 'messages', selectedId],
    queryFn: async () =>
      (await api.get<Message[]>(`/whatsapp/conversations/${selectedId}/messages`))
        .data,
    enabled: Boolean(selectedId),
    refetchInterval: 5_000,
  });

  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<TenantUser[]>('/users')).data,
  });

  const canned = useQuery({
    queryKey: ['whatsapp', 'canned'],
    queryFn: async () =>
      (await api.get<CannedResponse[]>('/whatsapp/canned-responses')).data,
  });

  const send = useMutation({
    mutationFn: async (payload: { to: string; text: string }) =>
      (await api.post('/whatsapp/send', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
    },
  });

  const updateConv = useMutation({
    mutationFn: async (payload: {
      id: string;
      body: { assignedToId?: string; status?: string };
    }) =>
      (await api.patch(`/whatsapp/conversations/${payload.id}`, payload.body))
        .data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] }),
  });

  const addNote = useMutation({
    mutationFn: async (payload: { id: string; body: string }) =>
      (
        await api.post(`/whatsapp/conversations/${payload.id}/notes`, {
          body: payload.body,
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp', 'messages'] }),
  });

  const onSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const text = composer.trim();
    if (!text) return;
    setComposer('');
    await send.mutateAsync({ to: selected.externalId, text });
  };

  const onNewChat = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const created = await send.mutateAsync({
      to: String(form.get('to')),
      text: String(form.get('text')),
    });
    setNewOpen(false);
    // Jump into the conversation the message was sent to.
    if (created?.conversationId) setSelectedId(created.conversationId);
  };

  return (
    <div>
      <PageHeader
        title="WhatsApp Inbox"
        action={
          <button
            onClick={() => setNewOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New chat
          </button>
        }
      />

      <div className="flex h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {/* Conversation list */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200">
          {conversations.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (conversations.data?.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-400">No conversations yet.</p>
          ) : (
            conversations.data!.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedId === c.id ? 'bg-brand-50' : ''
                }`}
              >
                <p className="text-sm font-medium">{convLabel(c)}</p>
                <p className="truncate text-xs text-slate-400">
                  {c.externalId} · {c.status}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Message thread */}
        <div className="flex flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-slate-400">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{convLabel(selected)}</p>
                  <p className="text-xs text-slate-400">{selected.externalId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selected.assignedToId ?? ''}
                    onChange={(e) =>
                      updateConv.mutate({
                        id: selected.id,
                        body: { assignedToId: e.target.value },
                      })
                    }
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    title="Assign agent"
                  >
                    <option value="">Unassigned</option>
                    {users.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selected.status}
                    onChange={(e) =>
                      updateConv.mutate({
                        id: selected.id,
                        body: { status: e.target.value },
                      })
                    }
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    title="Conversation status"
                  >
                    <option value="open">open</option>
                    <option value="pending">pending</option>
                    <option value="closed">closed</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
                {messages.isLoading ? (
                  <Skeleton className="h-16 w-1/2" />
                ) : (
                  messages.data?.map((m) =>
                    m.isInternal ? (
                      <div
                        key={m.id}
                        className="mx-auto max-w-[80%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                      >
                        <p className="text-[10px] font-semibold uppercase text-amber-500">
                          Internal note
                        </p>
                        <p>{m.body}</p>
                      </div>
                    ) : (
                      <div
                        key={m.id}
                        className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                          m.direction === 'OUTBOUND'
                            ? 'ml-auto bg-brand-600 text-white'
                            : 'bg-white border border-slate-200'
                        }`}
                      >
                        <p>{m.body}</p>
                        <p
                          className={`mt-1 text-[10px] ${
                            m.direction === 'OUTBOUND'
                              ? 'text-white/70'
                              : 'text-slate-400'
                          }`}
                        >
                          {new Date(m.createdAt).toLocaleTimeString()} ·{' '}
                          {m.status.toLowerCase()}
                        </p>
                      </div>
                    ),
                  )
                )}
              </div>

              <div className="border-t border-slate-200 p-3">
                {(canned.data?.length ?? 0) > 0 && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs text-slate-400">Quick reply:</span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const r = canned.data?.find((c) => c.id === e.target.value);
                        if (r) setComposer(r.body);
                        e.currentTarget.value = '';
                      }}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    >
                      <option value="">Insert canned response…</option>
                      {canned.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <form onSubmit={onSend} className="flex gap-2">
                  <input
                    name="text"
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    autoComplete="off"
                    placeholder="Type a message…"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!composer.trim()) return;
                      await addNote.mutateAsync({ id: selected.id, body: composer });
                      setComposer('');
                    }}
                    disabled={addNote.isPending}
                    className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    title="Add internal note (not sent to customer)"
                  >
                    Note
                  </button>
                  <button
                    type="submit"
                    disabled={send.isPending}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Send
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={newOpen} title="New WhatsApp chat" onClose={() => setNewOpen(false)}>
        <form onSubmit={onNewChat} className="space-y-4">
          <Field
            label="Phone (E.164)"
            name="to"
            placeholder="+919812345678"
            required
          />
          <Field label="Message" name="text" required />
          <Button type="submit" loading={send.isPending}>
            Send message
          </Button>
        </form>
      </Modal>
    </div>
  );
}
