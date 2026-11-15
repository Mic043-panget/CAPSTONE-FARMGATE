# Rider earnings and manual payouts

## Configuration and eligibility

Admin → Payments → Rider Earnings stores one explicit earnings configuration. It has no seeded percentage or cap. An authorized administrator must save a percentage from 0% through 100%, choose `No cap`, `Cap per delivery`, or `Cap per payout`, and provide an audit reason. A cap requires a positive PHP amount; zero is invalid. The legacy `rider_maximum_compensation` system setting is not used by this workflow.

Each successful buyer-location QR verification for a standard delivery creates an immutable earning snapshot only when the percentage and cap choice are configured. The amount is the configured percentage of that order's saved `delivery_fee`, rounded to two decimal places using half-up rounding. Free delivery produces PHP 0.00. COD cash, seller fees, and delivery charges are not deducted. Waiting and cancelled deliveries do not earn. A zero-value earning is retained without creating a payout record.

The configured cap is snapshotted with each earning. Payouts are per delivery, so a per-payout cap applies to that single-delivery payout. Later setting changes do not alter existing earnings or pending payout amounts. Deliveries completed before configuration are not backfilled.

## Manual payout recording

A positive earning creates a pending payout record; it does not initiate a transfer. An administrator may record the payout only after confirming that the external transfer was completed, with the exact amount, method, reference, date, and an audit reason. The action changes the record to paid and stores an audit-history entry. Farmgate has no rider transfer integration.

Riders can view their own earnings and payout status through `/api/rider/earnings`. Administrators can review settings history and pending/recorded payouts through the Payments screen.

## Migration and production release

The migration `2026_11_15_170000_create_rider_earnings_and_payout_tables.php` creates empty configuration, configuration-history, earnings, payout, and payout-history tables. It does not seed a percentage or cap. Its `down()` method drops all five tables and must not be used after earning or payout data has been recorded.

Before production use:

1. Review the migration and code changes, and take a verified database backup with a tested restore procedure.
2. Deploy to isolated staging and inspect the planned SQL with `php artisan migrate --pretend`. Do not point staging at the production database.
3. Run the migration in staging, then verify the setting is `Not configured`, riders cannot receive earnings or create payouts, and existing COD/seller payout behavior is unchanged.
4. Configure and audit the percentage and cap choice in Admin → Payments. Test a successful buyer-location QR delivery, half-up rounding, free delivery, each cap mode, and a cancelled delivery. Verify payout confirmation records only a previously completed external transfer.
5. After explicit production approval and a maintenance window, deploy the reviewed commit and apply `php artisan migrate --force` from `backend/laravel`. Confirm migration status, configuration state, audit history, and rider/admin payout views. No transfer is initiated by deployment or migration.

No production migration or transfer has been run as part of this change.
