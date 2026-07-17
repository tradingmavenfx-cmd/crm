export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-pulse rounded bg-slate-200 ${className}`}
      aria-hidden="true"
    />
  );
}
