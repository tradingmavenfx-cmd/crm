'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export interface Branding {
  tenantSlug: string;
  productName: string;
  logoUrl: string | null;
  primaryColor: string;
  shades: Record<'50' | '500' | '600' | '700', string>;
  loginHeadline: string | null;
  loginSubtext: string | null;
  showPoweredBy: boolean;
  locale: string;
}

/**
 * How a page decides whose branding to wear.
 *
 * A custom domain answers for exactly one workspace, so it is the strongest
 * signal; otherwise the workspace slug the browser already remembers, which is
 * what the sign-in form needs anyway.
 */
function brandingQuery(slug?: string | null) {
  if (typeof window === 'undefined') return null;

  const host = window.location.hostname;
  const isOurOwn =
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isOurOwn) return { domain: host };

  return slug ? { slug } : null;
}

/** Fetches the branding for the workspace this page belongs to. */
export function useBranding(slug?: string | null) {
  const params = brandingQuery(slug);

  return useQuery({
    queryKey: ['branding', params],
    queryFn: async () =>
      (await axios.get<Branding>(`${API_BASE}/branding`, { params })).data,
    enabled: Boolean(params),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Paints the workspace's colour onto the page.
 *
 * Written straight onto the document rather than passed down through props:
 * the colour is used by Tailwind classes in every component, and threading it
 * through all of them would be a worse version of a stylesheet.
 */
export function BrandingProvider({ slug }: { slug?: string | null }) {
  const branding = useBranding(slug);
  const shades = branding.data?.shades;

  useEffect(() => {
    if (!shades) return;
    const root = document.documentElement;
    for (const [shade, value] of Object.entries(shades)) {
      root.style.setProperty(`--brand-${shade}`, value);
    }
  }, [shades]);

  useEffect(() => {
    if (branding.data?.productName) {
      document.title = branding.data.productName;
    }
  }, [branding.data?.productName]);

  return null;
}
