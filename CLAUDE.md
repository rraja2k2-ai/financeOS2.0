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
  extracts structured data → transaction is saved immediately → the
  Capture screen itself shows a calm success card (thumbnail + key
  fields) and the user chooses **Review Transaction** or **Done** — there
  is no automatic navigation anywhere. Review never gates the save — it
  only ever happens after the transaction already exists, and only if the
  user asks for it — see §5/§7.

---

## 2. Technology Stack

**Frontend**
- Next.js (App Router, Turbopack), React, TypeScript.
- Tailwind CSS for styling. No component library beyond small in-house
  primitives (`components/`).
- Lucide (`lucide-react`) for icons — e.g. category icons in Activity, mapped
  by primary category name with a generic fallback for anything unmapped.
  No other icon library.

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
- **`transaction_items` carries three reserved, nullable item-attribute
  columns for future Receipt Intelligence — `unit`, `pack_size`, and
  `unit_price`** (migration 018; `unit_price` existed earlier and already
  round-tripped through `save_transaction`). All three are foundation only:
  every layer (domain type, repositories, `CreateTransactionInput`,
  `ReviewedItem`, `ItemDraft`/`TransactionItemRow`) can carry them, but
  nothing infers or calculates them, no UI shows or edits them yet, and
  `updateReviewedTransaction` deliberately never includes them in its
  per-item update payload — so an edit-save can never null out a value a
  future milestone eventually writes. They stay NULL on every row until an
  actual AI-extraction, manual-entry, or Workspace-UI milestone populates
  them; that milestone should add to this foundation, not build a second
  item-attribute path.

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
- `accounts` has **no `institution` or `account_number` columns** — decided
  twice now (Account Detail, then Settings Accounts Management) not to add
  them. Account status is **Active/Inactive only** (reused for Archive/
  Restore — "Archived" in the UI is stored as `status: "Inactive"`, the
  same convention Projects already uses; there is no separate "Archived"
  status value and no schema change for it). Do not reintroduce either
  field or a new status value without a fresh decision.
- **`account_type = 'LoanToOthers'` displays as "Receivable" everywhere**
  (Dashboard KPI Filter milestone) — the schema value itself never changes;
  this is a display-label standardization only. Previously three different
  UI strings existed for this one value ("Loan to Others" in
  `constants/accounts.ts`'s `ACCOUNT_TYPE_LABELS`, "Receivable" in
  `services/finance/accounts.service.ts`'s own local `TYPE_LABELS`, and an
  inline "Loan to others · not held cash" in `AccountsView.tsx`) plus
  Dashboard's own hardcoded Net Cash tab label ("Loans"). All four now say
  "Receivable"/"Receivables". Use "Receivable" for any new surface — do not
  reintroduce "Loan(s)" as user-facing text for this account type.
- **`accounts.opening_balance` is creation-only and permanently historical**
  (Master Data & Account Management Refactor) — `AccountUpdateInput` never
  accepts it, so Edit Account cannot touch it after creation. **The one
  sanctioned way to change `current_balance` is Adjust/Correct Balance**
  (`services/finance/balance-correction.service.ts`): it never writes
  `current_balance` directly, instead computing the signed difference and
  saving a normal, system-generated `ADJUSTMENT` transaction through the
  same save path every other transaction uses, posted through the Account
  Posting Engine (`account-posting.service.ts`) like any other transaction.
  A **reason is mandatory** (v1.8.0) — it becomes the transaction's
  `merchant`/reference text (visible in Activity), not just an internal
  note; the previous→new balance summary itself lives in `comments`
  (stored, not surfaced in any UI today). The one shared
  `components/accounts/CorrectBalanceForm.tsx` component (never
  duplicated) is opened from Settings → Accounts → Edit → "Correct
  Balance" and from Account Detail's own "Adjust Balance" header action —
  two entry points into one workflow, matching §7's "one shared workflow"
  pattern already established for the Review Screen.
- **`accounts.display_order`** (migration 024) is a persistent,
  user-controlled ordering, nullable (null sorts last). Every consumer
  gets it "for free" because `account.repository.ts`'s `list()` is the
  **single ordering choke point** — it orders by `display_order` once, and
  every caller (Accounts, Account Detail, Dashboard, Capture's master
  data, the Review Screen's Account/Destination pickers) simply preserves
  that array order rather than re-sorting. Up/Down arrows
  (`reorderAccountsAction`) live in Settings → Accounts Management; do not
  add a second reordering UI or a second place that re-sorts accounts by
  name — extend this one choke point instead.
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
- **`transaction_headers.transaction_type` supports exactly five values —
  `EXPENSE`, `INCOME`, `TRANSFER`, `REFUND`, `ADJUSTMENT`** (uppercase),
  defined once in `constants/transaction-types.ts` (`TRANSACTION_TYPES`,
  `TransactionType`, `TRANSACTION_TYPE_LABELS`,
  `MERCHANT_FIELD_LABELS`) — every future consumer (validation, UI,
  Gemini prompt) must reuse this file, never a new literal. No other
  transaction type may be introduced; scenarios like Investment, Loan,
  Cash Withdrawal/Deposit, Credit Card Payment, Lending, Dividend, or
  Interest are modeled as one of these five (typically `TRANSFER`), not as
  new types. `merchant` is reused as-is for all five — only its UI label
  changes per type (`MERCHANT_FIELD_LABELS`); no `external_party`/
  `counterparty` column was added. A `CHECK` constraint enforcing this set
  is live and fully validated (migration 017) — legacy Title Case values
  (`Expense`, `Payment`, `Transfer`, `Lending`) have been migrated
  (`Expense`→`EXPENSE`; `Payment`/`Transfer`/`Lending`→`TRANSFER`, since
  all 7 non-Expense rows were either an internal move between two of your
  own accounts or an external party with one side null) — no legacy value
  remains in the database, and `lib/expense-filter.ts` no longer carries a
  legacy-string fallback. **All five types now flow end-to-end** (Transaction
  Type Intelligence Pipeline milestone): Gemini classifies `transactionType`
  as part of its single extraction call (`prompts/receipt-processing.prompt.ts`,
  `CaptureReceiptResult.header.transactionType`), `normalizeReceiptResult()`
  defaults a missing/invalid value to `EXPENSE` rather than throwing, the
  Review Screen (one shared screen, see §7) has a `Type` selector next to
  Currency/Account/Project (default `EXPENSE`, editable), and
  `saveReviewedCapture()`/`updateReviewedTransaction()` persist whatever
  value is selected instead of a hardcoded literal. Editing an existing
  transaction loads and can change its `transaction_type` like any other
  field. **Validation is type-aware** (Transaction Type Intelligence Part 2,
  `services/capture/save-capture.service.ts`'s `merchantRequiredFor()` /
  `validateForType()` — one shared rule function, used by save, update, and
  the Review Screen's own client-side check): merchant is required only for
  `EXPENSE`/`REFUND`; `INCOME`/`TRANSFER`/`ADJUSTMENT` may save with an
  empty merchant (a bank transfer, an ATM withdrawal, a balance correction
  rarely has a natural counterparty name). **Destination account now flows
  end-to-end too**: Gemini returns `headerSuggestions.destinationAccount`
  (an exact `ACCOUNTS` name, or null) alongside the existing source
  `account` suggestion, for `TRANSFER`/`INCOME` only; the Review Screen
  shows a `Destination` selector (same `MetaPill`/account-select pattern as
  `Account`) only when the selected type is `TRANSFER` or `INCOME`; save/
  update resolve it to `target_account_id` exactly like `account` resolves
  to `source_account_id` — an unmatched or absent name resolves to `null`,
  never a validation failure, since an external destination (lending to a
  person, an outside party) is legitimate, not an error. Editing preserves
  and can change the destination like any other field.

  **`merchant` is finalized as one reused column for all five types — no
  new column was added** (Transaction Type Finalization milestone). Its UI
  label switches per type via `constants/transaction-types.ts`'s
  `MERCHANT_FIELD_LABELS` (`EXPENSE`/`REFUND` → "Merchant", `INCOME` →
  "Received From", `TRANSFER` → "External Party", `ADJUSTMENT` →
  "Reference"). `TRANSFER` has no stored "internal vs external" flag —
  it's derived purely from whether `target_account_id` resolves to a real
  account: an **Internal Transfer** (destination resolves) hides the
  merchant field entirely in the Review Screen and forces `merchant` empty
  at save regardless of what the field held
  (`save-capture.service.ts`'s `resolveMerchantForSave()`, shared by save
  and update — never duplicated); an **External Transfer** (no destination,
  or an unresolved name) shows the field labeled "External Party", holding
  the external party's name, optional. The AI prompt teaches Gemini this
  same per-type meaning for the existing `header.merchant` field — no new
  output field was introduced. **Still out of scope** (separate,
  not-yet-scoped milestones): a hard requirement that a destination account
  be selected (it stays optional by design), Receivables/external-contact
  tracking for the external case, and account balance posting
  (`accounts.current_balance` is still never updated by any transaction).

- **`recurring_rules` is the single table for Recurring Transactions**
  (migration 026). A row is a **living template, not historical data** —
  editing it (merchant/amount/category/account/project/comments/frequency/
  end condition) only ever changes future-generated transactions; every
  already-generated transaction is an ordinary, independent
  `transaction_headers` row and never changes retroactively. Generation is
  **entirely manual** — no cron, no background job, no scheduled function —
  a single "Generate Recurring Transactions" action (Settings → Recurring
  Transactions) walks every `ACTIVE` rule whose `next_due_date` is due (up
  to today by default; a custom date is offered only as a collapsed
  recovery option for catching up missed months) and creates each
  occurrence through the existing `transactionService.createTransaction()`
  — posted through the normal Account Posting Engine exactly like any
  other transaction; recurring generation is not a second posting engine.
  `next_due_date` is the **sole** progress cursor, advanced immediately
  after each individual generated transaction (never batched) — there is
  deliberately **no `recurring_rule_id`** column on `transaction_headers`
  linking a generated transaction back to its rule; duplicate-prevention
  and "what's next" rest entirely on `next_due_date`, and a generated
  transaction is simply an ordinary transaction from the instant it
  exists, indistinguishable from a manually entered one. `start_date` is
  immutable after creation — it's the clamp anchor for month/year
  recurrence math (`advanceDueDate()` in `services/finance/
  recurring-rule.service.ts`, the one implementation of the
  interval-stepping logic, reused by both generation and "After N
  Occurrences" end-date resolution). Rules support **single-line
  transactions only** — a rule's own category/amount map directly to one
  generated line item; multi-line recurring transactions are out of scope.
  A failed occurrence (validation, missing exchange rate, deleted account,
  posting failure) stops generation for that rule only, leaving
  `next_due_date` at the failed occurrence for the next run to retry —
  other rules in the same run are unaffected. Deleting an account
  referenced by an `ACTIVE` rule is blocked (`account-management.service.ts`),
  mirroring the existing transaction-history delete guard. "Make
  Recurring" (Review Screen) is the only creation path — merchant,
  category, account(s), project, and comments are inherited from the
  transaction's header (a multi-item transaction's header-level
  `primary_category` and total, never itemized detail); the recurring
  rule form only asks for frequency and end condition.

- **`project_budgets` is the single budget table, reused for three distinct
  concerns via `row_type`, its one row discriminator** (`CHECK` constraint —
  `MONTHLY`, `LIFETIME`, `CATEGORY_MASTER` — migration 025). `row_type` is
  the only signal any repository or service may use to determine what a row
  represents. `budget_month` holds calendar information only and must never
  be compared against a value to infer row identity — a future need for
  another non-monthly row kind must extend `row_type`, never reach for a
  `budget_month` value trick.
  - **`MONTHLY`** rows are real calendar-month budget lines — normal
    monthly budgets, cloned/reset/carried-forward month to month.
  - **`LIFETIME`** rows are a named project's non-monthly lifetime budget
    lines (`services/finance/project.service.ts`) — one row per project per
    category, never cloned or reset, `budget_month` unused.
  - **`CATEGORY_MASTER`** rows are category identity data, one permanent row
    per (`primary_category`, `secondary_category`) pair, living on the
    Generic project. **The Generic project's `CATEGORY_MASTER` rows are the
    single source of truth for every category FinanceOS knows about** —
    Capture, Review, AI Categorization, Budget, and the Categories Settings
    reference page all read this same set; no other table or constant
    defines categories. `is_archived` on a `CATEGORY_MASTER` row retires a
    category (removed from Capture/Review/Budget's "add category" list and
    from future-month cloning) without touching any historical `MONTHLY`
    row. **Budget is the only place `CATEGORY_MASTER` rows are created,
    renamed, archived, or restored** (Create/Rename/Archive/Restore all
    live in `services/finance/budget.service.ts`; Restore is v1.8.0's
    explicit counterpart to Archive — createCategory already silently
    revived an archived pair re-typed with the exact same name, but Restore
    gives that its own first-class action instead of relying on that side
    effect). Settings → Categories (`app/settings/categories/page.tsx`)
    stays a **read-only reference page** reading this same set — it has no
    create/rename/archive/restore affordance of its own, so there remains
    exactly one category management workflow, not two (reviewed again in
    v1.8.0; this is a deliberate, settled decision — do not add management
    actions there without a fresh decision to change it). Add Category's
    Primary/Secondary fields each offer a picker of existing (non-archived)
    names alongside a "+ New" free-text option (v1.8.0 Budget UX), so a new
    pairing can reuse an established name instead of risking a near-duplicate
    free-text entry; archived names are excluded from these pickers on
    purpose (reviving one goes through Restore, not an implicit retype).
    **One-time/temporary budgets (a home renovation, a wedding, a trip) are
    deliberately modeled as Projects, not as one-time Categories** —
    reviewed in v1.8.0: Projects already have their own `LIFETIME` budget
    envelope (`services/finance/project.service.ts`), their own lifecycle
    (Active/Inactive, no monthly cloning), and their own analytics/drill-down
    page, which is exactly what a one-off budget needs; a parallel
    "one-time Category" concept would duplicate that mechanism inside the
    Generic project's permanent category taxonomy for no added benefit. Do
    not introduce one-time/temporary Categories — create a Project instead.

---

## 5. Capture Architecture

`capture_queue` is a **transient processing queue, not a history table.**
Activity is the permanent transaction history. A queue row's entire purpose
is to exist while a capture is in flight or waiting on a retry — nothing
more.

The capture pipeline, in order:

```
Capture
  ↓
AI
  ↓
Save Transaction
  ↓
Save Receipt
  ↓
Delete Queue Row
  ↓
Refresh Activity
```

1. **Capture Launcher** — entry point UI that starts a capture (photo,
   file, or text-only).
2. **Capture Modal** — collects the receipt page(s) and free-text user
   context, shows a real vertical progress timeline (no generic spinners,
   no simulated timers for the steps a real signal exists for — see §7),
   and **owns its own capture end-to-end**: it stays open through
   uploading, queueing, and the background AI/Save run, polling the queue
   row it just created. On success it shows a calm success card in place
   — see §7's Capture success experience — and **never navigates
   anywhere on its own**; on failure — enqueue failure or a background
   AI/Save failure — it stays open with the real error, a Retry, a
   Delete, and an "Open Capture Inbox" escape hatch, so an uploaded
   receipt is never lost and the user is never left not knowing what
   happened.
3. **Capture Inbox** (`capture_queue`) — an async work queue. A capture
   enqueues immediately (status `Processing`) and processes in the
   background; the user is never blocked waiting on the AI call.
4. **AI processing** — exactly **one** Gemini multimodal request per
   capture, combining OCR, extraction, and categorization. Never split into
   multiple OCR passes or multiple AI calls for the same capture.
5. **Save** — if the AI returns a result, it is saved **immediately**, with
   no eligibility check, confidence threshold, or manual approval step:
   transaction header + line items persisted atomically, receipt attachment
   rows linked to the already-uploaded Storage files.
6. **Record the exact id, then delete the queue row** — the moment the
   save succeeds, `capture_queue.transaction_header_id` is set to the
   EXACT `transaction_headers.id` just created (status stays `Processing`
   — no new status value). The Capture Modal reads this id to fetch the
   saved transaction's summary for its own success card (see §7) — it does
   **not** navigate anywhere. Whichever poller reads the id first (the
   Capture Modal, or `InboxIndicator` as a fallback whenever the Modal
   isn't open — see §7) consumes the row (`consumeSavedCapture`,
   metadata-only — never touches Storage). The queue never holds a
   **visible** "Saved" row (no new status, and the id-bearing window is
   momentary); the transaction in Activity **is** the record from that
   point on.
7. **Refresh Activity** — the saved transaction appears automatically,
   newest first; see §7.

**Only genuine failures remain in the queue** — the AI call itself
throwing, or the save throwing (e.g. a missing exchange rate) — as status
`Failed`, retryable, with the original receipt pages untouched so nothing
is ever lost. `capture_queue.status` only ever holds `Processing` or
`Failed` going forward; the column's check constraint still technically
permits `Uploading`, `Ready for Review`, and `Saved` from before this
cleanup, but the app never writes them again.

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
- **Item extraction contract (Gemini Receipt Intelligence Contract) — facts
  only, never calculated, normalized, or inferred.** Every item carries
  `qty`, `unit`, `packSize`, and `unitPrice` (`CaptureReceiptResult.items[]`,
  `services/ai/ai-provider.ts`), each null unless the receipt (or user
  context) states it directly:
  - `qty` — how many of `unit` were bought (a discrete count), or the
    measured amount itself for a loose/variable-weight item.
  - `unit` — the discrete package word ("bag", "bottle", "pack", "box",
    "can", "tray", "bundle", "pair", "set", "pc") for a pre-packaged item,
    or the measure itself ("kg", "g", "L", "ml") for a loose/variable-weight
    item with no fixed package.
  - `packSize` — the pre-packaged size exactly as printed ("5 kg", "2 L").
    Only exists for a pre-packaged item; a loose/variable-weight item has
    none, since `qty`+`unit` already **are** the measured amount.
  - `unitPrice` — the per-unit rate exactly as printed (e.g. "$8.40/kg" →
    `8.40`). Never `lineAmount ÷ qty` — null when no rate is printed.
  - **Packaged vs. variable-weight, the one distinction that matters most:**
    "Ponni Rice 5 kg" is a packaged product — its printed size describes the
    *package*, so `qty=1, unit="bag", packSize="5 kg"`, never
    `qty=5, unit="kg"`. "Chicken 1.356 kg" is variable-weight — the printed
    number *is* what was measured and bought, so `qty=1.356, unit="kg",
    packSize=null`.
  - These fields are extracted and persist (see §4's `transaction_items`
    columns) but are **not yet shown or editable anywhere in the UI** — that
    is a future Receipt Intelligence UI milestone, not this contract.
    `docs/ai/receipt-item-contract-examples.md` is the permanent worked-
    example catalogue (packaged/variable-weight/liquids/multi-packs/loose
    produce/meat/fish/eggs/rice/milk/bakery/cleaning/household) a future
    prompt-tuning pass should regression-test against.

---

## 7. UI Principles

- **Minimize clicks for a personal, daily-use workflow.** This is a tool
  one person uses repeatedly, not a form for occasional enterprise users —
  optimize for speed of repeated use over guided hand-holding.
- **Review never gates the save.** A successful AI result is saved
  immediately, with no manual approval step before persistence — Review
  only ever happens after the transaction already exists, and only if the
  user explicitly asks for it (the Capture success card's **Review
  Transaction** button, below, or manually later via Activity).
- **One Review Screen, reused — Edit-only, opened only by hand.** The same
  Review Screen component (`ReviewScreen.tsx`, the reusable Transaction
  Workspace foundation) that once gated every capture now only edits an
  already-saved transaction — opened from Activity's `⋮ → Edit`, Dashboard
  Recent Transactions' `⋮ → Edit`, Account Detail's Recent Transactions
  `⋮ → Edit`, or the Capture success card's **Review Transaction** button
  right after a fresh capture. All four entry points share one
  `hooks/useTransactionEditor.ts` hook for the fetch-master-data /
  fetch-transaction / save / delete sequence — never re-implemented per
  screen. There is no second editor anywhere in the app. Any future "edit"
  surface must reuse this hook and this component, reshaping existing data
  to look like a fresh AI result rather than building a parallel form. The
  screen also shows Capture Date (`transaction_headers.created_at`)
  read-only next to Receipt Date, and offers **Delete Transaction** itself
  (confirm-then-delete, same `DELETE /api/transactions/[id]` every entry
  point already used) — so any screen that can open the editor gets delete
  for free without its own delete UI.
- **Activity is the source of truth** for what has been saved. Once a
  transaction is saved, Activity is where it lives, is displayed, and is
  viewed (its original receipt) — deletion is no longer Activity-only:
  Activity's own card menu still has a direct Delete, and the Review
  Screen's Delete Transaction (above) reaches every other entry point.
  Editing can also be triggered directly from Dashboard's Recent
  Transactions and Account Detail's Recent Transactions (same Review
  Screen, same `PUT /api/transactions/[id]` save path) as a shortcut so the
  user never has to open Activity just to fix an OCR mistake; that
  endpoint's response also carries a `recentTransaction` summary (an
  additive field Activity's own save handler ignores) so Dashboard can
  patch just that one card in place instead of calling `router.refresh()`.
  Activity refreshes itself automatically when a background capture
  finishes, newest transaction first — the user is never required to
  manually reload to see it.
- **Capture success experience — no automatic navigation, ever.** The
  Capture Modal owns detecting its own capture finishing while it's open:
  it polls its own just-queued `capture_queue` row directly
  (`GET /api/inbox/[id]`) and reacts the moment its `transactionHeaderId`
  is set (saved) or it turns `Failed`. While queued/processing it shows a
  vertical progress timeline (receipt thumbnail + steps — Receipt
  Uploaded/Context Received, Reading Receipt, Extracting Items,
  Categorizing, Saving Transaction) rather than a generic spinner. On
  success — **in place, without navigating anywhere** — it replaces the
  timeline with a calm success card (thumbnail, Merchant, Total Amount,
  Items, Receipt Date, Account, Category) and exactly two actions: **Review
  Transaction** (fetches master data and opens the one shared Review
  Screen, in Edit mode, on top of the Modal) and **Done** (closes the
  Modal, no navigation — the user stays exactly where they were). Saving
  from Review, or Done, both simply close back out; there is nothing to
  discard either way since the transaction was already saved before this
  screen ever appeared. A failed capture keeps the Modal open with the
  real error, Retry, Delete, and Open Capture Inbox — Capture Inbox stays
  exception-handling only, never the normal path. `InboxIndicator` (the
  global, always-mounted indicator) is the fallback for the same
  `transactionHeaderId` signal whenever the Modal isn't open to see it
  (e.g. the user navigated away mid-processing): it consumes the row
  (`consumeSavedCapture`, §5) so the queue doesn't linger, but — like the
  Modal — it **never navigates**; the user finds the transaction in
  Activity on their own. A reusable `ConfidenceBadge` component
  ("Needs Review" / "Review Recommended") exists for the success card but
  is intentionally unwired — no confidence-scoring logic exists yet
  anywhere in the app; wiring it to a real signal is future work.
- **Activity's `?highlight=<id>` deep link always finds its target,
  regardless of that transaction's own date.** Activity's page load
  normally fetches only a rolling ~366-day window
  (`getActivityWithHighlight` in `activity.service.ts`); when a
  `highlightId` is present and falls outside that window — an
  intentionally old back-dated receipt, or any other reason its
  `transaction_date` lands outside the range — it is fetched individually
  and merged in, so a `?highlight=` link (e.g. from Dashboard's Recent
  Transactions) never silently opens Activity without locating the
  transaction. Activity also still supports an optional `&edit=1` to
  auto-open Edit on the highlighted transaction, but nothing in the app
  generates that combination automatically anymore — it would only be
  used by a future deliberate deep link.
- **Two distinct dates exist per transaction, and each drives a different,
  non-overlapping part of the app (Fix 6.4.2) — never blend or substitute
  one for the other:**
  - **Receipt Date** (`transaction_headers.transaction_date`) is the
    business/accounting date. It drives **Activity's ordering, grouping,
    and period filter**, and is what Budget, Reports, and Project
    allocations already keyed off of. A receipt captured today for an
    older expense still lands under its own date in Activity.
  - **Ingestion Date** (`transaction_headers.created_at`) is the system
    capture timestamp. It drives **only** the Dashboard's Recent
    Transactions card's ordering (`listRecent` in
    `transaction-header.repository.ts`). Post-capture navigation (§5/§7)
    uses the exact id `capture_queue.transaction_header_id` carries, never
    a date-based lookup. Ingestion Date never orders or groups Activity.
  - Activity's expanded transaction shows **both** — Receipt Date as the
    primary business date, Captured (date + time) as informational only —
    so the distinction stays visible rather than silently assumed.
    **Dashboard's Recent Transactions card shows both too** (Fix 6.4.4,
    e.g. "R: Jul 19 • C: Jul 20, 3:32 PM") so it's clear where to find the
    transaction inside Activity, even though the card's own sort order
    stays Ingestion Date.
- Header-level actions on a transaction (edit, view receipt, delete) live
  behind a single `⋮` overflow menu in the transaction header — icon-only,
  no permanently visible action buttons, rendered through a portal so it's
  never clipped by the transaction card's own bounds.
- **Bottom navigation holds only the five frequently-used modules** —
  Dashboard, Activity, Accounts, Budget, Settings — since
  mobile screen width can't fit more without crowding. Every other page
  (Projects, Investments, AI Settings, Appearance, Base Currency,
  Categories, Exchange Rates, Data Management, About) is reachable one
  tap away from the Settings hub (`/settings`), which is a plain list of
  links — no page was removed or had its own URL changed, they're just
  not primary-nav-level. A new secondary/administrative page is added to
  that Settings list, never to the bottom nav.
- **Theme (Settings → Appearance) is System / Dark / Light**, default
  **Dark** when nothing has been chosen yet. It's a per-device rendering
  preference stored in `localStorage` only (`lib/theme.ts`) — never in the
  database — applied via a pre-paint `<head>` script (no flash of the wrong
  theme) and kept live-consistent with OS changes by a small mounted-once
  component (`ThemeSync`). One mechanism for the whole app; do not add a
  second theme store or a per-page override.

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
- Review Screen (shared component; now Edit-only — see §7).
- Save (atomic transaction persistence, receipt attachment linking).
- Activity (list, search, Edit/View Receipt/Delete via a header overflow
  menu, auto-refreshing when a background capture finishes).
- Simple Account Mapping Rules (keyword/card-digit/user-context hints for
  source account identification — AI hints only, not a rule engine).
- Database security cleanup (legacy blanket policies removed, granular
  CRUD policies standardized, obsolete `app_settings` table removed).
- Auto Save (a successful AI result is saved immediately, no manual Review
  step, no eligibility/confidence gating — see §5/§7).
- Capture success experience (progress timeline + success card, Review
  Transaction / Done choice, no automatic navigation — see §7).
- Account Detail (`/accounts/[id]`) — drill-down page per account with a
  period-scoped Income/Expenses/Net Change/Transaction Count summary and a
  5-row Recent Transactions preview, both reusing Activity's extracted
  `TransactionCard` component (`components/activity/TransactionCard.tsx`).
  Clicking a preview row, or "See All Transactions," navigates to Activity
  with `?account=<id>&period=<key>` (plus `&highlight=<id>` for a single
  row) pre-applied; Activity reads these alongside its existing
  `?highlight`/`?edit` params to narrow its list and auto-apply the period
  instead of its own highlight-driven default.
- Settings → Accounts Management — full CRUD on `accounts` from
  `/settings/accounts` (`SettingsAccountsView.tsx` → `app/settings/accounts/
  actions.ts` → `services/finance/account-management.service.ts` →
  `repositories/account.repository.ts`): Add/Edit (name/type/currency/
  opening balance/notes, with duplicate-name and blank/invalid-balance
  validation), Archive/Restore (reuses `status`, see §4 — needs no changes
  to Dashboard/Capture/Accounts, which already filter `status === "Active"`),
  and Delete (blocked with an inline message if the account has any
  transaction history as source or target; Archive is offered instead).
- Dashboard Category Drill-down — the Dashboard's own inline "Top
  Categories" card (a pre-existing separate implementation from the shared
  `TopCategoriesCard` used by Activity — left as-is, not consolidated, so
  the Dashboard's exact visual design stayed untouched) gained click-to-
  navigate: a subcategory row links to Activity with `?category=<primary>
  &subcategory=<secondary>&period=this-month`; a "View all {category} →"
  link (shown once expanded, alongside the subcategory rows) links with
  `?category=<primary>` only. The category row's own click still only
  expands/collapses in place, same as before — Dashboard has no period
  selector of its own, so `period` is always `this-month`. Activity now
  also reads `?category`/`?subcategory` (alongside `?account`/`?period`),
  matching whole transactions that have at least one item in that primary
  (and secondary, if given) category — same chip-plus-Clear pattern as the
  account filter, same underlying data (`ActivityTransaction.items`), no
  new repository or service query.
- Dashboard Recent Transactions Edit Action — each Dashboard Recent
  Transactions card gained the same portal-based `⋮` overflow menu style
  as Activity's own cards, with two items in order: Edit, then View in
  Activity (unchanged `?highlight=<id>` link). Edit opens the same shared
  Review Screen used everywhere else — see §7's "One Review Screen,
  reused." Save patches just that one card's local state from the
  `PUT /api/transactions/[id]` response's new `recentTransaction` field;
  Dashboard never calls `router.refresh()` for this, so the rest of the
  Dashboard (Today's Pulse, Top Categories, other cards) never re-fetches
  just because one transaction was edited.
- **Transaction Workspace Foundation** — the Review Screen became the
  reusable foundation for all future transaction editing (see §7's "One
  Review Screen, reused"): a fourth entry point (Account Detail's Recent
  Transactions `⋮ → Edit`, previously the only list with no edit
  affordance) was wired up, Delete Transaction moved into the Review
  Screen itself (confirm-then-delete, reusing the existing DELETE API),
  Capture Date joined Receipt Date as a read-only header field, and the
  duplicated fetch/save/delete orchestration that Activity and Dashboard
  each carried separately was extracted into one `useTransactionEditor`
  hook (`hooks/useTransactionEditor.ts` — the app's first shared React
  hook; existing screens kept their own post-save behavior — Activity
  toasts + refreshes, Dashboard/Account Detail patch or refresh locally —
  via the hook's callback options, not a forced single strategy). The line
  item row was extracted into `TransactionItemRow.tsx` so a future
  Receipt Intelligence milestone (Quantity/Unit/Pack Size/Unit Price) can
  extend one component instead of restructuring the Review Screen. No
  Transaction Types, receipt-image display, or line-item add/delete were
  introduced — explicitly out of scope for this milestone.
- **Master Data & Account Management Refactor** — Correct/Adjust Balance
  (see §4's `opening_balance`/`display_order` bullet) replaced any notion
  of directly editing `current_balance`: Opening Balance locked read-only
  after creation, and the only way to change Current Balance became a
  system-generated `ADJUSTMENT` transaction through the normal save +
  Posting Engine path. Accounts gained a persistent `display_order`
  (migration 024), ordered at the single `account.repository.ts` choke
  point so every consumer stays consistent automatically. Settings →
  Accounts Management gained full CRUD (Add/Edit/Archive/Restore/Delete)
  with duplicate-name and balance validation.
- **Category Master architecture** — `project_budgets.row_type` became the
  structural discriminator separating `MONTHLY`/`LIFETIME`/`CATEGORY_MASTER`
  rows in one shared table (see §4). Budget became the sole place
  categories are created/renamed/archived; Settings → Categories became a
  read-only reference page reading the same Category Master set.
- **v1.8.0 Account & Budget UX** — Adjust Balance is now also reachable
  directly from Account Detail (`/accounts/[id]`'s header action), sharing
  one `CorrectBalanceForm` component with Settings' Edit dialog (no second
  implementation); the workflow now requires a mandatory Reason, which
  becomes the Adjustment transaction's visible reference text (see §4).
  Account mutation actions (`app/settings/accounts/actions.ts`) now also
  revalidate `/` so Dashboard's Net Cash reflects every account change,
  not just a reorder. Category Master gained an explicit Restore action
  (`restoreCategory`/`restoreCategoryAction`) with an Archived Categories
  list in Budget, and Add Category's Primary/Secondary fields gained
  existing-name pickers alongside free-text "+ New" entry (see §4). This
  milestone was scoped as UX/workflow only — Account ordering-in-every-picker
  and the Category Master management model were both verified already
  complete from the two undocumented milestones above (a genuine CLAUDE.md
  staleness this milestone also fixed) rather than re-implemented. Reviewed
  and rejected: one-time/temporary Categories (Home Renovation, Europe
  Trip, Wedding, etc.) — Projects already solve this; see §4.
- **Recurring Transactions** — `recurring_rules` (see §4), Settings →
  Recurring Transactions (`/settings/recurring`) as the sole management
  surface (list showing Merchant/Amount/Frequency/Next Due/Status, with
  Edit/Activate-Deactivate/Delete), and "Make Recurring" on the Review
  Screen as the sole creation path. Deliberately excluded from this
  milestone, not future-proofed for: notifications/reminders,
  forecasting, multi-line recurring transactions, a `recurring_rule_id`
  link on generated transactions, and any automatic (cron/background)
  generation.
- **Dashboard KPI Filter** — the Dashboard's "Estimated Monthly Savings" row
  was replaced with three KPI cards: Income / Expenses / Cash Surplus,
  where Cash Surplus = Income − Expenses. `dashboard.service.ts`'s
  `getMonthlyIncomeAndExpense` now classifies Income by
  `transaction_type === 'INCOME'` (previously by category taxonomy via
  `categoryTypeFor`) so both Income and Expense use the same single
  classification axis as the rest of the app. Refund is untouched and
  still excluded from both totals — a deliberately parked, separate
  accounting-period discussion, not a gap to fix here.

  **The three KPI cards always show the true, unfiltered totals — there is
  no Income/Expense chip filter.** One was built during this milestone,
  live-verified, then deliberately removed after a follow-up architecture
  review: a personal finance dashboard's KPI row exists to tell the truth
  about the user's position, not to expose a hide-this-number toggle, and
  Dashboard has no other analytical surface (a Top Categories view, a
  spend chart, a trend view) for such a filter to honestly attach to — so
  it had no real destination and no visible purpose today (Recent
  Transactions is intentionally an unfiltered ledger, Net Cash must stay
  true, Budget must stay Expense-only). If a genuine analytical Dashboard
  surface is ever added, revisit filtering there — do not reintroduce a
  chip filter on the KPI cards themselves without a fresh decision.
- **Investment Portfolio Version 1** — replaces the old, never-built
  `investment_events`/`investment_snapshots`/`investment_account_summary`
  data model (migration 028 dropped all three) with a fully derived design:
  `services/finance/investment-portfolio.service.ts` is the single place
  every Investment screen computes its four metrics from — **Capital
  Invested** (`TRANSFER` in − `TRANSFER` out on the account),
  **Current Market Value** (`accounts.current_balance`, converted to SGD —
  already the Adjust/Correct Balance-maintained figure, already posted
  through the Account Posting Engine as an `ADJUSTMENT`), **Portfolio
  Gain/Loss** (Current Market Value − Capital Invested), and **Dividends /
  Interest** (`INCOME` in). No new table, no snapshot mechanism, no second
  accounting engine — everything derives from `transaction_headers` (via
  the same `listByAccountId` Account Detail already uses) plus
  `accounts.current_balance`. `ADJUSTMENT` transactions never contribute to
  Capital Invested or Dividends — not via a special-case exclusion, but
  because the service only ever sums `TRANSFER` and `INCOME` rows.
  **Capital Invested is `null`, never `0`, when an account has zero
  `TRANSFER` history** — a real calculated zero (in exactly offsets out) is
  a distinct, valid value from "nothing to derive this from," and every
  real Investment account in this app today falls into the latter case
  (balances were seeded directly, never captured as transfers), so this
  isn't a rare edge case. Portfolio Gain/Loss inherits `null` whenever
  either Capital Invested or Current Market Value is `null` — same
  null-propagation philosophy in both cases: never substitute zero, never
  estimate. `getInvestmentPortfolioSummary`'s `total` follows the identical
  rule at the aggregate level (via the shared `sumOrNull` helper) — a
  metric with zero contributing accounts stays `null` rather than
  collapsing to a misleading `0`; accounts missing Capital Invested are
  excluded from that total and listed in `accountsWithoutCapitalHistory`,
  the same convention `unconvertedCurrencies` already established for a
  missing exchange rate. Dividends/Interest is NOT part of this — a real 0
  there never implies anything false, so it's always a plain number. The
  service returns `null` as-is; converting it to placeholder text is a UI
  decision, out of scope here.
  Terminology is deliberately conservative: **Capital Invested** and
  **Portfolio Gain/Loss**, not "Cost Basis" or "Unrealized Gain/Loss" —
  this account-level design has no per-holding purchase-lot data, so it
  must not imply FIFO/average-cost/tax-accounting precision it can't
  actually provide. A "Capital Withdrawn Above Contributions" metric was
  considered and deliberately rejected — Activity already shows every
  withdrawal directly, and a same-precision-problem summary metric wasn't
  worth a fifth card. Per-holding (per-symbol/ticker) cost basis is
  explicitly out of scope for Version 1; revisit only as a fresh, scoped
  decision, matching how Version 1 itself was scoped.

  **UI (Investment Portfolio Version 1 UI milestone):** a new top-level
  page, `/invest` ("Investment Portfolio"), reachable from Settings —
  analytical only, no create/edit/archive/delete of its own; all account
  management stays exclusively under Settings → Accounts. The page shows a
  Portfolio Summary (four KPI cards, `summary.total` from
  `getInvestmentPortfolioSummary`) above a compact Investment Accounts
  list (Account Name, Currency, Current Market Value, Portfolio Gain/Loss
  only — deliberately not Capital Invested, Dividends, or any field the
  schema doesn't have, like a broker/institution name; see §4's
  twice-settled decision against adding one). Selecting an account
  navigates to the existing `/accounts/[id]` page — no second detail page
  was created. `AccountDetailView` itself was extended: when
  `account_type === "Investment"`, a new "Investment portfolio" section
  (the same four metrics, same `InvestmentKpiGrid` component the Portfolio
  page uses — one shared component, not duplicated markup) renders above
  the existing period-scoped Income/Expenses summary. The two sections are
  deliberately not connected — Investment metrics are lifetime figures,
  the Income/Expenses section stays wired to the existing `PeriodSelector`
  exactly as before. Opening Balance (in "Account details") and Capital
  Invested (in "Investment portfolio") are different facts and are
  displayed independently, never reconciled — a real, expected
  discrepancy for an account whose balance was seeded before its transfer
  history existed. Every null value renders as `—` with a short muted
  explanation ("No transfer history recorded." / "Requires Capital
  Invested history.") — the same empty-state convention Dashboard's Budget
  ring already established (`{pct ?? "—"}%`), not a new one.

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
- **Data Management / admin tooling.** Placeholder area for future
  data-maintenance workflows (bulk edit, export/import); not designed yet.
- **Payment Method field.** Removed from the Review UI (Account already
  represents the payment source); no replacement is planned unless a
  concrete, distinct need is identified.
- **Account balance posting** (needed for a cross-currency TRANSFER's
  destination account to eventually show a real balance — reviewed,
  confirmed feasible, not implemented, Transaction UX Final Polish milestone).
  A transaction header stores exactly one amount/currency pair plus the
  `exchange_rate` used to derive `sgd_total_amount` at save time — there is
  no separate "destination-currency amount" field, and `source_account_id`/
  `target_account_id` are already allowed to be different-currency accounts
  today (e.g. POSB Bank (SGD) → Cash - INR). Posting to the destination
  account in its own currency, when that's eventually built, should derive
  the destination-currency amount from the already-stored `sgd_total_amount`
  via a second exchange-rate lookup (base currency → destination currency,
  the reverse direction of `exchange.service.ts`'s existing
  `convertToBaseCurrency`) — no schema change needed, the data already on
  the header is sufficient.

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

---

## 13. Release Checklist

**Whenever a new table introduces a foreign key to an existing business
entity, verify every delete workflow for that entity before release** — not
just the new table's own. Every foreign key in this schema is a plain
Postgres `NO ACTION` reference (no `ON DELETE CASCADE`/`SET NULL` anywhere)
— deleting a still-referenced row always raises a raw `23503` error unless
the application layer checks for it first. This is how the Project delete
bug happened: Recurring Transactions added `recurring_rules.project_id`
in one milestone, and the Project delete guard (built in a separate,
later milestone) was never revisited to check it.

Concretely: when a new table adds a foreign key to `accounts`, `projects`,
or any other entity with its own delete/archive workflow, re-check that
entity's delete guard (e.g. `account-management.service.ts`'s
`deleteAccount`, `project-management.service.ts`'s `deleteProject`) covers
the new table the same way it covers existing ones — an existence-only
repository check (`existsForXId` / `existsActiveForXId`) plus a typed
error with a friendly message, never a raw Postgres error reaching the UI.

**Known follow-up, deliberately not fixed:** `existsActiveForAccountId`
and `existsActiveForProjectId` (`recurring-rule.repository.ts`) only check
`is_active = true` rules — but the FK itself blocks deletion regardless of
`is_active`, so an *inactive* rule still referencing an account or project
will still raise a raw FK error on delete. Narrow edge case (deactivate a
rule without deleting it, then delete the account/project); revisit in a
future release, not urgent enough to fix now.
