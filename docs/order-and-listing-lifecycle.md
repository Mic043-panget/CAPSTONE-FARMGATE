# Order processing and livestock listing review

This document records the lifecycle implemented by the Laravel API and React client. It is an implementation map, not a policy specification. Money, delivery, order, and listing statuses remain separate.

## Order and payment lifecycle

### Checkout

1. A buyer uses `POST /api/checkout` (or `POST /api/checkout/quote` for a non-binding quote). The API derives the buyer from the authenticated session; the request cannot select a buyer or seller.
2. The API resolves cart items from that buyer's cart, or loads the selected listing. Inside a database transaction it re-queries and locks each listing, checks `ACTIVE` status and current quantity, recalculates the effective unit price and fees server-side, reserves quantity, and creates the order, order-item price/quantity/pricing-type snapshots, initial order-history row, and (for standard delivery) the one-to-one delivery row.
3. New orders start at `PENDING_CONFIRMATION`. COD payment is recorded `UNPAID`. Online checkout creates the order first, then requests a PayMongo checkout session and stores the session ID and `PENDING` payment status. Failed online session creation cancels the still-pending order and restores reserved quantity. The signed PayMongo webhook changes a pending payment to `PAID`, or marks a failed/expired pending payment `FAILED` and cancels/restores stock. Webhook processing is guarded against repeat payment events by checking the current payment state.
4. Cart items are cleared after successful checkout. A multi-seller cart produces one order per seller; the API returns `order` (the first order) and `orders` (all created orders), with a shared PayMongo session for online payment.

Checkout stores price and fee snapshots, so later listing-price changes do not rewrite order history. Per-kilo and per-head lines use the selected quantity and locked unit price. Listing row locks prevent concurrent checkouts from reserving more quantity than is available.

### Order statuses and actors

`OrderStatus` values are `PENDING_CONFIRMATION`, `CONFIRMED`, `PREPARING`, `READY_FOR_PICKUP`, `FULFILLING`, `COMPLETED`, `CANCELLED`, and `REJECTED`.

| Current state | Actor | Allowed next state |
| --- | --- | --- |
| `PENDING_CONFIRMATION` | Seller | `CONFIRMED`, `REJECTED` |
| `PENDING_CONFIRMATION` | Buyer | `CANCELLED` |
| `CONFIRMED` | Seller | `PREPARING`, `CANCELLED` |
| `CONFIRMED` | Buyer | `CANCELLED` |
| `PREPARING` | Seller | `READY_FOR_PICKUP` |
| `PREPARING` | Buyer | `CANCELLED` |
| `READY_FOR_PICKUP` | Seller | `FULFILLING` |
| `READY_FOR_PICKUP` | Buyer | `CANCELLED` |
| `FULFILLING` | Seller | `COMPLETED` |

The order API validates enum values, ownership, the transition table, current state under a row lock, and the online-payment gate. A reason is required when the seller rejects an order. Seller cancellation also follows the existing settings and cancellation-window checks. Cancellation/rejection restores reserved listing quantity and revokes any open rider offers.

For `STANDARD_DELIVERY`, `COMPLETED` is now rejected unless the associated delivery is `DELIVERED`. Delivery completion does not automatically change the order status: the seller must separately complete the `FULFILLING` order. Non-standard delivery modes do not require a delivery verification row.

### Rider assignment and delivery statuses

Rider assignment begins when the seller moves a standard-delivery order to `READY_FOR_PICKUP` (or when a still-unassigned ready/fulfilling order is explicitly retried). Merely confirming or preparing an order does not offer it to riders.

Eligible riders have a verified profile, `AVAILABLE` status, coordinates updated within the existing 30-minute eligibility window, no active delivery, and are within the configured offer radius. Candidate results are ranked by proximity. The first eligible rider receives an eight-hour offer. After the first offer expires or is declined, remaining eligible riders are offered the request without an expiry. Riders who already had an offer for that delivery are excluded from subsequent offers.

`DeliveryStatus` values are `PENDING_ASSIGNMENT`, `WAITING_FOR_RIDER`, `RIDER_OFFERED`, `SEARCHING_FOR_RIDER`, `RIDER_ACCEPTED`, `PICKUP_PENDING`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, and `CANCELLED`.

- No eligible rider, missing pickup pin, or disabled automatic assignment leaves the delivery `WAITING_FOR_RIDER`. The seller receives one in-app waiting notification per delivery; a seller can retry via `POST /api/deliveries/assign` while the order is ready/fulfilling.
- A rider can accept only their own, still-open offer. Acceptance locks order, rider profile, delivery, and offer; it checks rider verification/availability/capacity, offer expiry, order/payment state, and delivery state. It assigns that rider and revokes competing open offers. An identical retry after the same offer has been accepted returns the existing assignment.
- A rider can decline only their own open, non-expired offer. Decline sets the existing offer record to `DECLINED`; repeated declines are idempotent. Assignment immediately advances to other eligible riders. If none are available, the delivery returns to `WAITING_FOR_RIDER`; the scheduled processor also handles waiting and unanswered offers.
- Offer expiry is processed by the scheduled `riders:process-deliveries` command (scheduled every minute). Expired offers are marked `EXPIRED`; the existing initial-offer/broadcast flow then continues. There is no separate manual rider-selection/reassignment API; seller retry re-runs automatic eligibility and ranking.

Rider offers disclose approximate pins and area labels only. Exact buyer address/contact information is returned to the assigned rider's delivery workspace, not to riders viewing unaccepted offers. The order's buyer and seller see their own order; the rider's delivery list and tracking are scoped to that assigned rider.

### QR verification and location

- The order seller issues the pickup code; the buyer issues the drop-off code through `POST /api/orders/{order}/delivery-code`. The order participant is derived from the session. Tokens are random, purpose-specific, hashed at rest, expire after 30 minutes, and are replaced when reissued.
- Only the assigned rider can verify. Pickup requires the ready/fulfilling order and `RIDER_ACCEPTED`/`PICKUP_PENDING`; drop-off requires `FULFILLING` and `PICKED_UP`/`IN_TRANSIT`. The server validates token purpose/digest/expiry, current state, and a saved pin; it rejects scans over 250 metres away. A successful scan consumes the token, saves time and verification coordinates, appends delivery history, and changes only delivery state (`PICKED_UP` or `DELIVERED`). Replays and out-of-order scans fail.
- Rider live location updates require an assigned rider and an active delivery state. The browser sends the geolocation capture timestamp. A persisted capture timestamp lets the server reject duplicate or older updates under the delivery row lock; request receipt time is recorded separately. The rider's current reported location is visible only to the rider assigned to the delivery and the order's buyer and seller.
- Mutation audit metadata excludes exact addresses, contact fields, QR digests, and precise location coordinates/timestamps. Audit request URLs omit query strings; audit records retain the action, entity, and non-sensitive state-change context.
- QR/location confirmation is not proof against a compromised browser or spoofed device GPS. The server validates values, assignment, state, and distance, but cannot independently attest the physical device location.

### Notifications, dashboards, and reports

- The buyer and seller receive order-status notifications when an allowed order transition succeeds, subject to the existing global and account order-notification settings. Sellers are notified of a COD order at checkout; paid online orders notify after webhook payment confirmation. Rider offer, accepted-assignment, no-rider, and QR progress notifications use the existing notification settings/preferences.
- Rider dashboard and offers are rider-role screens; seller order management is seller-role and supports assignment retry and pickup QR display; buyer order details display their delivery QR and tracking. Admin overview screens expose paginated order and delivery records.
- `GET /api/reports/{type}` uses `ReportQueryService` to scope order, listing, delivery, and other report data by authenticated role. Rider delivery reports return area/status/timestamps rather than exact buyer address/contact data. Admin order/delivery overview uses pagination.

## Livestock listing review lifecycle

1. Only a seller can create/edit their own draft or rejected listing. Request validation covers category, quantity, pricing type and corresponding price, text limits, and up to five HTTP(S) image URLs or validated JPG/PNG/WebP uploads (5 MB each). Server-side seller-verification and maximum-active-listing settings are applied.
2. `POST /api/seller/listings/{listing}/submit` accepts draft or rejected listings. With `seller_listing_approval_required` enabled, it transactionally changes the listing to `PENDING_REVIEW` and queues `ModerateListing` on the database queue after commit. With approval disabled, submission changes it to `ACTIVE` after rechecking capacity while holding the seller row lock.
3. The moderation job locks and rechecks the pending listing, persists a numbered attempt, and runs deterministic category/name/price guards before calling the configured provider. The provider response is strictly validated. Provider errors, invalid output, inactive categories, low confidence, flags, and uncertain results remain pending for an administrator. A high-confidence approve that passes category/flag/capacity checks can set `ACTIVE`; a high-confidence reject can set `REJECTED`. Attempts and decisions are audited; raw provider payloads and secrets are not persisted.
4. An admin can filter the queue and review only `PENDING_REVIEW` listings to `ACTIVE`, `REJECTED`, or `DISABLED`. Approval uses a seller lock and enforces the configured active-listing limit. Admin override identity/reason and final listing status are recorded. Admin and AI outcomes notify the seller, including automatic approvals, automatic rejections, and cases that remain pending.
5. Public listing discovery and listing detail require `ACTIVE`; rejected, disabled, draft, pending, and archived listings are not public. Seller listing screens show the seller's own listings; the admin queue includes pending and moderation-result filters. Public discovery is server-filtered and paginated.

The AI result is advisory except for the explicitly configured high-confidence automatic outcomes. Provider configuration/threshold and job-worker requirements are recorded in [listing-ai-moderation.md](listing-ai-moderation.md).

## Schema and implementation references

- Orders, items, history, deliveries, rider offers, and listing moderation attempts are separate tables. Orders use DECIMAL snapshot fields; `order_items` retains unit price, quantity, total, and pricing type. Delivery QR hashes, expiry, verification evidence, status history, and the rider-location capture timestamp are stored separately from order status.
- Main migrations include `2026_08_25_000002_create_orders_tables.php`, `2026_08_25_000003_create_order_status_history_table.php`, `2026_08_25_000005_create_delivery_and_offer_tables.php`, `2026_11_02_000001_add_delivery_verification_evidence.php`, `2026_11_02_000002_add_rider_location_capture_timestamp.php`, and the listing moderation attempt/audit migrations.
- Core behavior lives in `CheckoutController`, `OrderWorkflowService`, `RiderAssignmentService`, `DeliveryVerificationService`, `ListingController`, `Admin\ListingController`, and `ListingModerationService`. Focused behavior is covered by `CheckoutTest`, `RiderAssignmentTest`, `DeliveryTrackingTest`, and `ListingModerationTest`.

## Verified gaps and deferred decisions

- Checkout serializes inventory reservations and preserves snapshots, but the current API has no checkout idempotency key. A buyer who retries a completed POST as a new request can create another order if stock remains. A robust idempotency contract must coordinate multi-seller orders with PayMongo session creation/recovery; it is not inferred here.
- Seller retry is automatic reassignment, not a manual rider override. The system has no reasoned, audited manual rider reassignment workflow.
- Location timestamps prevent duplicate/out-of-order updates relative to a previously saved capture, but do not establish device authenticity or a configurable maximum age.
