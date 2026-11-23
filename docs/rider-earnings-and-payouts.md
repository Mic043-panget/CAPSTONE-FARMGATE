# Rider earnings and manual payouts

## Earnings and eligibility

Rider earnings are separate from buyer/seller payments and COD remittances. A completed delivery earns compensation only when the required pickup and delivery QR checks, proof, recipient confirmation, and verified rider profile are present. Open or under-review order complaints require admin review. Earnings use the saved rider base and per-kilometer compensation rates, with optional minimum and maximum amounts; the calculation inputs and amount are snapshotted and are not recalculated after rates change.

Admins configure rider compensation in Admin settings under the Rider category. A zero maximum means no maximum. A positive earning becomes available for an individual payout after eligibility review; zero-value and ineligible records are not payable.

## Manual payouts

Farmgate does not initiate rider transfers. Admins configure and verify supported payout methods, verify rider-submitted destinations, and create one payout per eligible delivery. An authorized admin records that an external transfer is in progress. A different admin must confirm the completed transfer with its exact amount, reference, date, and private receipt. Failed payouts retain their history and release the earning for a retry.

Riders can view their earnings and payout history through `/api/rider/earnings`. Account details are encrypted at rest and only masked values are returned by payout APIs.

## Existing records and migration

The forward-only migration `2026_11_22_000001_upgrade_rider_payout_workflow_tables.php` extends the existing earning, payout, and destination-history tables rather than recreating them. It backfills workflow references, status snapshots, legacy payout links, and pivot history while retaining the original earning and payout records. Legacy percentage/cap settings remain stored for historical reference but no longer configure future earnings.

The migration refuses rollback once earning or payout records exist. Back up the database and validate the migration against a restored staging copy before production deployment.

See [the backend payout operations guide](../backend/laravel/docs/rider-payouts.md) for operational controls and production setup requirements.
