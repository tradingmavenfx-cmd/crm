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

Phases 1 and 2 are complete, apart from the Phase 2 features that depend on an
LLM or on WebRTC — those moved to Phase 3 alongside the rest of the AI work.
**Phase 3 — Intelligence & Automation** is in progress: the workflow engine
(3.2) and analytics/BI (3.3) are built; the AI engine (3.1) is not, because it
needs an LLM provider.

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
- [x] WhatsApp interactive messages (quick-reply buttons, list messages) and
      media messages (image/video/document/audio); button taps land as inbound
- [x] Campaigns — one engine for WhatsApp broadcasts, bulk email and SMS
      campaigns: audience segments, merge-field personalisation, scheduling,
      per-recipient results, opt-out-aware
- [x] Email open/click tracking (pixel + link rewriting) with an analytics view
- [x] Email sequences — multi-step drip with per-step delays, auto-stop on reply
- [x] Live chat — embeddable website widget, visitor/page tracking, chat ratings,
      threads land in the unified inbox
- [x] Unified inbox: @mentions on internal notes, auto-assignment rules
      (keyword and round-robin routing across every channel)

Six channels — WhatsApp, email, SMS, voice/IVR, live chat and call logs — send,
receive, thread and land in one inbox, with campaigns, sequences and routing on
top. What remains needs an LLM or WebRTC: see
[What's left in Phase 2](#whats-left-in-phase-2).

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

### Campaigns, sequences & tracking

One campaign engine covers WhatsApp broadcasts, bulk email and SMS campaigns.
An audience is a segment (explicit contacts, or a filter on score/company/owner),
bodies support `{{firstName}}`/`{{fullName}}` merge fields, and `GET
/api/campaigns/:id/preview` shows who would be reached before anything is sent.
Each recipient is independent — an opt-out is recorded as *skipped*, a provider
error as *failed*, and the rest of the batch continues. Scheduled campaigns are
picked up by a cron each minute.

Outbound email is instrumented automatically: links are rewritten to trackable
short links and an open pixel is appended (`EMAIL_TRACKING=false` turns this
off). `GET /api/tracking/stats` reports open/click rates and the most-clicked
links, and opens/clicks roll up to their campaign.

Sequences are multi-step email drips. Each step waits its own `delayHours`, the
runner sends what is due every minute, and a reply from the contact stops the
chain when `stopOnReply` is set.

### Live chat

`GET /api/chat/:tenantId/widget.js` serves a self-contained widget — one script
tag on any site. It keeps a visitor key in `localStorage` so a refresh resumes
the same conversation, polls for agent replies, and reports the page the visitor
is on. Chats appear in the unified inbox like any other channel; internal notes
are never exposed to the visitor. Visitors can rate the chat afterwards, and
`GET /api/chat/visitors` gives agents the live list with an online/offline flag.

### Routing & collaboration

Auto-assignment rules route new conversations on any channel: rules run in
priority order, match on keywords in the first inbound message (or act as a
catch-all), and assign either to a specific agent or round-robin to whoever has
the fewest open conversations. Already-assigned conversations are never
reassigned, and a routing failure can never block an inbound message.

`@name` inside an internal note creates a mention for that teammate — matched on
first name, last name or email local-part — surfaced through
`GET /api/inbox/mentions`. Authors are never notified about their own notes.

### SMS

Two-way SMS threads land in the same inbox. Templates support `{{merge}}` fields,
bulk sends skip opted-out numbers instead of failing the batch, and an inbound
`STOP` adds the number to the DND list automatically (`START` removes it).
`POST /api/sms/otp/send` and `/verify` cover OTP verification — only a bcrypt hash
of the code is stored, codes expire in 5 minutes, and there is a 5-attempt limit.

### What's left in Phase 2

Everything remaining needs either an LLM or WebRTC/media infrastructure, so it
is deferred to Phase 3 where the AI work lives:

| Plan section | Deferred | Needs |
|---|---|---|
| 2.1 WhatsApp | Chatbot / lead-qualification bot, product catalog & commerce | LLM; Meta commerce APIs |
| 2.2 IVR & telephony | AI voice agent, post-call summaries, sentiment & keyword spotting, speech-to-text, predictive dialer, browser softphone | LLM / speech APIs; WebRTC |
| 2.3 Email | IMAP/Gmail/Outlook two-way sync, drag-and-drop template builder, AI email writer | OAuth apps per provider; LLM |
| 2.4 Live chat | Chatbot with human handoff, proactive triggers, file sharing | LLM; file storage |
| 2.5 Video calling | The whole section | WebRTC + a media server |
| 2.6 Unified inbox | Social DMs (Instagram/Facebook/X), AI reply suggestions | Platform apps; LLM |

Call recording is stored as a provider URL only — the CRM does not host audio.
The `transcript` field on a call exists but nothing populates it automatically.

The workflow engine that now sits on top of these channels is described under
[Phase 3](#phase-3--intelligence--automation-in-progress).

## Phase 3 — Intelligence & Automation (in progress)

- [x] 3.2 Workflow automation engine — triggers, conditions, actions, run
      history, analytics and templates
- [x] 3.3 Analytics & BI — 15 reports across sales/marketing/service/comms,
      dashboards with role-based visibility, CSV export, scheduled report email
- [ ] 3.1 AI/agentic intelligence (lead scoring, win/loss prediction, sales
      coach, agents, sentiment, RAG chatbot, natural-language queries) — needs
      an LLM provider

### Workflow automation engine

Workflows are *when → only if → then*. They generalise the automations that were
previously hardcoded: the missed-call follow-up and the inbox assignment rules
are each one workflow's worth of behaviour.

**Triggers** — a record is created or updated (`contact`, `deal`), a specific
field changes, a deal moves stage, a message arrives on any channel, a call
ends, a schedule fires (`{ dailyAt: "09:00" }` or `{ everyMinutes: 30 }`), or an
inbound webhook is posted to
`POST /api/workflows/webhook/:tenantId/:key`.

**Conditions** — a nestable tree evaluated against the triggering record:

```json
{ "all": [ { "field": "score", "op": "gte", "value": 80 },
           { "any": [ { "field": "company.industry", "op": "eq", "value": "Retail" },
                      { "field": "email", "op": "is_not_empty" } ] } ] }
```

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`,
`is_empty`, `is_not_empty`, `in`. Ordering operators compare numerically, and
paths may be nested (`company.industry`). An empty tree always matches.

**Actions** — send an email/SMS/WhatsApp template, create a task or activity,
assign an owner (a named agent or round-robin to whoever has the fewest open
tasks), update a field, enrol the contact into a sequence, or call an outbound
webhook. String values take `{{field}}` merge values from the record.

Every run is recorded: `SUCCESS`, `FAILED` (with the failing step, which stops
the chain) or `SKIPPED` when the conditions did not match. `GET
/api/workflows/analytics` reports volume, success rate and duration per
workflow, and `POST /api/workflows/:id/test` dry-runs a record through the
conditions and shows the rendered actions without touching anything.

Six templates ship as starting points — lead assignment, hot-lead alert, deal
stage automation, customer onboarding, support escalation, renewal reminder.
Installing one creates it **paused** so it can be reviewed before it fires. (The
plan's "50+ templates" is a content exercise; these six cover the patterns it
names.)

Channels emit domain events through an event emitter rather than calling the
engine, so no channel module depends on it and a workflow failure can never
break an inbound message.

### Analytics & BI

Fifteen reports, all computed live from the CRM's own data — no warehouse, no
sync job:

| Family | Reports |
|---|---|
| Sales | pipeline by stage, weighted revenue forecast, rep leaderboard, win/loss, sales cycle length |
| Marketing | campaign performance, channel attribution, email performance |
| Service | first response time & SLA, agent performance, chat satisfaction, task load |
| Communication | call analytics, omnichannel engagement, message volume by channel |

Every report returns the same shape — columns, rows and headline stats — which
is what lets any of them be drawn as a bar, line, donut, funnel, table or stat
tile. `GET /api/reports` lists the catalogue; `GET /api/reports/:key` runs one
(`?days=` narrows the window); `GET /api/reports/:key/export.csv` downloads it.

Dashboards compose those reports into widgets, each with its own chart type,
width and parameters. `GET /api/dashboards/:id/render` returns the dashboard
with every widget's report already computed — and a widget that fails renders
its error rather than blanking the page. Dashboards can be restricted to
particular roles; a role that cannot see one gets the same 404 as a dashboard
that does not exist, so visibility cannot be probed.

`POST /api/report-schedules` emails a report daily, weekly or monthly to a list
of addresses, as an HTML table that any mail client can render.

**First-response time is measured from the customer's first message**, not from
the conversation row, and only for threads the customer started. A thread we
opened has nothing to respond to, and backfilled data can carry a response
timestamp that precedes its own row — both would otherwise show up as a
meaningless zero or a negative in the average.

**Not built:** the drag-and-drop dashboard designer (widgets reorder with
up/down controls), the plan's "20+ chart types" (six cover every report shape
here), PDF/Excel export (CSV only), and SQL-based custom reports — exposing raw
SQL to a tenant is a cross-tenant data-leak risk that a report builder should
solve with whitelisted dimensions instead.

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
`/dashboard`, `/inbox` (unified, all channels, plus @mentions and auto-assign
rules), `/contacts`, `/companies`, `/deals`, `/tasks`, `/calls` (call log,
analytics, click-to-call), `/campaigns` (campaigns + email analytics),
`/sequences` (drip builder and enrolments), `/live-chat` (visitors, ratings,
widget snippet), `/ivr-flows` (IVR menu builder), `/email-templates`,
`/sms-templates` (templates plus the DND list), `/workflows` (builder, run
history and automation analytics), `/reports` (catalogue, charts, CSV export,
scheduled emails) and `/dashboards` (widget composition).

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
