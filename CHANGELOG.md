# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-05-21

### Added
- Bulk AWS vault key rotation (Rotate tab in the popup).
  - On `/vault/manage`: rotates AWS vault keys across every AWS tenant in the organisation.
  - On `/vault/tenant/<id>`: rotates AWS vault keys within that single tenant only.
  - Preview with affected tenant/vault counts and up to three example vault names before any rotation is run.
  - Type-to-confirm `ROTATE` gate before destructive action.
  - Progress bar showing rotation progress (limited concurrency: 5 in flight).
  - CSV output `veeam_data_cloud_key_rotation_<date>.csv` (or per-tenant variant) with `AccessKey`, `SecretKey`, `Status`, and `Error` columns for every attempted vault.
  - Defensive `provider !== 'AWS'` anomaly detection captured in the CSV's `Error` column.
- Vitest test suite covering the new pure logic in `lib/rotation.js` and `lib/csv-utils.js`. Run with `npm test`.

### Fixed
- Corrected API response field names (`storageUsageStatistics`, `valueInTebiBytes`) that were causing vault details to show N/A and usage values to show 0 in all exports. This also unblocks vault enumeration for the new Rotate feature.

### Changed
- Popup layout now uses tabs (`Export`, `Rotate`); export behaviour is unchanged.
- `popup.js` loads as an ES module. Shared `escapeCSV` helper extracted to `lib/csv-utils.js`.
- `fetchAllTenantStats` extracted into a helper used by both Export and Rotate.

## [1.2.0] - 2025-11-26

### Changed
- Improved "Filter by date" UX: Now defaults to a 6-month range (6 months ago to today) instead of just the current month when enabled. This provides immediate historical context without requiring manual adjustment.

## [1.1.1] - 2025-11-03

### Fixed
- Fixed summary mode detection on production environment after Veeam updated `cloud.veeam.com` URL structure to match staging
- Unified URL detection logic - both production and staging now use `/vault/manage` endpoint
- Extension now correctly detects tenants management page on production

### Changed
- Simplified URL pattern matching by removing environment-specific checks (production and staging now use identical URL patterns)

## [1.1.0] - 2025-10-09

### Added
- Multiple icon sizes for better display across different contexts:
  - 16x16 icon for favicon and context menu
  - 32x32 icon for Windows compatibility
  - 48x48 icon for extension management page
  - 128x128 icon for installation and Chrome Web Store
- Tooltip text for extension toolbar icon

### Changed
- Updated manifest.json to use multiple icon sizes for action icon
- Improved icon quality across different display densities

## [1.0.0] - Initial Release

### Added
- Initial release of Veeam Data Cloud Vault Exporter
- CSV export functionality for Veeam Data Cloud Vault data
- Support for cloud.veeam.com
- Extension popup interface
