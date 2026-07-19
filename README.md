# 🚀 Enterprise CRM Pro

Enterprise-grade CRM built to surpass Salesforce, HubSpot, and Zoho — with native WhatsApp, IVR, AI agents, and Indian-market features (GST, UPI, Aadhaar).

See [`implementation_plan.md`](./implementation_plan.md) for the full 6-phase roadmap.

## Monorepo Structure

```
.
├── server/     # NestJS backend (API, business logic, Prisma/PostgreSQL)
├── client/     # Next.js 15 frontend (App Router, Tailwind, TanStack Query)
└── implementation_plan.md
```

## Build Status

Currently building **Phase 1 — Foundation & Core**.

- [x] Monorepo scaffolding
- [x] NestJS backend foundation (config, Prisma, global guards, Swagger)
- [x] Prisma schema + multi-tenancy (tenant-scoped, RLS-ready)
- [x] Authentication & RBAC (JWT access/refresh, 6 roles, token rotation)
- [x] Core CRM: Contacts (tenant-scoped CRUD + search + pagination)
- [x] Core CRM: Companies (tenant-scoped CRUD + search + pagination)
- [x] Core CRM: Deals + pipeline stages (stage validation, win/loss close)
- [x] Activities (timeline entries: call/email/meeting/note/whatsapp)
- [x] Tasks (assignee, due date, priority, status filters)
- [x] Seed script (demo tenant "acme" + users + pipeline + sample data)
- [x] docker-compose for local PostgreSQL 17 + Redis 7
- [x] Tests: unit (16) + e2e (3) passing, build green
- [x] Run migration + seed against a live PostgreSQL (via Docker)
- [x] Full stack runs in Docker (postgres + redis + server + client) — verified end-to-end
- [x] Phase 1.1: Next.js 15 frontend (auth pages, dashboard shell, API client)
- [x] Frontend CRUD screens: Contacts, Companies, Deals (pipeline board), Tasks
- [x] Polish: debounced search, pagination, edit-in-place, contact↔company linking, inline task status

## Phase 2 — Communication Hub (in progress)

- [x] WhatsApp Business API backend (provider abstraction: Meta Cloud API + dev mock)
- [x] Conversations + Messages models (omnichannel-ready — WhatsApp/email/SMS/chat)
- [x] Send text & template messages; auto-create + contact-linked conversations
- [x] Inbound webhook (messages) + delivery-status callbacks + Meta verification handshake
- [x] Tests: 5 WhatsApp unit tests; verified end-to-end in Docker (send + inbound + status)
- [x] Team inbox UI (conversation list + live thread + send box + new-chat)
- [x] Team inbox features: agent assignment/transfer, status, internal notes, canned responses, SLA first-response tracking
- [x] Users list endpoint (for assignment); idempotent seed (no data loss on restart)
- [x] Email channel: send (SMTP + dev mock), inbound webhook, templates CRUD, contact linking
- [x] Email templates management UI
- [ ] Unified inbox (merge WhatsApp + Email), IVR / telephony, SMS

WhatsApp works out-of-the-box with a **mock provider** (messages logged) when no
credentials are set. To use the real Meta Cloud API, set `WHATSAPP_ACCESS_TOKEN`
and `WHATSAPP_PHONE_NUMBER_ID` in `server/.env`.

### Verify locally

```bash
cd server
npm install
npx prisma generate
npm run build        # tsc/nest build
npm test             # unit tests (mocked Prisma)
npm run test:e2e     # boots full app, no DB needed
```

### Run against a real database

```bash
# from repo root — start Postgres + Redis
docker compose up -d

cd server
cp .env.example .env          # DATABASE_URL points at the compose Postgres
npx prisma migrate dev --name init
npm run prisma:seed           # demo tenant "acme", password Password123!
npm run start:dev             # http://localhost:4000/api  (docs at /api/docs)
```

### Frontend (Next.js 15)

```bash
cd client
npm install
cp .env.example .env          # NEXT_PUBLIC_API_URL -> backend
npm run build                 # production build + typecheck + lint
npm run dev                   # http://localhost:3000
```

Routes: `/` landing, `/login`, `/register`, `/dashboard` (auth-guarded shell
with sidebar, topbar, and live contact/company/task counts from the API).

## Run the whole stack with Docker (recommended)

One command brings up PostgreSQL, Redis, the API, and the web client:

```bash
docker compose up -d --build
```

- Web client: http://localhost:3000
- API: http://localhost:4000/api  (Swagger docs at /api/docs)
- The server container auto-applies Prisma migrations on start, and seeds demo
  data on first run (`SEED=true` in `docker-compose.yml`).

```bash
docker compose logs -f server   # follow API logs
docker compose down             # stop everything
docker compose down -v          # stop and wipe the database volume
```

## Getting Started (without Docker)

```bash
# Install all workspace dependencies
npm install

# Run the backend in dev mode
npm run dev:server

# Run backend tests
npm run test:server
```
