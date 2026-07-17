'use client';

import { useEffect, useState } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Debounced search input — keeps typing smooth and avoids a request per keystroke. */
export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, onChange]);

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder ?? 'Search…'}
      className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
    />
  );
}
