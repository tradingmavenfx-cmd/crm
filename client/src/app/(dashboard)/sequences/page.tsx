'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Contact,
  Paginated,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
} from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

const blankStep = (): SequenceStep => ({
  delayHours: 24,
  subject: '',
  body: '',
});

const enrollmentStyle: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  STOPPED: 'bg-amber-100 text-amber-700',
};

export default function SequencesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<SequenceStep[]>([blankStep()]);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<Sequence | null>(null);
  const [viewing, setViewing] = useState<Sequence | null>(null);

  const sequences = useQuery({
    queryKey: ['sequences'],
    queryFn: async () => (await api.get<Sequence[]>('/sequences')).data,
    refetchInterval: 20_000,
  });

  const contacts = useQuery({
    queryKey: ['contacts', 'for-enroll'],
    queryFn: async () =>
      (await api.get<Paginated<Contact>>('/contacts', { params: { limit: 100 } }))
        .data.data,
    enabled: Boolean(enrolling),
  });

  const enrollments = useQuery({
    queryKey: ['sequences', 'enrollments', viewing?.id],
    queryFn: async () =>
      (
        await api.get<SequenceEnrollment[]>(
          `/sequences/${viewing!.id}/enrollments`,
        )
      ).data,
    enabled: Boolean(viewing),
  });

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.post('/sequences', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      setOpen(false);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Save failed'));
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (s: Sequence) =>
      (await api.patch(`/sequences/${s.id}`, { isActive: !s.isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sequences/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  const enroll = useMutation({
    mutationFn: async (payload: { id: string; contactIds: string[] }) =>
      (
        await api.post(`/sequences/${payload.id}/enroll`, {
          contactIds: payload.contactIds,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sequences'] });
      setEnrolling(null);
    },
  });

  const stop = useMutation({
    mutationFn: async (enrollmentId: string) =>
      (await api.post(`/sequences/enrollments/${enrollmentId}/stop`)).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['sequences', 'enrollments'] }),
  });

  const setStep = (index: number, patch: Partial<SequenceStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save
      .mutateAsync({
        name: String(form.get('name')),
        description: String(form.get('description') || '') || undefined,
        stopOnReply: form.get('stopOnReply') === 'on',
        steps: steps
          .filter((s) => s.subject && s.body)
          .map((s) => ({ ...s, delayHours: Number(s.delayHours) })),
      })
      .catch(() => undefined);
  };

  const onEnroll = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ids = form.getAll('contactIds').map(String);
    if (!ids.length || !enrolling) return;
    enroll.mutate({ id: enrolling.id, contactIds: ids });
  };

  return (
    <div>
      <PageHeader
        title="Email Sequences"
        action={
          <button
            onClick={() => {
              setSteps([blankStep()]);
              setError(null);
              setOpen(true);
            }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New sequence
          </button>
        }
      />

      <p className="mb-4 text-sm text-slate-500">
        Each step waits its delay, then emails the contact. A reply stops the
        chain automatically when &ldquo;stop on reply&rdquo; is on.
      </p>

      {sequences.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : (sequences.data?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-400">
          No sequences yet.
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.data!.map((seq) => (
            <div
              key={seq.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{seq.name}</h2>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        seq.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {seq.isActive ? 'ACTIVE' : 'PAUSED'}
                    </span>
                    {seq.stopOnReply && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        stops on reply
                      </span>
                    )}
                  </div>
                  {seq.description && (
                    <p className="mt-1 text-sm text-slate-500">
                      {seq.description}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {seq._count?.enrollments ?? 0} enrolled
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEnrolling(seq)}
                    className="text-sm text-brand-600 hover:text-brand-700"
                  >
                    Enroll
                  </button>
                  <button
                    onClick={() => setViewing(seq)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Enrollments
                  </button>
                  <button
                    onClick={() => toggleActive.mutate(seq)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    {seq.isActive ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => remove.mutate(seq.id)}
                    className="text-sm text-slate-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <ol className="mt-3 space-y-1">
                {seq.steps.map((step, i) => (
                  <li key={step.id ?? i} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-400">
                      +{step.delayHours}h
                    </span>
                    <span>{step.subject}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* Create */}
      <Modal open={open} title="New sequence" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" name="name" required />
          <Field label="Description" name="description" />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Steps
            </span>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={step.delayHours}
                      onChange={(e) =>
                        setStep(i, { delayHours: Number(e.target.value) })
                      }
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                    />
                    <span className="text-xs text-slate-400">
                      hours after {i === 0 ? 'enrolling' : 'the previous step'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSteps((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="ml-auto px-1 text-slate-400 hover:text-red-600"
                      aria-label="Remove step"
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    value={step.subject}
                    onChange={(e) => setStep(i, { subject: e.target.value })}
                    placeholder="Subject — supports {{firstName}}"
                    className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                  />
                  <textarea
                    value={step.body}
                    onChange={(e) => setStep(i, { body: e.target.value })}
                    rows={3}
                    placeholder="Body"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSteps((prev) => [...prev, blankStep()])}
              className="mt-2 text-sm text-brand-600 hover:text-brand-700"
            >
              + Add step
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="stopOnReply" defaultChecked />
            Stop the chain when the contact replies
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={save.isPending}>
            Create sequence
          </Button>
        </form>
      </Modal>

      {/* Enroll */}
      <Modal
        open={Boolean(enrolling)}
        title={enrolling ? `Enroll into ${enrolling.name}` : ''}
        onClose={() => setEnrolling(null)}
      >
        <form onSubmit={onEnroll} className="space-y-4">
          <p className="text-sm text-slate-500">
            Contacts without an email are skipped, and nobody is enrolled twice.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {contacts.data?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="contactIds" value={c.id} />
                <span>
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-xs text-slate-400">
                  {c.email ?? 'no email'}
                </span>
              </label>
            ))}
          </div>
          <Button type="submit" loading={enroll.isPending}>
            Enroll selected
          </Button>
        </form>
      </Modal>

      {/* Enrollments */}
      <Modal
        open={Boolean(viewing)}
        title={viewing ? `${viewing.name} — enrollments` : ''}
        onClose={() => setViewing(null)}
      >
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {enrollments.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (enrollments.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">Nobody enrolled yet.</p>
          ) : (
            enrollments.data!.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {e.contact.firstName} {e.contact.lastName}
                  </p>
                  <p className="text-xs text-slate-400">
                    step {e.currentStep + 1} · next{' '}
                    {new Date(e.nextRunAt).toLocaleString()}
                    {e.stopReason && ` · ${e.stopReason}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      enrollmentStyle[e.status]
                    }`}
                  >
                    {e.status}
                  </span>
                  {e.status === 'ACTIVE' && (
                    <button
                      onClick={() => stop.mutate(e.id)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
