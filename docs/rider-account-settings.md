# Rider account settings

The rider workspace Settings page reuses the authenticated account endpoints for profile details, password, phone verification, profile photo, and notification preferences. Profile/password/photo and settings operations use the current Sanctum session; no account or rider ID is accepted from the browser.

Rider-specific settings are available through `GET/PUT /api/riders/settings`. Only the signed-in rider's profile is read or changed. Vehicle type is a free-text preference up to 100 characters. Availability is restricted to `AVAILABLE` and `OFFLINE`: a rider must be verified to become available, and cannot go offline while an active delivery is assigned. Accepting new offers also rechecks the verified/available profile under lock. A location refresh does not switch a rider's availability.

Rider contact phone numbers use the existing OTP verification flow and Philippine-number validation. Updating the number clears its verified state until the code is confirmed. Email changes trigger the existing email-verification flow. Profile photos accept JPG/PNG up to 1 MB and are stored on Laravel's public profile-photo disk.

The Location Permissions section checks browser geolocation support/permission and can request current-device location. It does not save or share coordinates from this settings page. Sharing remains an explicit per-delivery action and can be stopped by the rider; permission may also be revoked through browser/device settings.
