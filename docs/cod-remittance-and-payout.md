# COD collection, remittance, reconciliation, and seller payouts

## Separate transaction states

Delivery completion, buyer payment, cash remittance, remittance reconciliation, and seller payout are separate records and states.

1. A verified rider completes delivery using the existing proof and drop-off QR workflow.
2. The assigned, approved rider records the amount actually received and uploads a handover-record image. The private evidence is available only to that rider and admins. This creates a collection claim; it does **not** mark the order paid.
3. The rider submits unremitted claims as a remittance batch. The batch amount is the sum of rider-reported amounts.
4. An administrator records the amount received. A difference requires a reason and leaves the batch disputed. When a batch amount matches, only collections matching their order total become reconciled and mark the order payment `PAID`. An underpaid or overpaid collection remains `NEEDS_REVIEW` and the order remains unpaid.
5. Only after an order is `COMPLETED`, payment is `PAID`, and its COD collection is reconciled can an administrator record a seller payout.

The collection action takes no rider, seller, or buyer identifier from the client. The server derives the rider from the authenticated account and the expected amount from the locked order. Orders and deliveries are locked during critical updates; uniqueness constraints prevent duplicate collections and payouts. Private COD evidence is stored on the protected delivery-proof disk and served through an authorized, no-store endpoint.

## Payout configuration and manual operation

`manual_seller_payouts_enabled` is a database-backed admin setting and defaults to **false**. Enable it from Admin → Transactions → Cash reconciliation & seller payouts → Finance settings only after the organization has:

- approved a written payout and seller-fee policy;
- verified the individual seller's payout destination through its approved external process; and
- entered a reason that identifies the approved policy and verification reference.

Farmgate does not store payout account numbers or verify external account ownership. The admin must execute the transfer outside Farmgate, then record the actual amount, method, transfer reference, and reason. The server records an immutable payout, capped at the locked merchandise subtotal, and notifies the seller after commit. This cap is a safety bound, **not** a payout formula. Administrators must calculate the amount using the approved policy.

Disable the setting to block new payout records. Existing collection, remittance, and reconciliation history remains available.

## Seller payout policy publication

An authorized admin creates a versioned draft in Admin → Payments → Settings and publishes it only after completing and confirming each required section: eligibility, calculation, timing, destination requirements, applicable fees, failed or returned payouts, and dispute/correction handling. The policy text itself is the authoritative policy; a separate supporting-document upload is optional. Publishing records the authenticated admin, publication time, effective date, and reason; sellers can review and acknowledge the effective version before configuring a destination.

The application currently computes the seller payout from the order merchandise subtotal less the per-order `seller_fee` snapshot. Checkout calculates that fee using the configured `seller_fee_rate`. This is implementation behavior, not a substitute for Farmgate’s approved policy. The existing operational documentation does not define payout timing, failed/returned payout terms, or the complete dispute/correction process. An admin must supply Farmgate-approved wording for those areas and confirm all policy sections before publication; the editor intentionally does not prefill policy terms.

## Scope and release limitations

- The rider collection/remittance flow covers standard deliveries assigned to an approved Farmgate rider.
- COD for self-pickup and seller-delivered orders does not use this rider remittance ledger.
- PayMongo checkout is not a payout or settlement provider. Online-payment seller payouts and provider settlement reconciliation are not implemented here.
- Farmgate does not initiate cash, bank, or GCash transfers and does not automate payout amounts.
- The reconciliation record captures the administrator's count and explanation; it is not proof of a bank deposit or an independent cash count.
- A collection amount that differs from its order total is retained as `NEEDS_REVIEW`. There is not yet an admin action to resolve that per-order difference; it must not be treated as paid.
- Rider-uploaded proof is evidence, not confirmation that funds arrived. Farmgate still needs an approved operational process and controls for independently verifying cash handover or incoming transfers before reconciliation.
- Existing COD collections created before the amount/evidence migration may have no proof. Historical payment states need an operational review; this workflow does not assume or silently rewrite them.
- Existing application session/CSRF protections apply to these authenticated APIs. Deploy the application over HTTPS and protect database backups and `APP_KEY`; free-text reconciliation notes and payout references use Laravel encrypted casts.

Apply the new migration before using these routes. The payout setting must remain disabled until policy approval and the external seller-destination verification process are complete.
