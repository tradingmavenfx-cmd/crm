'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';

interface Paginated {
  meta: { total: number };
}

function useCount(resource: string) {
  return useQuery({
    queryKey: [resource, 'count'],
    queryFn: async () => {
      const { data } = await api.get<Paginated>(`/${resource}`, {
        params: { page: 1, limit: 1 },
      });
      return data.meta.total;
    },
  });
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value?: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-2 h-9 flex items-center">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="text-3xl font-bold">{value ?? 0}</span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const contacts = useCount('contacts');
  const companies = useCount('companies');
  const tasks = useCount('tasks');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Contacts"
          value={contacts.data}
          loading={contacts.isLoading}
        />
        <StatCard
          label="Companies"
          value={companies.data}
          loading={companies.isLoading}
        />
        <StatCard label="Tasks" value={tasks.data} loading={tasks.isLoading} />
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Phase 1 foundation is live. Contacts, companies, deals, activities, and
        tasks modules are wired to the API.
      </p>
    </div>
  );
}
