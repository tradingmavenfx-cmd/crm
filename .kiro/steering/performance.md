# Performance & UX Rules (MUST follow)

## Navigation speed
- Page-to-page navigation MUST feel instant (target < 1 second). NEVER let a
  full-page loading spinner rotate for 10-30 seconds while a page loads.
- Route transitions must never block on network calls. Render the page shell
  and layout immediately; load data in the background.

## How to achieve this (frontend)
- Use Next.js App Router client-side navigation (`<Link>`), which keeps the
  shell mounted and swaps only the page content.
- NEVER gate a whole route/layout behind a blocking spinner tied to an API
  call. Auth guards must check the token synchronously (no async spinner wall).
- Show lightweight inline **skeletons** for data areas, not a centered
  full-screen spinner. The rest of the page stays interactive.
- Cache aggressively with TanStack Query (`staleTime`), and prefetch likely
  next routes/data so revisits are instant.
- Keep First Load JS small; lazy-load heavy widgets (charts, editors) with
  `next/dynamic` so they never block navigation.
- Paginate/limit list queries; never fetch huge payloads on initial render.

## Backend contribution to speed
- Keep API responses fast (plan target: < 200ms p95). Add DB indexes for every
  filtered/sorted column. Avoid N+1 queries.

## Rule of thumb
If a change could make navigation feel slow or show a long spinner, redesign it
so the shell renders instantly and data streams in behind skeletons.
