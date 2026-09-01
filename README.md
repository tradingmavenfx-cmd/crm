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

Phases 1 and 2 are complete; **Phase 3 — Intelligence & Automation** is next.

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
- [x] Tests: unit (77) + e2e (3) passing, build green
- [x] Run migration + seed against a live PostgreSQL (via Docker)
- [x] Full stack runs in Docker (postgres + redis + server + client) — verified end-to-end
- [x] Phase 1.1: Next.js 15 frontend (auth pages, dashboard shell, API client)
- [x] Frontend CRUD screens: Contacts, Companies, Deals (pipeline board), Tasks
- [x] Polish: debounced search, pagination, edit-in-place, contact↔company linking, inline task status

## Phase 2 — Communication Hub

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
- [x] Unified inbox — all channels in one view, channel filter, cross-channel reply routing, assignment/status/notes
- [x] SMS channel: two-way conversations, templates + merge fields, bulk/campaign
      send, TRAI DND opt-out (STOP/START), OTP send & verify
- [x] IVR & cloud telephony: multi-level IVR menus, DTMF routing, dynamic IVR
      reading live CRM data, VIP priority routing, voicemail, click-to-call,
      call log + analytics, missed-call automation
- [x] Calls and voicemails threaded into the unified inbox
- [x] IVR builder UI, call log + analytics UI, SMS templates + DND list UI

**Phase 2 is feature-complete** apart from the pieces that depend on Phase 3's AI
layer and on WebRTC — see "Not built yet" below.

### Channels work without credentials

Every channel ships with a **mock provider** (the message or call is logged, and
the rest of the flow runs normally), so the whole hub is usable in dev with no
accounts. Set the real credentials in `server/.env` to switch each one over:

| Channel | Real provider | Enable by setting |
|---|---|---|
| WhatsApp | Meta Cloud API | `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` |
| Email | SMTP (nodemailer) | `SMTP_HOST` |
| SMS | Twilio Programmable Messaging | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `SMS_FROM_NUMBER` |
| Voice / IVR | Twilio Programmable Voice | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `VOICE_FROM_NUMBER` |

With the mock voice provider, IVR steps come back as plain JSON so the whole call
flow can be driven from `curl`; the Twilio provider renders the same steps as
TwiML. See `server/.env.example` for every variable.

### IVR & telephony

The active IVR flow answers all inbound calls. A menu key can transfer to an
agent, drop into a submenu (that's how multi-level menus are built), take a
voicemail, read out a fixed message, hang up, or **read live CRM data back to the
caller** — "press 3 for your order status" looks up the caller's most recent deal
and speaks its stage and value. A contact scoring at or above `VOICE_VIP_SCORE`
skips the menu entirely and rings their account manager.

A missed inbound call automatically creates the caller as a lead if they are
unknown, files a high-priority callback task on an agent, logs an activity, and
texts the caller back.

Telephony webhooks (public, tenant in the path):

```
POST /api/voice/webhook/:tenantId/incoming    # answer -> greeting + menu
POST /api/voice/webhook/:tenantId/dtmf        # keypress -> next step
POST /api/voice/webhook/:tenantId/status      # end of call -> log + automation
POST /api/voice/webhook/:tenantId/recording   # voicemail recording
```

They accept Twilio's form fields (`CallSid`, `From`, `Digits`, `CallStatus`, …)
or the equivalent JSON, so the flow can be exercised locally:

```bash
curl -X POST http://localhost:4000/api/voice/webhook/$TENANT_ID/incoming \
  -H 'Content-Type: application/json' \
  -d '{"From":"+919876543210","CallSid":"CA-demo-1"}'
```

Against a real Twilio number, point the voice webhook at
`$VOICE_PUBLIC_URL/voice/webhook/<tenantId>/incoming` — in dev that needs a
tunnel, since Twilio must reach the callback URL.

### SMS

Two-way SMS threads land in the same inbox. Templates support `{{merge}}` fields,
bulk sends skip opted-out numbers instead of failing the batch, and an inbound
`STOP` adds the number to the DND list automatically (`START` removes it).
`POST /api/sms/otp/send` and `/verify` cover OTP verification — only a bcrypt hash
of the code is stored, codes expire in 5 minutes, and there is a 5-attempt limit.

### Not built yet (deferred to Phase 3+)

The Phase 2 plan also lists work that depends on the Phase 3 AI layer or on
WebRTC, none of which is implemented: AI voice agent and post-call summaries,
call sentiment/keyword analysis, speech-to-text transcription (the field is
stored but never populated automatically), predictive/auto dialer, browser
softphone, live chat widget, video calling, and social DMs. Call recording is
stored as a provider URL only — the CRM does not host audio.

### Verify locally

```bash
cd server
npm install
npx prisma generate
npm run build        # tsc/nest build
npm test             # unit tests (mocked Prisma)
npm run test:e2e     # boots full app, no DB needed
npm run lint         # eslint + prettier (--fix)
```

From the repo root, `npm run lint` covers both workspaces. Server lint is
typescript-eslint + prettier (`server/.eslintrc.js`); the client uses
`next/core-web-vitals` (`client/.eslintrc.json`). Prettier settings are shared
from `.prettierrc` at the root.

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

Routes: `/` landing, `/login`, `/register`, and the auth-guarded shell with
`/dashboard`, `/inbox` (unified, all channels), `/contacts`, `/companies`,
`/deals`, `/tasks`, `/calls` (call log, analytics, click-to-call),
`/ivr-flows` (IVR menu builder), `/email-templates`, `/sms-templates` (templates
plus the DND list).

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
