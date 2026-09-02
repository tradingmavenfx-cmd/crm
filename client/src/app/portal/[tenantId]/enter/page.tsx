'use client';

import { Suspense, use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { PORTAL_API, portalSession } from '@/lib/portal';

export default function EnterPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  return (
    <Suspense fallback={<Waiting />}>
      <Enter tenantId={tenantId} />
    </Suspense>
  );
}

function Waiting() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-sm text-slate-500">Signing you in…</p>
    </main>
  );
}

/**
 * Where the emailed link lands. It swaps the one-time token for a session and
 * gets out of the way; the token is spent the moment it is used.
 */
function Enter({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [failed, setFailed] = useState(false);
  // React runs effects twice in development; the token would be spent by the
  // first run and the second would report it as invalid.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      setFailed(true);
      return;
    }

    axios
      .post(`${PORTAL_API}/portal/${tenantId}/session`, { token })
      .then(({ data }) => {
        portalSession.set(tenantId, data.sessionToken);
        // Replace, so the token does not sit in history or in a back button.
        router.replace(`/portal/${tenantId}`);
      })
      .catch(() => setFailed(true));
  }, [tenantId, token, router]);

  if (!failed) return <Waiting />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">
          That link no longer works
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign-in links can be used once, and expire after 15 minutes. Ask for a
          fresh one and it will be in your inbox in a moment.
        </p>
        <Link
          href={`/portal/${tenantId}`}
          className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Send me a new link
        </Link>
      </div>
    </main>
  );
}
