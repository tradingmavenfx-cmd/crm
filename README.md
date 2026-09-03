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
Phase 3 — Intelligence & Automation — is complete. **Phase 4 — Advanced Sales
& Marketing** is complete apart from social media: Sales Cloud (4.1), Marketing
Cloud (4.2 — leads, landing pages, forms, attribution and campaign ROI) and
Service Cloud (4.3 — ticketing, knowledge base and customer portal) are built.
Social posting, social inbox and social listening are **not** built: each
network needs its own OAuth app and review, which is an integration project
rather than a feature.

**Phase 5 — Platform** is in progress: document management (5.1), the developer
platform (5.2 — API keys and webhooks) and the security and compliance work
(5.4) are built. Enterprise administration and white labelling (5.3) is not,
and neither are the native integrations, which need a reviewed OAuth app per
vendor.

- [x] Monorepo scaffolding
- [x] NestJS backend foundation (config, Prisma, global guards, Swagger)
- [x] Prisma schema + multi-tenancy (tenant-scoped, enforced by Postgres RLS)
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

## Phase 3 — Intelligence & Automation

- [x] 3.2 Workflow automation engine — triggers, conditions, actions, run
      history, analytics and templates
- [x] 3.3 Analytics & BI — 15 reports across sales/marketing/service/comms,
      dashboards with role-based visibility, CSV export, scheduled report email
- [x] 3.1 AI intelligence — explainable lead scoring, deal win/loss
      prediction, sales coach, sentiment, reply drafting, research and
      data-entry assistants, natural-language queries

### AI intelligence

**The numbers come from your data; the model only writes the explanation.**
Lead scores and win probabilities are computed deterministically from CRM
history — replies received, calls answered, email opens, open deal value,
seniority in the job title, and how long since the contact last responded. Each
score carries the factors that produced it, so a rep can see exactly why a lead
is hot and a manager can defend it. The figures are byte-identical with or
without an AI provider configured; only the prose changes.

That split is also the safety property: a model that returns a different number
cannot overwrite the computed one, and a model that is down or returns garbage
degrades to the built-in summary instead of failing the request.

| Endpoint | What it does |
|---|---|
| `POST /api/ai/score/contact/:id` | Explainable lead score, written back to the contact |
| `GET /api/ai/scoreboard` | Latest score per contact, hottest first |
| `POST /api/ai/predict/deal/:id` | Win probability from stage plus momentum |
| `GET /api/ai/deals/at-risk` | Open deals that are slipping, worst first |
| `GET /api/ai/coach/contact/:id` | Next best action, the channel they actually reply on, the hour they usually reply in |
| `POST /api/ai/sentiment/conversation/:id` | Tone of a thread |
| `POST /api/ai/suggest-reply/conversation/:id` | A **draft** for the agent — nothing is ever sent automatically |
| `POST /api/ai/extract/conversation/:id` | Structured fields from a thread, **not applied** until a person accepts them |
| `GET /api/ai/research/contact/:id` | Everything the CRM knows, summarised before a meeting |
| `POST /api/ai/ask` | A question in plain English, answered by running a report |

Natural-language questions never reach the database as a query: the model only
chooses **which of the 15 reports to run**, and a key it invents is rejected
before anything executes. That keeps a question from becoming SQL, and keeps it
inside the tenant.

Lead scores are refreshed nightly, so the board is current without anyone
opening a page.

**Provider setup.** Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default
`gpt-4o-mini`, or `OPENAI_BASE_URL` for an OpenAI-compatible endpoint). Without
a key the mock provider writes the same explanations from the same computed
numbers, so every flow works in dev.

> A note on credentials: this needs a **platform API key**. The "sign in with
> ChatGPT" OAuth flow authorises the Codex CLI on a developer's own machine; it
> does not authorise a server to call models on a user's behalf, so it cannot
> back a server-side feature like this one.

**Not built:** the RAG knowledge-base chatbot from the plan, which needs a
vector store and a document ingestion pipeline — the live-chat widget hands to a
human today rather than answering from documents.

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

## Phase 4 — Advanced Sales & Marketing (in progress)

- [x] 4.1 CPQ — product catalogue, price books, quotes with discount approval,
      customer-facing acceptance, quote-to-invoice
- [x] 4.1 Forecasting & quotas — commit/best-case/pipeline, weighted pipeline,
      what-if modelling, snapshots and accuracy scoring
- [x] 4.1 Territories — nested, rule-based auto-assignment, rolled-up
      performance
- [x] 4.1 Gamification — leaderboards, contests, badges
- [x] 4.2 Lead management — capture, scoring, routing, conversion to
      contact/account/deal, source and UTM tracking
- [x] 4.2 Landing pages & forms — block-built pages, A/B variants, SEO fields,
      public capture endpoint
- [x] 4.2 Marketing analytics — first/last/linear attribution, campaign ROI,
      funnel, source performance
- [ ] 4.2 Social media — posting, social inbox and listening (needs a
      reviewed OAuth app per network)
- [x] 4.3 Service Cloud ticketing — multi-channel intake, auto-categorisation,
      SLA policies with escalation, routing, merge/link, CSAT
- [x] 4.3 Knowledge base — versioned articles, public help centre, multilingual
      translations, article suggestions on a ticket, search-gap analytics
- [x] 4.3 Customer portal — passwordless sign-in, request tracking with
      replies, quotes and invoices

### CPQ — configure, price, quote

A product carries a list price, a GST rate and an HSN/SAC code. Price books
layer over that: a quote takes its prices from the book it names, falling back
to the default book and then the product's own list price. A product that has
ever been quoted is **deactivated rather than deleted**, because deleting it
would rewrite what a customer was already sent.

**Money is computed in integer paise**, never floats. A quote whose total is a
paisa off its own lines is a quote nobody trusts, and `0.1 + 0.2` is not `0.3`.
Tax is applied per line at that line's own rate, so a quote mixing 5% and 18%
items breaks out correctly for GST — including when a quote-level discount
applies, which is spread across the lines rather than taken out of one bucket.

Discount policy is a rule per role: a rep may go to 10%, a manager to 25%, and
anything beyond that holds the quote at `PENDING_APPROVAL` until the approver
role signs it off. The check looks at **every** discount, header and line, so a
40% cut hidden on one line cannot slip past a 0% header. Nobody can approve
their own quote, and editing an approved quote clears the approval.

Sending a quote publishes it at `/q/:token` — an unguessable token, and the
token is never echoed back in the payload. A quote that has not been sent 404s
there, so a draft is not reachable by guessing. The customer sees the quote and
can accept it: their name, the timestamp and the IP are recorded.

> That acceptance is an **acceptance record, not an integrated e-signature**.
> A quote is not routed through a signature provider, and nothing here claims
> the legal weight of one.

An accepted quote converts to an invoice with a GSTIN field, and the totals are
**copied, not recomputed** — the customer accepted specific figures, and a later
price change must not silently rewrite them. A quote can only be invoiced once.

Numbering is sequential per tenant and year (`Q-2026-0001`, `INV-2026-0001`),
and sent quotes past their validity date expire on an hourly sweep.

### Service Cloud — ticketing

A ticket can be raised directly, or **from any inbox thread** —
`POST /api/tickets/from-conversation/:id` carries over the channel, the linked
contact and the first inbound message as the description. One thread can only
become one ticket.

**Routing rules do three jobs at once**: they set the category, the priority and
the owner. The first matching rule wins, matching on keywords in the subject and
description and optionally on the channel. `load_based` picks the agent with the
fewest open tickets. Anything set explicitly when raising the ticket beats the
rule, and a routing failure can never stop a ticket being raised.

**SLA policies** hold first-response and resolution targets per priority. The
clocks are set when the ticket is created and **reset when the priority
changes** — a ticket escalated to urgent gets the urgent target, not the one it
was created with. A sweep every five minutes flags breaches and escalates the
priority one step, so a missed target reorders the queue rather than sitting
quietly. Reopening a resolved ticket clears its resolution stamps, so the clock
stays honest.

**Replies go out on the channel the ticket came from.** A public comment on a
ticket raised from a WhatsApp thread is delivered over WhatsApp; internal notes
never leave the CRM. If the channel refuses the reply — a voice thread has no
text leg — the comment is still recorded rather than lost. The first public
reply is what stops the first-response clock; an internal note does not.

Duplicates **merge**: comments move to the target and the source closes and
drops out of the queue, but nothing is deleted, so the history stays auditable.
Tickets can also be linked as parent and child for work that splits.

When a ticket is resolved, `/csat/:token` opens a one-question survey. It is
unreachable while the ticket is still open, and accepts exactly one rating.

Ticket data also feeds the reports engine: `service.tickets` and
`service.ticket_agents` join the catalogue, so ticket load and SLA compliance
sit on a dashboard next to pipeline and campaign figures.

## Phase 5 — Platform (in progress)

- [x] 5.1 Document management — folders, tags, versions, templates with merge
      fields, secure share links, acceptance records, view/download analytics,
      contract expiry alerts
- [ ] 5.1 rest — OCR (needs an OCR engine), and integration with a certified
      e-signature provider
- [x] 5.2 Developer platform — scoped API keys with rate limiting, signed
      outbound webhooks with retries and replay, OpenAPI reference
- [ ] 5.2 rest — native integrations, GraphQL, published SDKs, a low-code app
      builder and a paid marketplace
- [ ] 5.3 Enterprise administration & white labelling
- [x] 5.4 Security — multi-device sessions with rotation, sign-in history,
      brute-force lockout, per-tenant IP allowlist, audit trail with field
      changes, retention policies
- [x] 5.4 Compliance — full workspace export, subject access export, right to
      erasure
- [x] 5.4 Tenant isolation — Postgres row-level security on every tenant-scoped
      table, enforced through a non-superuser role
- [ ] 5.4 rest — certifications (SOC 2, ISO 27001, HIPAA), WAF, penetration
      testing, data residency, backups and disaster recovery: operational and
      infrastructure work rather than application code

### Developer platform

**API keys authenticate a program**, sent as `X-API-Key` or as
`Authorization: Bearer crm_…`. A key is returned once and stored only as a
SHA-256 hash with its first characters kept, so it can be recognised in a list
and nowhere else. Unknown, revoked and expired keys all give the same answer.

**Scopes are enforced, not decorative.** The scope a request needs is worked
out from the request itself — the first path segment plus `read` for GET and
`write` for anything else — so every route is covered without each one having
to remember to declare something. `contacts:*` covers every action on
contacts, and writing implies reading, because a key that may change a contact
may obviously see it. It is coarse on purpose: a permission model nobody can
predict is worse than a simple one.

**A key can never be used on `/auth` or `/security`**, whatever scopes it
holds. Signing in, exporting a workspace and erasing a person are things a
person does with a session, not something a credential left in a script should
reach.

Rate limiting is per key and **per process** — two instances behind a load
balancer allow twice the number. Said plainly rather than implied; a shared
counter needs a store this project does not have yet.

**Webhooks reuse the events the workflow engine already emits** rather than
adding a second set of emissions across every module. Every delivery is signed:
`X-CRM-Signature` is an HMAC-SHA256 of `timestamp.body`, and the timestamp is
signed *with* the body so a captured delivery cannot be replayed later — a
receiver should reject anything that is not recent.

A failed delivery is retried five times with widening gaps (30s, 2m, 8m, 32m),
and a destination that fails fifteen times in a row is switched off rather than
retried for ever; turning it back on clears the strikes, so it is judged on
behaviour rather than history. Replaying writes a **new** delivery rather than
rewriting the old one, because what happened the first time is part of the
record. A dispatch failure can never escape into the operation that caused it —
a webhook is a courtesy to somebody else's system.

**Not built, and why:** native integrations (Google, Microsoft, Slack,
QuickBooks, Razorpay, Shopify…) each need their own OAuth app and vendor
review, which is an integration project per vendor rather than a feature.
GraphQL would be a second complete API surface alongside a finished REST one.
SDKs are better generated from the OpenAPI document at `/api/docs` than
hand-written and left to drift. A low-code app builder and server-side custom
functions mean running tenant-supplied code, which needs a real sandbox — an
isolate or a container per execution — and is a project in its own right, not a
feature to bolt on.

### Security

**One device is no longer one account.** A refresh token used to be a single
hashed column on the user, so signing in on a phone silently signed the laptop
out. Each device now has its own session row, listed with the browser, the
platform, the address and when it was last used, and any one of them can be
signed out on its own. A session can only be revoked by the person it belongs
to — the query is scoped by user as well as tenant, so one person cannot sign
another out by guessing an id.

**Refresh tokens rotate.** Refreshing swaps the token the session answers to,
so the old one stops working immediately: a stolen refresh token is good for a
single use at most, and the theft shows up as the real user being signed out.
Tokens are stored as SHA-256 hashes, never in the clear.

Driving this turned up a real defect: two sign-ins in the same second produced
**byte-identical JWTs** — same payload, same `iat` — and the second collided
with the first on the session's unique token hash. Every token now carries its
own `jti`.

**Brute force is counted since the last success**, so signing in correctly
clears the slate rather than leaving yesterday's typos to lock somebody out
today. The lockout is checked before the password, so a locked account cannot
be used to test passwords at all, and the address is lowercased so casing
cannot dodge it.

**The IP allowlist is checked before the password too**, for the same reason.
It takes exact addresses or CIDR blocks; an IPv6 entry is compared exactly
rather than pretended to be understood, because a half-implemented IPv6 mask
would let addresses through that look blocked. A malformed rule matches
nothing rather than everything.

**Every sign-in and every failure is recorded** with the reason — wrong
password, no such account, locked out, blocked network — while the caller is
told only "invalid credentials". The history knows which it was; the person at
the keyboard does not.

**The audit trail records what changed, field by field**, and never records a
secret: password hashes, refresh tokens and share tokens are dropped whatever
the caller passes, because a table built to be read by admins must not become
the place the credentials live. Writing an entry never throws — an audit
failure must not be able to roll back the thing it was recording.

### Compliance

`GET /api/security/export` returns everything the workspace holds as one JSON
document, **without password hashes, refresh tokens, quote and CSAT tokens or
storage keys**: an export is handed to whoever asked for it, and credentials
have no business travelling with it. Taking one is itself audited, with who
took it.

`GET /api/security/export/person` answers a subject access request, and
`POST /api/security/erase` honours a right-to-erasure request. **Erasure
overwrites rather than deletes.** A contact is attached to deals, invoices and
tickets a business is required to keep, and deleting the row would take those
with it — so what identifies the person goes, the commercial record stays, and
their portal sessions are ended. The trail that proves the request was honoured
**does not contain the address**, or it would be the one place it survived.

Retention only deletes where a tenant has actually chosen a period: silently
discarding an audit trail because nobody picked a number would be worse than
keeping it.

**Not built, and why:** SOC 2, ISO 27001 and HIPAA are certifications and
process, not code. A WAF, penetration testing, data residency, automated
backups, point-in-time recovery and disaster recovery are operational and
infrastructure work. Field-level encryption of email and phone is not applied:
those columns are searched case-insensitively throughout the product, and
encrypting them would break lookup — at-rest encryption for them belongs to the
database and its volume.

### Tenant isolation

Isolation is enforced by **Postgres row-level security**, not by remembering to
write `tenantId` in every query. All 73 tenant-scoped tables carry a policy
that admits a row only when it belongs to the tenant the connection has
declared, and the policies are `FORCE`d so the table owner is subject to them
too.

The connection declares its tenant per query. Prisma hands out pooled
connections, so a session-level `SET` would leak to whoever borrowed the
connection next; instead every operation runs as a two-statement transaction
that does `set_config(..., TRUE)` first — transaction-local, and therefore
correct under a pool. It costs a round trip per query and buys a guarantee that
no amount of care in application code can give you.

**The application connects as a role that cannot bypass RLS.** This is the half
that is easy to miss: a superuser — and any role with `BYPASSRLS` — ignores
policies outright, so connecting as `postgres` turns every policy in the schema
into decoration. `npm run db:setup-role` creates `crm_app` as
`NOSUPERUSER NOBYPASSRLS`; `DATABASE_URL` points at it and `DIRECT_DATABASE_URL`
stays on the owner for migrations. The service **checks this at startup** and
logs an error if the connection can bypass RLS, because that is exactly the
kind of misconfiguration that is invisible until it matters.

Cross-tenant work is explicit and greppable: `TenantContext.asSystem(reason,
…)`, used for signing in (the workspace is not known yet), token-addressed
public pages, scheduled sweeps and the seed. A signed-in HTTP request is pinned
to the tenant in its token by an interceptor; a `@Public()` route runs in system
mode and does its own scoping, which makes those routes the ones to read
carefully.

`npm run db:verify-rls` proves it, by running queries that deliberately omit
`tenantId`:

```
As Acme, running queries that FORGOT their tenantId:
  contacts visible                                     3
  any of them belong to the other workspace?           no
  the other workspace's contact, fetched by email      not found
  workspaces visible                                   1
  deals counted as Acme                                6
  deals that exist in total                            7
  count is scoped?                                     yes

Writing into another workspace, as Acme:
  insert into the other workspace     refused by the row-level security policy
  update of the other workspace's row                  no rows
  delete of the other workspace's row                  no rows
```

Two things nearly made this silently useless, and both are worth knowing about:
the superuser connection above, and an **async-context bug** — a Prisma call
returns a lazy promise that does no work until awaited, so handing one back out
of the scope left it to run under whatever scope was in force at the `await`.
A nested `asSystem` kept the outer tenant's scope, and an interceptor that
returned `next.handle()` from inside the context scoped nothing at all, because
an Observable does nothing until something subscribes. Both are pinned by
tests.

### Documents

Bytes go through a **storage driver** — put, get, delete and nothing else — so
an object store can replace the local disk without the rest of the module
noticing. The local driver **generates every key itself** and never takes one
from the caller: a filename that walked out of the storage root
(`../../../etc/passwd`) would otherwise be able to read or overwrite anything
the process can reach. Keys are tenant-prefixed and random, so a stored name
gives nothing away, and every read is checked to be inside the directory the
driver owns even if a database row were tampered with.

**Every version is its own stored object.** Uploading a new one leaves the old
bytes where they are, because an earlier version has to stay downloadable — and
because a share may be pinned to it. Deleting a document removes *every*
version's bytes, not just the newest; leaving the rest behind would keep the
file readable to anyone who could reach the disk.

**A share link is pinned to the version that existed when it was made**, so a
later edit cannot change what a customer was sent. Links are addressed by an
unguessable token, are revocable and can expire; revoked, expired and
never-existed all look identical from outside. The token is shown once, to
whoever made the link.

A share can ask for a name before it hands the file over. That is an
**acceptance record** — a name, an optional email, the time and the IP — and
deliberately **not** a certified electronic signature: it says somebody holding
the link put their name to this version, it does not certify who they were.

Documents generated from a template leave a merge field with nothing behind it
**visible** as `[contact.jobTitle]`, and name the unfilled fields back to
whoever generated it. A contract that silently reads "Agreement with  " is
worse than one that shows the hole.

Contracts carry an expiry date, and a daily sweep flags each one **once** so an
expiry is noticed rather than repeated every morning.

**Not built:** OCR, which needs an OCR engine, and integration with a certified
e-signature provider.

### Leads, capture and attribution

A lead is scored the same way everything else in this codebase is scored: a
handful of **stated reasons that add up**, so a rep can be told why a lead is
worth calling. A work address beats a free one, seniority in a job title
counts, and somebody who came to a page of ours beats somebody who arrived in
an import.

**Somebody who comes back is one lead, not two.** A second submission from the
same address updates what is known and adds a touchpoint. Crucially the **first
touch is kept**: what brought them the first time is the thing that worked, and
overwriting it with the second visit's UTM would erase that.

Converting creates a contact, an account (reusing one of the same name) and
optionally a deal. **The lead row is kept, not deleted** — it is the record of
where the customer came from — and its touchpoints are re-pointed at the new
contact so the trail follows the person rather than stopping at the moment they
became one.

**Attribution is worked out from touchpoints**, not from a single `source`
field that only ever holds whichever touch was written last. A campaign send,
an email open, a click, a page view and a form submission all record one.
Three models are offered because they disagree, and the disagreement is the
useful part: first-touch flatters whatever fills the funnel, last-touch
flatters whatever closes, linear refuses to choose. **Only won deals count**,
and **revenue no marketing touch can explain is reported as uncredited** rather
than dropped — saying so is the difference between attribution and wishful
thinking. Campaign ROI is computed from that same split, so the two reports can
never tell different stories.

### Landing pages

A page is a list of blocks — the same data a drag-and-drop editor would
produce, edited as a list. Publishing needs at least one block, and a draft is
unreachable publicly.

A page can carry an **A/B variant**: the API picks between them by weight *per
view* and returns the id of the variant it actually served, so the form posts
back against the one the visitor saw. That keeps each side's views and
submissions honest, which is the only way a conversion rate means anything.
Both sides share one form — they test the wording, not the questions.

`POST /api/p/:tenantId/capture` takes a lead straight from an external site for
people who would rather host their own page. Neither it nor the form endpoint
hands back a CRM id: an open endpoint has no business distributing references
to records.

### Forecasting, quotas and territories

A deal lands in a forecast category — commit, best case, pipeline — either
because a rep put it there or, when nobody has said, from **its stage's own
probability**, which is the number the pipeline was already built on rather
than a second opinion invented for the forecast.

**A deal counts towards the period it is expected to close in**, and an open
deal with no expected date is reported separately rather than being quietly
forecast into the current one. **Gap is measured against what is committed**
(closed + commit), not against hope.

A rep who carries a quota but has nothing in the period still appears, at zero:
that is exactly the rep a manager is looking for. Rep quotas and a territory
quota are never added together — they cover the same deals, so summing both
would count the target twice.

**What-if changes nothing.** It re-reads the same deals under different odds
(90/50/20 by default) and answers "what would it take", which is a question
about the numbers, not a change to them.

Accuracy is scored against the **earliest** snapshot in a period — a forecast
made on the last day of the quarter is not a forecast, and grading against it
would flatter everyone. A weekly cron takes the snapshots so there is something
to score.

**Territories nest, and every clause in a rule must match**: "manufacturing in
Karnataka" does not swallow every company in Karnataka. When several territories
fit, the most specific one — the one with the most clauses — wins. Only accounts
that belong nowhere are filed automatically, so an account moved by hand stays
put; accounts no rule claimed are counted and reported rather than hidden.
Performance rolls up through the tree, because a region reporting only its own
directly-held accounts tells a manager nothing.

### Leaderboards, contests and badges

**Points are never banked.** They are worked out from the deals, activities and
tickets every time the board is asked for, so a deal that later falls through
takes its points with it — ₹1,000 won is 1 point, a won deal 50, a meeting 5, a
resolved ticket 3, a call 2. Everyone stays on the board including those at
zero: a board that hides the bottom half is a highlight reel, not a standing.

A contest is scored on one metric over exactly its own window. A badge is the
exception to nothing-is-banked: it is a record that somebody reached a mark, so
it is written down once, with the figure that earned it, and survives a later
bad quarter.

### Knowledge base and help centre

An article is written by an agent at `/kb` and read by a customer at
`/help/:tenantId`. The two are deliberately not the same text: **the help centre
serves the last published version, not the working row.** An agent part-way
through a rewrite never takes the live answer offline, and the editor shows a
banner saying what customers still see. Publishing snapshots the current text as
the next version, so the history is a real trail — v1 is never overwritten — and
any version can be restored. Restoring the live version is how an unfinished
draft gets thrown away.

**Visibility is separate from status.** An `INTERNAL` article is published and
searchable by agents but never reachable from the help centre, so a runbook can
say "confirm with finance first" without a customer reading it. Article
suggestions on a ticket show internal articles too, marked, and offer a
copyable link only for the public ones.

**Search is transparent, not magic.** A term in the title scores 10, in the tags
6, in the excerpt 3 and in the body 1, with a small bonus for a well-rated
article, and stop words are dropped so a natural question ("how long does my
refund take?") still matches. There is no embedding model and no external call —
the ranking can be explained to whoever asks why their article is third.

**Every search is logged, including the ones that found nothing.** Those misses
are the point: `/kb/search-analytics` ranks the questions the knowledge base
could not answer, which is the list of articles worth writing next.

Articles can be translated: a translation carries its own slug and locale and
links back to its source, so `/help/:tenantId?locale=hi` is a Hindi help centre
over the same knowledge base.

### Customer portal

`/portal/:tenantId` is where a customer tracks their own requests, replies to
them, and sees the quotes and invoices raised against them.

**There are no customer passwords.** Signing in emails a one-time link; opening
it exchanges the link for a session and spends the link in the same breath. The
CRM therefore stores no customer credentials to leak, and both the link and the
session are held as SHA-256 hashes — a dump of those tables cannot be replayed
as a login.

**Asking for a link says the same thing whatever the answer.** A known address,
an unknown one and a workspace that does not exist all get the identical reply,
so the portal cannot be used to enumerate a company's customers. Every rejection
of a link reads the same too: expired, already spent, wrong workspace and never
existed are indistinguishable from outside.

**The session decides whose data this is** — never an id in the path. Every
query is scoped by tenant *and* contact, so another customer's ticket 404s
exactly like one that never existed. Internal notes are filtered out in the
query itself, not in the view.

A portal reply is deliberately **not** routed through the agent comment path:
that stamps the first-response clock, and a customer answering themselves must
never mark the team's SLA as met. Replying to a resolved request reopens it.
Raising a request goes through the same routing rules and SLA policies as one
an agent raises, but priority and assignee are not accepted from the customer.

Because a portal request has no channel thread to answer on, an agent's public
reply emails the customer a notice with a link back to the portal — the reply
itself stays behind the session rather than sitting in an inbox.

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
scheduled emails), `/dashboards` (widget composition), `/ai` (lead scores,
at-risk deals, coaching and plain-English questions), `/quotes` and `/products`
(catalogue and price books), and `/tickets` (queue, SLA, routing rules).
`/q/[token]` and `/csat/[token]` are the customer-facing quote and survey pages
and need no login.

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
