# Changelog

All notable changes to FinanceOS are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.6.0] - 2026-08-01 - Attachment Management MVP

Receipt files can now be protected from cleanup, and old ones can be
removed on your own schedule — without ever touching the underlying
transaction or its financial data.

### Added
- **Keep Attachment** — mark an important receipt as protected from cleanup,
  right from the Receipt Viewer; the toggle shows a clear on/off state and
  confirms with a toast
- **Manual Attachment Cleanup** (Settings → Data Management) — remove old
  receipt images on a retention schedule you choose (30 days / 90 days /
  180 days / Never); every attachment marked Keep Attachment is skipped,
  and no financial data is ever touched — only the original file
- Deleting a transaction now also removes its receipt file from storage —
  no orphaned files left behind

### Changed
- The Receipt Viewer now shows the same, meaningful empty state at every
  entry point when a transaction has no receipt attached, instead of an
  inconsistent blank screen

### Migration Required
- `docs/database/migrations/020_receipt_attachment_keep_flag.sql`
- `docs/database/migrations/021_receipt_attachment_update_policy.sql`
- `docs/database/migrations/022_reload_schema_cache_keep_attachment.sql`

## [1.2.1] - 2026-07-21 - Capture Reliability & Navigation Polish

Hardens the capture workflow end-to-end (the Capture screen now owns its
whole lifecycle and always lands you on the exact transaction it just
saved) and trims mobile navigation down to the essentials.

### Added
- `.env.example` documenting the required environment variables (no secrets)
- Settings → Appearance: System / Dark / Light theme, defaults to Dark
- Header overflow menu (Edit / View Receipt / Delete) and a full-screen Receipt Viewer
- Receipt Date and Captured date/time shown together in Activity's expanded
  transaction and on Dashboard's Recent Transactions card
- Client-side photo compression before upload, fixing mobile capture failures caused
  by Vercel's request body limit

### Changed
- The Capture screen now stays open through upload → AI processing → save, then
  auto-closes and navigates to Activity itself, expanding and highlighting the exact
  new transaction — no more silently finishing in the background
- Post-capture navigation (and the global Capture Inbox indicator) now uses the exact
  saved transaction id instead of guessing via "latest transaction"
- Activity sorts, groups, and filters by Receipt Date; Dashboard's Recent Transactions
  sorts by Ingestion Date and shows both dates
- AI Context now consolidates multi-sentence context into one coherent transaction
  instead of risking a fragmented merchant name or one item per sentence
- Auto-save: a successful AI result saves immediately with no mandatory Review step
  (Review Screen retained only as Activity's Edit screen)
- Activity line item metadata now shows `Qty | Category` (pipe separator, spaces on
  both sides), replacing the previous `Qty Category` layout, and a bare quantity with
  no unit now displays FinanceOS's standard default, `PC` (e.g. `1 PC`) — weight/volume
  units that were actually extracted (`0.26 kg`, `1 L`, `500 ml`, etc.) are unaffected
- Bottom navigation trimmed to five frequent modules (Dashboard, Activity, Accounts,
  Budget, Settings); Projects, Investments, and all other administration pages moved
  into the Settings hub — every page keeps its existing URL

### Fixed
- Capture screen no longer gets stuck open after a successful save
- Manually deleting an already-saved-but-not-yet-consumed capture from the Capture
  Inbox no longer deletes the Storage files backing its transaction's receipt

### Removed
- Dead Review-from-Inbox flow and its API route (superseded by auto-save)

## [1.2.0] - 2026-07-19 - AI Capture Workflow

FinanceOS now supports a complete AI-powered receipt capture workflow from
Capture through Review and Save.

### Added
- Capture Inbox
- Background AI Processing
- Capture Progress
- Retry Processing
- Review Screen
- Activity Edit
- Activity Delete
- Receipt Storage
- UUID Storage Paths
- Account Mapping Rules
- Settings → AI → Capture Inbox

### Changed
- Single Gemini multimodal pipeline
- Unified Review Screen
- Repository architecture
- Service architecture
- Database security standardized
- RLS standardized

### Fixed
- Capture UX
- Review refinements
- Storage architecture
- Migration drift
- Database security cleanup

### Removed
- Legacy allow_all policies
- app_settings
- Old Vision pipeline

### Database
- Receipt Storage finalized
- account_mapping_rules introduced
- RLS enabled
- Granular CRUD policies standardized

### Known Future Enhancements
- Transfer / Withdrawal direct save
- View Receipt
- Real-world UX refinements
