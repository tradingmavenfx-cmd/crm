'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { useBranding } from '@/components/Branding';

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboards', label: 'Dashboards' },
  { href: '/reports', label: 'Reports' },
  { href: '/ai', label: 'AI' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/leads', label: 'Leads' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/companies', label: 'Companies' },
  { href: '/deals', label: 'Deals' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/territories', label: 'Territories' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/quotes', label: 'Quotes' },
  { href: '/documents', label: 'Documents' },
  { href: '/products', label: 'Products' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/kb', label: 'Knowledge Base' },
  { href: '/calls', label: 'Calls' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/marketing', label: 'Marketing' },
  { href: '/sequences', label: 'Sequences' },
  { href: '/live-chat', label: 'Live Chat' },
  { href: '/ivr-flows', label: 'IVR Flows' },
  { href: '/email-templates', label: 'Email Templates' },
  { href: '/sms-templates', label: 'SMS Templates' },
  { href: '/security', label: 'Security' },
  { href: '/developer', label: 'Developer' },
  { href: '/settings', label: 'Settings' },
  { href: '/platform', label: 'Platform' },
];

export function Sidebar() {
  const pathname = usePathname();
  const tenantSlug = useAuthStore((s) => s.tenantSlug);
  const branding = useBranding(tenantSlug);

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white h-screen sticky top-0 p-4">
      <div className="px-2 mb-6">
        {branding.data?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.data.logoUrl}
            alt={branding.data.productName}
            className="max-h-8"
          />
        ) : (
          <span className="text-lg font-bold text-brand-700">
            {branding.data?.productName ?? 'CRM Pro'}
          </span>
        )}
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
