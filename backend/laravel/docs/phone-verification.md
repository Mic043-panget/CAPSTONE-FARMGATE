# Phone number verification

FARMGATE verifies Philippine mobile numbers using UniSMS. Seller registration requires the seller to verify their mobile number before an account can be created. The seller requests a one-time code, confirms it, and completes registration with the short-lived verification token. Successful registration signs the seller in and opens the seller workspace. Buyer registration is unchanged and requests phone verification after account creation. Buyers can add or change a number under **Profile → Account Settings → Phone verification**; sellers can use **Account security** in the seller workspace.

## API

- `POST /api/profile/phone/send` (authenticated): accepts `phone_number` in `09XXXXXXXXX` or `+639XXXXXXXXX` format (spaces, parentheses, periods, and hyphens are allowed).
- `POST /api/profile/phone/verify` (authenticated): accepts a six-digit `code`.
- `POST /api/auth/seller-registration/phone/send` (guest): accepts the seller's `phone_number`.
- `POST /api/auth/seller-registration/phone/verify` (guest): accepts `phone_number` and a six-digit `code`; returns a short-lived `phone_verification_token` only after successful verification.
- `POST /api/auth/register` requires `phone_verification_token` when `role` is `SELLER`. The backend consumes the token atomically with account creation, so a client cannot create a seller account by skipping SMS verification or reusing the token.
- All endpoints use the existing session/CSRF protection. Authenticated profile verification is limited to 5 sends and 10 verification requests per minute; seller registration verification uses the same per-minute limits. A persisted 60-second resend cooldown and a maximum of 5 sends per hour apply per account for profile verification and per phone number for seller registration. Verification allows at most 10 incorrect attempts per hour per account or phone number, respectively.

Codes are generated with a cryptographically secure random generator, stored only as an HMAC-SHA-256 digest keyed by the application key, expire after 10 minutes, and are invalidated after successful verification. The seller-registration token is also stored only as an HMAC digest and expires after 15 minutes. A successful account registration stores the verified phone timestamp as `users.phone_verified_at`. Codes are never returned by the API or logged. Verification does not currently gate marketplace actions; no such policy existed before this workflow.

## Configuration and operations

Set `UNISMS_API_KEY` to the UniSMS secret key and `UNISMS_SENDER_ID` to a sender ID enabled for the account. The official endpoint is `https://unismsapi.com/api/sms`; set `UNISMS_API_URL` only if the provider gives the account a different endpoint. The integration uses HTTP Basic authentication with the secret key as username and an empty password, and sends the `recipient`, `content`, and `sender_id` JSON fields. `UNISMS_SENDER_NAME` remains supported as a legacy fallback for `UNISMS_SENDER_ID`.

Keep secrets out of source control and logs. Apply database migrations before enabling the workflow. The SMS provider must be configured for real deliveries; a `201 Created` response means the provider accepted the message for delivery, not that the handset received it. Use the provider's message status or delivery dashboard to confirm final delivery.

Tests use Laravel's HTTP fake and do not send live SMS.
