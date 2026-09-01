'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrate = useAuthStore((s) => s.hydrate);

  // Redirect happens as a side effect; we NEVER block the shell behind a
  // spinner wall. The layout renders instantly so navigation feels < 1s.
  useEffect(() => {
    if (!tokenStore.getAccess()) {
      router.replace('/login');
      return;
    }
    // Restores the workspace slug after a reload, so the topbar can keep
    // showing it.
    hydrate();
  }, [router, hydrate]);

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 min-h-screen flex flex-col">
        <Topbar />
        <main className="p-6 flex-1">{children}</main>
      </div>
    </div>
  );
}
