import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export function Button({ loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className="w-full rounded-lg bg-brand-600 text-white font-medium py-2.5 hover:bg-brand-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
      {...props}
    >
      {loading ? 'Please wait…' : children}
    </button>
  );
}
