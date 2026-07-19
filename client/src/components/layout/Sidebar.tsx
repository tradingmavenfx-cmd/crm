'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/inbox', label: 'WhatsApp Inbox' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/companies', label: 'Companies' },
  { href: '/deals', label: 'Deals' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/email-templates', label: 'Email Templates' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white h-screen sticky top-0 p-4">
      <div className="px-2 mb-6">
        <span className="text-lg font-bold text-brand-700">CRM Pro</span>
      </div>
      <nav className="space-y-1">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
