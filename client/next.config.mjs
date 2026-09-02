import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  },
};

/**
 * `next dev` and `next build` write to different directories.
 *
 * They share `.next` by default, so running a production build while a dev
 * server is up overwrites the chunks that server is still serving - the page
 * keeps rendering but loses its stylesheet, which looks like the CSS broke
 * rather than like a build collision. Separate directories make that
 * impossible.
 */
export default function config(phase) {
  return {
    ...baseConfig,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  };
}
