# Rider earnings and payout operations

## Separation and eligibility

Rider earnings and rider payouts are independent from seller payouts, buyer payments, delivery status history, and COD collections/remittances. A rider's collected COD cash is never a rider earning. Buyer/seller payment state is deliberately not part of rider earnings eligibility.

Farmgate creates one immutable-calculation earnings row when a delivery reaches `DELIVERED`. It requires pickup and delivery QR verification timestamps, saved proof, recipient confirmation/name, and a verified rider profile. It does not depend on order or buyer/seller payment status. If the order has an open or under-review complaint, the earning changes to `NEEDS_REVIEW` and cannot enter a payout until administrator review. Missing verification evidence remains `PENDING_ELIGIBILITY`; cancellation does not create payable earnings. Online order completion and payment reconciliation remain separate from delivery completion and rider earnings.

The gross delivery fee displayed is the buyer delivery fee snapshotted on the order. Rider gross earnings use the configured rider compensation rates at completion: base compensation plus per-kilometer compensation multiplied by the saved route distance, rounded to cents, then clamped by a nonzero configured minimum and maximum. Current system setting keys are `rider_base_compensation`, `rider_per_km_compensation`, `rider_minimum_compensation`, and `rider_maximum_compensation`. Deductions default to zero; administrator adjustments require a reason and are append-only in earning history. The calculation inputs and amounts are stored once; later rate changes do not recalculate existing earnings.

There is no payout schedule or combined batch. Administrators can create one payout for each eligible delivery as soon as its earning is ready and the rider has an admin-verified destination. Each payout is limited to that delivery's net earning, uses an idempotency key, and locks the earning against duplicate payouts. If a transfer fails, that earning becomes available for a new payout while the failed payout retains its delivery link and history.

## Destination privacy and approval

Only BANK and GCASH are currently recognized destination types. An admin configures a type and a different admin must verify it before riders can select it. A rider submits a destination after password confirmation; the encrypted destination stays pending until an administrator decision. Updates clear its verification. In-flight payouts block destination changes. API lists return only masked details; the database stores account-holder, bank, and account identifiers using Laravel encryption casts. Destinations and method changes have append-only histories.

Administrators must verify submitted destinations using the established out-of-band verification process. The Farmgate API and UI never return the full account holder, bank name, account number, or wallet number. Do not copy private details into reasons, notifications, exports, or logs.

## Manual external transfer and provider readiness

There is no verified rider disbursement provider configured in this repository. Provider payouts and provider callbacks are therefore unavailable; no method is shown as active and no transfer is simulated. The supported operation is manual external transfer only:

1. An admin creates an individual delivery payout, which remains `PENDING`.
2. An authorized admin records that an external transfer is in progress; Farmgate does not initiate the transfer.
3. A different admin independently confirms the completed transfer using its exact amount, reference, date, and a private receipt. Only then does Farmgate mark the payout `PAID`.
4. Transfer references are encrypted at rest and indexed by a keyed hash for duplicate detection. Private receipts are stored on the private proof disk and served only to the rider who owns the payout and authorized admins.

The manual transfer confirmation, individual payout creation, status changes, earnings calculation, destination verification, and adjustments each have append-only histories. In-app notification dispatch and configured Farmgate email delivery use the existing notification outbox. Notification content contains payout references and status only, never destination or receipt details.

## Required production setup and decisions

- Configure and verify rider compensation settings before deliveries are completed; historical snapshots are not repriced.
- Confirm the compensation formula with the operating policy owner before production use.
- Configure and verify permitted bank/GCash payout methods with separate authorized administrators.
- Ensure administrators have a safe external process to verify destinations and independently confirm transfer completion. Farmgate does not reveal full payout account numbers in the admin browser.
- Do not enable provider disbursements until the actual provider account explicitly supports rider payouts and its integration, signed success/failure callbacks, idempotency, and reconciliation are implemented and verified.
- Run all payout validation with test fixtures or provider sandbox responses only. This feature does not initiate real transfers.
