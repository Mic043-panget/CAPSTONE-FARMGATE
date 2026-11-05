# Rider workspace and delivery verification

## Rider workspace

Rider accounts use the seller-shell workspace layout with Dashboard, Deliveries, Chats, Reports, and Notifications. Delivery search, status filtering, and pagination are server-side and are scoped to the authenticated rider's assignments. Rider chat, reports, and notifications reuse the existing shared features.

The rider must explicitly start live-location sharing for an active assignment. The browser requests precise geolocation and the rider page posts current coordinates to the authenticated delivery location endpoint. Sharing stops when the rider turns it off or leaves the page. A current location is visible only to the rider assigned to the delivery and the order's buyer and seller. Delivery pages poll tracking status/location every ten seconds.

## QR hand-off checks

The order seller can issue a pickup QR while the delivery is awaiting pickup verification. The order buyer can issue a separate delivery QR after pickup. Each QR contains a cryptographically random, purpose-specific, 30-minute token. Only a SHA-256 digest and expiry are stored; issuing a replacement invalidates the previous code. The values are excluded from serialized delivery models and audit metadata. The rider's camera scanner uses the browser `BarcodeDetector` API when supported; manual QR-value entry remains available as a fallback.

Pickup verification requires the authenticated assigned rider, the expected current delivery and order state, an unexpired pickup token, and fresh rider coordinates within 250 metres of the saved pickup pin. Pickup pins remain required.

Drop-off verification requires the assigned rider, the expected current order and delivery state, an unexpired one-time delivery QR, a recipient-received confirmation and name, and a valid photo upload. The photo is stored on the non-public `delivery_proofs` disk; its private path, SHA-256 digest, MIME type, recipient confirmation/name, client-reported photo capture time, server receipt time, and server delivery verification time are linked to the delivery/order and assigned rider. The request stores proof and consumes the QR/status transition atomically at the database layer; if storage or database verification fails, the request fails and a newly uploaded file is removed. Replays and out-of-order scans are rejected under the existing delivery/order locks.

Drop-off GPS is optional. If the rider shares coordinates, the server still checks that they are within 250 metres of the saved buyer pin; if permission is denied or no destination pin exists, proof can still be recorded without location. Pickup GPS remains required. Browser capture time and coordinates are client/device supplied and do not independently attest the physical device or photo capture time.

Only the order buyer, seller, assigned rider, or an admin can retrieve the photo through the authenticated proof endpoint. Admins may correct the recipient name and/or replace the photo after a completed delivery by providing a reason. Corrections append a protected correction record and a global API audit entry; they do not alter delivery state, rider, or verified delivery time. Superseded proof files remain in private storage for the correction record.

Buyer, seller, assigned-rider, and admin operational views show proof state and permitted proof metadata. Private photo access remains separately authorized. In-app proof notifications are sent to the buyer, seller, and assigned rider, subject to existing account preferences and notification settings.

Live delivery-location posts include the browser geolocation capture timestamp. The server stores it separately from request receipt time and rejects duplicate or older captured timestamps under the delivery lock. The timestamp is client/device supplied and prevents stale request reordering; it does not prove that the reported GPS coordinates are authentic.

Apply the added schema with `php artisan migrate --force` from `backend/laravel` during deployment. The default private disk writes to `storage/app/private/delivery-proofs`; ensure that directory is persistent, writable by the app process, and not exposed by the web server or a public storage symlink. For multiple app instances, configure `DELIVERY_PROOFS_DRIVER=s3` with the existing private AWS bucket credentials and bucket-level public access blocked. Set PHP/web-server request limits above the 10 MB per-photo validation cap (including multipart overhead). Camera access generally requires HTTPS or localhost. The rider can manually enter a QR if camera scanning is unavailable and choose an existing image if direct camera access is denied. A failed photo upload can be retried; delivery will not be marked delivered until the server confirms the photo was stored.
