# COD remittance and seller payout operations

## Money and state boundaries

- Delivery status, buyer payment status, COD collection/remittance status, and seller payout status are separate records and transitions.
- Rider collection and remittance submissions are reports, not receipt confirmation. Submitted evidence never marks an order paid.
- An administrator reconciles a COD batch only after checking the actual cash handover or incoming transaction. A matched batch can mark an individual order paid only when that collection matches its order total.
- The seller payout amount uses the saved per-order merchandise subtotal minus that order's saved `seller_fee`. Delivery fees are excluded; discounts are not deducted again; this workflow does not support discretionary credits or adjustments.
- A newly created payout remains pending. Farmgate has no outbound PayMongo/bank transfer operation. An administrator other than the administrator who created the payout must attest to and record an already-completed external transfer after independently checking it; that record is not proof that Farmgate initiated or independently settled the transfer.
- Histories and API audit events are retained. External transaction references, receiving-account values, and payout destination values are encrypted at rest; provider credentials are server configuration only. Private evidence is served only to authorized actors with no-store headers.

## COD receiving configuration

An authorized admin configures a Farmgate bank account, uploads an online-banking receive-money QR, or uploads a separate PayMongo receiving QR in Admin → Payments. Online-banking QR images are for inbound funds only; riders enter the exact remittance amount in their banking app. Bank accounts and bank QR codes do not require PayMongo configuration. PayMongo QR methods remain unavailable to riders and cannot be verified until the server-side PayMongo secret key and webhook signing secret are configured and the PayMongo account is marked verified. These credentials are never shown in the browser. A second admin verifies each destination before it becomes available to riders. Riders provide an external transaction reference and proof; an uploaded receipt remains evidence only until an admin confirms actual receipt. QR receiving does not initiate outgoing transfers.

Seller payouts through PayMongo are explicitly disabled because no verified outbound payout integration exists. Do not enable or represent them as available until the provider account capability, integration, webhook/signature verification, idempotency, and reconciliation are implemented and verified.

## Local PayMongo test mode

Farmgate checkout and webhook processing require a server-side `sk_test_` API key. Live API keys are rejected by the application. Keep `PAYMONGO_CONFIGURATION_VERIFIED=false` until the account's test-mode API call and a signed test-mode webhook have been verified. This flag gates PayMongo receiving QR setup; it does not enable seller payouts.

The local checkout session uses PayMongo's v2 Hosted Checkout API. The supported webhook event is `checkout_session.payment.paid`; its signature is checked against the exact raw request body and the test webhook signing secret. Payment status changes only when the signed test-mode event includes a paid payment whose amount matches the saved Farmgate order total. Duplicate paid events are idempotently ignored. Failed checkout API requests release reserved stock. Hosted Checkout's documented webhook flow does not define failed/expired event subscriptions here, so an abandoned checkout remains pending until it is reconciled; do not mark it paid based on the redirect.

For local testing with PayMongo's webhook dashboard, run the Laravel API on port 8000 and start an HTTPS development tunnel such as `ngrok http 8000`. Configure the PayMongo **test-mode** webhook URL as `https://<ngrok-host>/api/payments/paymongo/webhook` and subscribe only to `checkout_session.payment.paid`. Put the webhook signing secret from that test endpoint into the backend `.env` as `PAYMONGO_WEBHOOK_SECRET`. Do not commit the `.env` file or paste keys into source code, frontend variables, logs, or chat. No production domain is needed. The tunnel is only for local development and must not be used to deploy the application.

## Operational rollout

1. Back up the database and verify the backend's existing `APP_KEY` remains available; encrypted fields cannot be read after an unplanned key change.
2. Deploy the application code and run the pending Laravel migrations against the intended database using the normal release procedure. The migration hashes existing encrypted electronic references with the current `APP_KEY` and adds a unique index; verify the existing key is valid before running it. Do not run it against an unverified database.
3. Configure Farmgate's inbound bank details or upload the online banking receive-money QR in Admin → Payments. A different authorized admin must verify the receiving destination before riders can use it. Reconcile transfer evidence manually; QR setup does not initiate transfers.
4. Review the already stored payout policy and its audit history in Admin Payments. Preserve the existing version and effective date of 2026-11-10; do not upload a separate document or create a replacement policy as part of this rollout.
5. Seller payouts remain disabled for automatic/provider transfers. Manual payout recording should only be enabled when existing policy prerequisites are satisfied; record external completion only after a separate check outside Farmgate and confirmation by an admin other than the payout creator.
6. Exercise all flows with the test suite or sandbox/mocks. Do not send customer emails or initiate real transfers for validation.
