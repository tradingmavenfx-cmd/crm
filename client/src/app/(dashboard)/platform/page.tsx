'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  customDomain: string | null;
  createdAt: string;
  usage: {
    users: number;
    activeUsers30d: number;
    lastLoginAt: string | null;
    contacts: number;
    companies: number;
    deals: number;
    dealsOpen: number;
    dealsWon90d: number;
    revenueWon90d: number;
    tickets: number;
    documents: number;
    storageBytes: number;
    apiCalls: number;
    messages30d: number;
    failingWebhooks: number;
  };
  signals: { level: 'warning' | 'info'; message: string }[];
}

const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${Math.round(n / 1024)} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

export default function PlatformPage() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);

  const tenants = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: async () =>
      (await api.get<PlatformTenant[]>('/platform/tenants')).data,
    retry: false,
  });

  const setActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.post(`/platform/tenants/${id}/active`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });

  if (tenants.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Platform" />
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          This is the view for whoever runs the platform, across every
          workspace. Your account is a {role?.toLowerCase().replace('_', ' ')},
          so there is nothing here for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Platform" />
      <p className="text-sm text-slate-600">
        Every workspace on this installation, and what it is doing. Suspending
        one stops anybody signing in; nothing is deleted.
      </p>

      {tenants.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-3">
          {tenants.data?.map((t) => (
            <div
              key={t.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {t.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      /{t.slug}
                    </span>
                    {!t.isActive && (
                      <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        suspended
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t.plan} · since{' '}
                    {new Date(t.createdAt).toLocaleDateString()}
                    {t.customDomain ? ` · ${t.customDomain}` : ''}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setActive.mutate({ id: t.id, isActive: !t.isActive })
                  }
                  className={`text-sm hover:underline ${
                    t.isActive ? 'text-red-600' : 'text-brand-700'
                  }`}
                >
                  {t.isActive ? 'Suspend' : 'Restore'}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
                {[
                  ['People', `${t.usage.activeUsers30d}/${t.usage.users}`],
                  ['Contacts', t.usage.contacts],
                  ['Open deals', t.usage.dealsOpen],
                  ['Won (90d)', `₹${t.usage.revenueWon90d.toLocaleString('en-IN')}`],
                  ['Messages (30d)', t.usage.messages30d],
                  ['Storage', bytes(t.usage.storageBytes)],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>

              {t.signals.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {t.signals.map((s, i) => (
                    <li
                      key={i}
                      className={`text-xs ${
                        s.level === 'warning'
                          ? 'text-amber-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {s.level === 'warning' ? '⚠ ' : '· '}
                      {s.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
