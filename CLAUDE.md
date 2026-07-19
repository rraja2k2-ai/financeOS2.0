# FinanceOS – Project Constitution

This document is the single source of truth for the FinanceOS architecture.

It contains stable project decisions only. It is not a changelog, not
implementation history, and not user documentation. Future Claude Code
sessions read this file automatically — keep it accurate and keep it short.

**If this document and the implementation diverge, treat the implementation
as authoritative until the discrepancy is verified and this document is
updated.** Stop and ask before changing the architecture either way. Do not
silently change the implementation to match this document, and do not
silently edit this document to match the implementation — verify which one
is actually correct first.

---

## 1. Project Overview

FinanceOS is a **personal, single-user finance application** for one
household to capture receipts, track transactions, manage budgets by
project, and monitor accounts and investments.

- There is exactly one user. There are no tenants, no organizations, no
  shared workspaces.
- There is no SaaS product ambition. Do not design for multi-tenancy,
  billing, onboarding flows, or public sign-up.
- Simplicity beats enterprise robustness. When a decision must choose
  between "correct for a multi-user SaaS" and "correct for one household's
  books," choose the latter.
- The product's core loop is: capture a receipt (photo or text) → AI
  extracts structured data → user reviews → transaction is saved → it shows
  up in Activity.

---

## 2. Technology Stack

**Frontend**
- Next.js (App Router, Turbopack), React, TypeScript.
- Tailwind CSS for styling. No component library beyond small in-house
  primitives (`components/`).

**Backend**
- Next.js Server Components and Route Handlers (`app/api/**`). No separate
  backend service.
- Business logic lives in `services/`, never in components or routes.

**Database**
- Supabase Postgres (`public` schema). Accessed exclusively through the
  **anon key** — there is no Supabase Auth sign-in flow and no service-role
  key anywhere in the app. Every request, client or server, hits Postgres as
  the `anon` Postgres role.
- Because there is no per-user login, Row Level Security is a technical
  gate for PostgREST, **not a per-user data boundary**. Do not design
  features assuming RLS separates one user's data from another's — there is
  only one user.

**Storage**
- Supabase Storage, private `receipts` bucket. Original receipt files only.

**AI Provider**
- Provider-agnostic interface (`services/ai/ai-provider.ts`). Concrete
  providers live in `services/ai/providers/` and are selected by one factory
  (`services/ai/providers/index.ts`). Nothing outside that folder may know
  which provider is active.

**Current OCR / extraction provider**
- Google Gemini (`@google/genai`), via `GeminiCaptureProvider`. One
  multimodal request performs OCR, extraction, and categorization together.
  There is no separate OCR step and no Google Cloud Vision usage — a prior
  two-step Vision + Gemini pipeline existed and was fully removed.

---

## 3. Architecture Principles

- **Repository pattern.** `repositories/` is the only layer allowed to call
  Supabase (`.from(...)`, `.storage`, `.rpc(...)`). One file per table/
  concern, exporting plain async functions (`list`, `getById`, `insert`,
  `update`, `remove`, plus narrow named queries).
- **Service layer.** `services/` owns business logic, validation, and
  orchestration across repositories. Services call repositories; components
  and routes call services.
- **UI never talks to repositories directly.** Components and pages call
  services (directly in Server Components, or via `app/api/**` route
  handlers / server actions from client components).
- **AI provider abstraction.** All AI access goes through
  `services/ai/providers` behind the `CaptureAiProvider` interface. Prompt
  construction is isolated in `prompts/` and is provider-agnostic (plain
  text in, plain text out — no provider SDK types in prompt files).
- **Single responsibility per file.** A repository file owns one table. A
  service file owns one workflow or one domain concern. Prefer several small
  files over one large multi-purpose file.
- **No hardcoding.** Account names, category names, project names, and
  provider names are data (master data loaded from the database) or config
  (env vars), never string literals baked into business logic.
- **Prefer extension over modification.** When adding a capability, prefer
  a new file/function alongside the existing pattern over rewriting an
  established path. Established, working architecture (Capture, Save,
  Review, Activity) is not refactored casually — see §10.
- **Do not create parallel flows.** If a workflow already exists, extend or
  reuse it — never build a second implementation of the same business
  process. There is **one** Review Screen, **one** Save flow, **one** AI
  pipeline, **one** Capture Inbox. A new requirement that looks like it
  needs "a second version" of one of these is a sign to extend the existing
  one, not to branch a parallel path next to it.
- **Performance philosophy: load once, reuse many times.** Avoid repeated
  database queries, repeated AI calls, and repeated storage operations for
  the same unit of work — do the work once and pass the result through the
  rest of the pipeline (see master data loading in §5/§6 as the canonical
  example).
- **Before changing architecture:** (1) verify the existing implementation,
  (2) reuse the existing design, (3) extend only when necessary, (4) do not
  redesign working architecture, (5) ask before making an architectural
  decision rather than assuming one.

---

## 4. Database Principles

- **The schema is considered stable.** Do not create new tables or columns
  unless a new business capability genuinely requires them. Prefer reusing
  existing tables/architecture before proposing a schema change.

- Receipt **images/PDFs are stored only in Supabase Storage** (`receipts`
  bucket), never in the database and never as Base64 in any column. The
  database stores a `storage_path` reference plus metadata (mime type, file
  size, page number) — nothing else.
- Storage paths are UUID-folder based
  (`YYYY/MM/<uuid>/page-N.<ext>`), independent of any transaction or receipt
  ID, so a failed save never collides with a retry.
- Row Level Security is **enabled on every table** in `public`. See §9 for
  the policy shape.
- `capture_queue` intentionally uses **one custom `ALL` policy** instead of
  four granular per-verb policies — it is a transient work queue with a
  single uniform access pattern (the app always needs full CRUD on it, no
  verb is restricted differently than another). Do not fragment it into
  per-verb policies without a concrete reason.
- `account_mapping_rules` is a **separate table from `categorization_rules`**
  and must stay separate. `categorization_rules` maps merchant text →
  category (and carries a category-specific account hint).
  `account_mapping_rules` maps a payment keyword or a card's last 4 digits →
  an account, independent of merchant. Do not merge these tables or reuse
  one for the other's purpose — they match different text against different
  targets.
- `app_settings` was **removed permanently**. Base Currency and any global
  app setting live in `exchange_rates` (or a purpose-built table if a future
  setting doesn't fit there). Do not recreate a generic `app_settings`
  table — if a new global setting is needed, add a column to the table it
  actually belongs to, or propose a specifically-named table for it.

---

## 5. Capture Architecture

The capture pipeline, in order:

1. **Capture Launcher** — entry point UI that starts a capture (photo,
   file, or text-only).
2. **Capture Modal** — collects the receipt page(s) and free-text user
   context, shows real upload/processing progress (no simulated timers),
   and stays open with a retry path on failure so an uploaded receipt is
   never lost.
3. **Capture Inbox** (`capture_queue`) — an async work queue. A capture
   enqueues immediately and processes in the background; the user is never
   blocked waiting on the AI call. Queue states: Uploading → Processing →
   Ready for Review → Failed → (Saved = row deleted once the reviewed
   transaction is persisted).
4. **AI processing** — exactly **one** Gemini multimodal request per
   capture, combining OCR, extraction, and categorization. Never split into
   multiple OCR passes or multiple AI calls for the same capture.
5. **Review Screen** — the user verifies/edits the AI's structured result
   before it becomes a real transaction.
6. **Save** — persists the reviewed data as a transaction header + line
   items, atomically where the database supports it.
7. **Activity** — the saved transaction's permanent home; see §7.

Master data (accounts, categories, projects, categorization rules, account
mapping rules, base currency) is loaded **once per capture session** and
reused for the whole session — no repeated queries mid-session.

---

## 6. AI Principles

- **Provider abstraction is absolute.** `prompts/` only builds prompt text;
  it never calls an AI SDK. `services/ai/providers/*` only call the AI
  provider; they never construct prompt text themselves. `services/capture/
  capture.service.ts` orchestrates provider selection + prompt + call and
  normalizes the response — it contains no provider-specific logic.
- **Single AI request per capture.** One multimodal call handles OCR,
  extraction, and categorization together. Do not introduce a second pass
  (e.g., a separate categorization call) for the same capture.
- **Master data loaded once**, passed into the prompt builder as a single
  snapshot: accounts, categories/subcategories, projects, categorization
  rules, account mapping rules, base currency.
- **The AI determines** category, subcategory, project, and source account
  — always by choosing from the supplied master data, never by inventing a
  value that isn't in it.
- **Account Mapping Rules are hints, not a deterministic override.** They
  are passed to the AI alongside Accounts/Categories/Projects; the AI still
  performs the final reasoning. The priority the AI is instructed to apply,
  highest first: (1) an account named explicitly in user context (natural
  language, never a "Payment Method: X" format), (2) an Account Mapping
  Rules keyword match (one flat rule tier — a rule's keyword just needs to
  appear anywhere in the extracted text, e.g. "2148" matches "****2148",
  "Card 2148", "Ending 2148"), (3) the AI's own reasoning from the receipt
  contents plus the accounts list, (4) if still not confident, return null
  rather than guess. This priority lives in the prompt instructions, not in
  a separate deterministic code path — there is no rule engine, no merchant
  rules, no priority/chaining logic beyond this one account-identification
  hint.
- **Master data loading degrades gracefully.** If `account_mapping_rules`
  (or any similarly optional master-data source) doesn't exist or can't be
  read, the loader returns an empty list and Capture continues normally —
  it never fails a capture just because an optional enhancement table is
  missing.
- **Never hardcode account names, category names, or project names**
  anywhere in application code, prompts, or fallback logic. They come from
  the database via master data, full stop.

---

## 7. UI Principles

- **Minimize clicks for a personal, daily-use workflow.** This is a tool
  one person uses repeatedly, not a form for occasional enterprise users —
  optimize for speed of repeated use over guided hand-holding.
- **Review is a safety net, not a mandatory gate.** The long-term direction
  is for high-confidence captures to be saved with minimal friction, and for
  Review to be where the user intervenes only when something needs a look —
  not an unavoidable step every single time.
- **One Review Screen, reused.** The same Review Screen component handles
  both a fresh capture and editing an existing transaction. There is no
  second editor anywhere in the app. Any "edit a transaction" feature must
  route through this one component, reshaping existing data to look like a
  fresh AI result rather than building a parallel form.
- **Activity is the source of truth** for what has been saved. Once a
  transaction is saved, Activity is where it lives, is displayed, is edited,
  and is deleted from — not a second parallel transaction list.
- Header-level actions on a transaction (edit, delete) are icon-only,
  positioned in the transaction header, with hover tooltips on desktop —
  they do not carry text labels.

---

## 8. Coding Standards

- **Strong typing.** No `any` in new code. Domain types live in `domain/`;
  service/repository inputs and outputs are fully typed.
- **No duplicated logic.** Shared logic (account/project resolution,
  rounding, dominant-category calculation, etc.) lives in one function that
  every caller imports — never copy-pasted between the create and edit
  paths, or between similar services.
- **No hardcoded values** — see §6 and §4. This extends to category names,
  currency codes beyond the documented constant, and any other value that
  belongs in the database or a named constant instead of an inline literal.
- **Small, focused files.** A repository, a service, or a component should
  do one job. Split before a file becomes a dumping ground for unrelated
  concerns.
- **Prefer extension over modification.** Add new capability alongside
  existing working code rather than rewriting it, unless the existing code
  is demonstrably wrong.
- **Do not add speculative abstraction, configuration, or error handling**
  for scenarios that cannot currently occur. Validate at real system
  boundaries (user input, external AI responses, external APIs) — trust
  internal code and already-established framework/database guarantees
  elsewhere.
- **Comments explain why, not what.** No comment describing what a line of
  code obviously does; a comment is only for a non-obvious constraint,
  invariant, or reason a decision was made a certain way.

---

## 9. Database Security

- **RLS is enabled on every table** in `public`.
- **Granular CRUD policies are the standard shape**: one policy per verb —
  `anon_select_<table>`, `anon_insert_<table>`, `anon_update_<table>`,
  `anon_delete_<table>` — each scoped to exactly the Postgres clause that
  verb needs (`USING` for SELECT/DELETE, `WITH CHECK` for INSERT, both for
  UPDATE). New tables follow this exact naming and shape, not a single
  blanket policy — `capture_queue`'s single custom policy (§4) is the one
  documented exception, not a pattern to copy elsewhere.
- **No legacy `allow_all` / `allow_all_anon` blanket policies.** These were
  removed as fully redundant with the granular set and must not be
  reintroduced. If a table's granular CRUD policies are ever missing, add
  the missing granular policy — do not paper over it with a blanket one.
- **The `receipts` Storage bucket is private**, scoped by
  `bucket_id = 'receipts'` policies for select/insert/update/delete. Nothing
  is publicly readable by URL guessing.
- **Original receipt files only** are stored in Storage — no thumbnails, no
  derived copies, no duplicate uploads on retry (Capture Inbox retries reuse
  the same uploaded pages).
- Because the app has no per-user auth (§2), these policies exist to let
  PostgREST serve the anon-key app at all, and to keep the schema clean and
  auditable — they are not a substitute for authentication if FinanceOS
  ever needs one. If real multi-user access is ever required, that is a new
  architectural decision requiring its own design, not an extension of the
  current policy shape.

---

## 10. Project Status

**Frozen architecture** (do not redesign without an explicit decision to do
so): Repository/Service layering, the single-Gemini-multimodal-call Capture
pipeline, the Capture Inbox async queue, one shared Review Screen, the
Save flow's atomic-header-then-items persistence, Activity as the
transaction system of record, RLS with granular per-verb policies.

**Completed milestones:**
- Capture Inbox (async queue, background AI processing, retry-safe).
- Review Screen (create + edit, shared component).
- Save (atomic transaction persistence, receipt attachment linking).
- Activity (list, search, Edit/Delete on saved transactions).
- Simple Account Mapping Rules (keyword/card-digit/user-context hints for
  source account identification — AI hints only, not a rule engine).
- Database security cleanup (legacy blanket policies removed, granular
  CRUD policies standardized, obsolete `app_settings` table removed).

**Current active milestone:** none in progress as of this writing — the
system is in a stable, verified state pending the next scoped request.

**Parking lot:** see §11.

---

## 11. Parking Lot

Stable future ideas only — not bugs, not temporary reminders, not
implementation plans. An idea belongs here only once it is a settled
direction, not a passing suggestion.

- **Transfer / Withdrawal auto-routing.** When the AI determines a manual
  text entry represents a Transfer or a Withdrawal, that flow should bypass
  Review, Capture Inbox, and Receipt Processing entirely: Manual Text → AI
  Intent Detection → Validate Accounts → Direct Save → Activity. Not yet
  implemented; requires its own milestone and design before any code is
  written.
- **Auto Save / optional Review.** Direction described in §7 — letting
  high-confidence captures skip Review — is a settled goal, not yet built.
- **Investment module.** Data model exists (`investment_events`,
  `investment_snapshots`, `investment_account_summary`); no UI/workflow
  built on top of it yet.
- **Data Management / admin tooling.** Placeholder area for future
  data-maintenance workflows (bulk edit, export/import); not designed yet.
- **Payment Method field.** Removed from the Review UI (Account already
  represents the payment source); no replacement is planned unless a
  concrete, distinct need is identified.

---

## 12. Maintenance Rules

These rules govern how this file itself is maintained — follow them at the
completion of every milestone or significant architectural change.

1. Review whether the implementation changes any stable architectural
   decision recorded in this document.
2. If it does, update CLAUDE.md before stopping.
3. If it does not, explicitly state: "No CLAUDE.md update required."
4. Keep CLAUDE.md concise — trim before adding, don't just append.
5. Never add: bug history, session history, git commits, temporary fixes,
   TODO lists, or personal notes.
6. Only document stable decisions that future development should follow.
7. At the end of every milestone, report:
   - CLAUDE.md updated: Yes / No
   - Sections updated
   - Reason for the update
