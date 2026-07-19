# Changelog

All notable changes to FinanceOS are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Nothing yet.

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
