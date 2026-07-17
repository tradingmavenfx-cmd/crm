'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';

export function Topbar() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const onLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <div className="text-sm text-slate-500">
        {user ? `${user.firstName} ${user.lastName} · ${user.role}` : 'Session'}
      </div>
      <button
        onClick={onLogout}
        className="text-sm font-medium text-slate-600 hover:text-red-600"
      >
        Log out
      </button>
    </header>
  );
}
