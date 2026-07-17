import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <span className="text-sm font-medium text-brand-600 mb-3">
        Enterprise CRM Pro
      </span>
      <h1 className="text-4xl sm:text-5xl font-bold max-w-2xl leading-tight">
        The CRM built to beat Salesforce, HubSpot &amp; Zoho
      </h1>
      <p className="mt-4 text-slate-600 max-w-xl">
        Native WhatsApp, IVR, AI agents, and Indian-market features — all in one
        platform.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/register"
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="px-5 py-2.5 rounded-lg border border-slate-300 font-medium hover:bg-slate-100 transition"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
