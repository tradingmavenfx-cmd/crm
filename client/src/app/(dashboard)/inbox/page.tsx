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

const CHANNEL_FILTERS = [
  { value: '', label: 'All' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'VOICE', label: 'Calls' },
];

const channelBadge: Record<string, string> = {
  WHATSAPP: 'bg-green-100 text-green-700',
  EMAIL: 'bg-blue-100 text-blue-700',
  SMS: 'bg-purple-100 text-purple-700',
  VOICE: 'bg-orange-100 text-orange-700',
};

const channelLabel: Record<string, string> = {
  WHATSAPP: 'WA',
  EMAIL: 'Email',
  SMS: 'SMS',
  VOICE: 'Call',
};

/** Call logs and voicemails carry their detail on the message metadata. */
interface CallMeta {
  durationSec?: number;
  recordingUrl?: string | null;
  ivrPath?: string[];
  status?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function convLabel(c: Conversation) {
  return c.contact ? `${c.contact.firstName} ${c.contact.lastName}` : c.externalId;
}

function ChannelTag({ channel }: { channel: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        channelBadge[channel] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {channelLabel[channel] ?? channel}
    </span>
  );
}

/** A call log or voicemail rendered as a timeline entry, not a chat bubble. */
function CallEntry({ message }: { message: Message }) {
  const meta = (message.metadata ?? {}) as CallMeta;
  const isVoicemail = message.type === 'voicemail';

  return (
    <div className="mx-auto max-w-[80%] rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
      <p className="text-[10px] font-semibold uppercase text-orange-500">
        {isVoicemail ? 'Voicemail' : 'Call log'}
      </p>
      <p>{message.body}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-orange-500">
        <span>{new Date(message.createdAt).toLocaleString()}</span>
        {typeof meta.durationSec === 'number' && meta.durationSec > 0 && (
          <span>· {formatDuration(meta.durationSec)}</span>
        )}
        {meta.ivrPath && meta.ivrPath.length > 0 && (
          <span>· keys {meta.ivrPath.join(' → ')}</span>
        )}
        {meta.recordingUrl && (
          <a
            href={meta.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-orange-700"
          >
            recording
          </a>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newChannel, setNewChannel] = useState('WHATSAPP');
  const [composer, setComposer] = useState('');

  const conversations = useQuery({
    queryKey: ['inbox', 'conversations', channel],
    queryFn: async () =>
      (
        await api.get<Conversation[]>('/inbox/conversations', {
          params: channel ? { channel } : {},
        })
      ).data,
    refetchInterval: 10_000,
  });

  const selected = conversations.data?.find((c) => c.id === selectedId) ?? null;

  const messages = useQuery({
    queryKey: ['inbox', 'messages', selectedId],
    queryFn: async () =>
      (await api.get<Message[]>(`/inbox/conversations/${selectedId}/messages`))
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

  const reply = useMutation({
    mutationFn: async (payload: { id: string; text: string }) =>
      (await api.post(`/inbox/conversations/${payload.id}/reply`, { text: payload.text }))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });

  const updateConv = useMutation({
    mutationFn: async (payload: {
      id: string;
      body: { assignedToId?: string; status?: string };
    }) => (await api.patch(`/inbox/conversations/${payload.id}`, payload.body)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['inbox', 'conversations'] }),
  });

  const addNote = useMutation({
    mutationFn: async (payload: { id: string; body: string }) =>
      (await api.post(`/inbox/conversations/${payload.id}/notes`, { body: payload.body }))
        .data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', 'messages'] }),
  });

  const startChat = useMutation({
    mutationFn: async (payload: {
      channel: string;
      to: string;
      text: string;
      subject?: string;
    }) => {
      if (payload.channel === 'EMAIL') {
        return (
          await api.post('/email/send', {
            to: payload.to,
            subject: payload.subject || 'Hello',
            text: payload.text,
          })
        ).data;
      }
      if (payload.channel === 'SMS') {
        return (await api.post('/sms/send', { to: payload.to, text: payload.text }))
          .data;
      }
      return (await api.post('/whatsapp/send', { to: payload.to, text: payload.text }))
        .data;
    },
    onSuccess: (created: { conversationId?: string }) => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setNewOpen(false);
      if (created?.conversationId) setSelectedId(created.conversationId);
    },
  });

  const callBack = useMutation({
    mutationFn: async (to: string) =>
      (await api.post('/voice/calls', { to })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox'] }),
  });

  const onSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const text = composer.trim();
    if (!text) return;
    setComposer('');
    await reply.mutateAsync({ id: selected.id, text });
  };

  const onNewChat = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await startChat.mutateAsync({
      channel: newChannel,
      to: String(form.get('to')),
      text: String(form.get('text')),
      subject: (form.get('subject') as string) || undefined,
    });
  };

  return (
    <div>
      <PageHeader
        title="Unified Inbox"
        action={
          <button
            onClick={() => setNewOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New chat
          </button>
        }
      />

      <div className="mb-4 flex gap-2">
        {CHANNEL_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setChannel(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              channel === f.value
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex h-[68vh] overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {/* Conversation list */}
        <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200">
          {conversations.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (conversations.data?.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-400">No conversations.</p>
          ) : (
            conversations.data!.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedId === c.id ? 'bg-brand-50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="truncate text-sm font-medium">{convLabel(c)}</p>
                  <ChannelTag channel={c.channel} />
                </div>
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{convLabel(selected)}</p>
                    <ChannelTag channel={selected.channel} />
                  </div>
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
                    m.type === 'call' || m.type === 'voicemail' ? (
                      <CallEntry key={m.id} message={m} />
                    ) : m.isInternal ? (
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
                            : 'border border-slate-200 bg-white'
                        }`}
                      >
                        {m.subject && (
                          <p className="mb-1 text-xs font-semibold opacity-80">
                            {m.subject}
                          </p>
                        )}
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

              {selected.channel === 'VOICE' ? (
                <div className="flex items-center justify-between border-t border-slate-200 p-3">
                  <p className="text-xs text-slate-400">
                    Call threads have no text reply - call back, or switch to the
                    SMS thread for this number.
                  </p>
                  <button
                    onClick={() => callBack.mutate(selected.externalId)}
                    disabled={callBack.isPending}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Call back
                  </button>
                </div>
              ) : (
              <div className="border-t border-slate-200 p-3">
                {(selected.channel === 'WHATSAPP' || selected.channel === 'SMS') &&
                  (canned.data?.length ?? 0) > 0 && (
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
                    placeholder={
                      selected.channel === 'EMAIL'
                        ? 'Type an email reply…'
                        : selected.channel === 'SMS'
                          ? 'Type an SMS reply…'
                          : 'Type a message…'
                    }
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
                    disabled={reply.isPending}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Send
                  </button>
                </form>
              </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={newOpen} title="New conversation" onClose={() => setNewOpen(false)}>
        <form onSubmit={onNewChat} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Channel
            </span>
            <select
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </select>
          </label>
          <Field
            label={newChannel === 'EMAIL' ? 'Email address' : 'Phone (E.164)'}
            name="to"
            placeholder={
              newChannel === 'EMAIL' ? 'lead@example.com' : '+919812345678'
            }
            required
          />
          {newChannel === 'EMAIL' && (
            <Field label="Subject" name="subject" placeholder="Hello" />
          )}
          <Field label="Message" name="text" required />
          <Button type="submit" loading={startChat.isPending}>
            Send message
          </Button>
        </form>
      </Modal>
    </div>
  );
}
