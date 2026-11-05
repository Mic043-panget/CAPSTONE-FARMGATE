# Livestock listing AI moderation

## Configuration

The backend reads the API key only from `GEMINI_API_KEY` through Laravel's server-side `services.gemini` configuration. Never put the key in React/Vite variables, source control, logs, or frontend responses. Obtain a key from [Google AI Studio](https://aistudio.google.com/app/apikey), then set it only in the deployment's protected environment or local, untracked `backend/laravel/.env` file.

Configure:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_TIMEOUT=20
GEMINI_MODERATION_CONFIDENCE_THRESHOLD=0.90
QUEUE_CONNECTION=database
```

Do not add a real key to `.env.example`. Install the database changes with `php artisan migrate` from `backend/laravel`. Run a queue worker in each environment where submissions should be moderated asynchronously: `php artisan queue:work database`. Moderation is explicitly sent to the existing database queue so a `sync` default cannot trigger a provider request during the seller's submission.

## Workflow and safeguards

When the existing `seller_listing_approval_required` setting is on, seller submission first moves the listing to `PENDING_REVIEW` and dispatches moderation after commit. AI can move it to `ACTIVE` only when the listing passes deterministic checks, Gemini returns the exact expected structured fields, recommends `APPROVE`, confirms the selected active Farmgate category is supported, has no flags, meets the confidence threshold, and the seller has active-listing capacity. A high-confidence `REJECT` recommendation meeting the same configured confidence threshold automatically moves the listing to `REJECTED`. The model's reasons and flags are saved and sent to the seller in an in-app notification for automatic approvals, automatic rejections, and cases that remain pending; if the model supplies neither, a clear fallback reason is shown. Low-confidence rejection suggestions and `REVIEW` results remain pending for administrator review. Active Farmgate categories are assessed individually; inactive categories, uncertainty, missing configuration, invalid responses, and provider/quota errors remain pending. A final administrator approval, rejection, or disable action also sends the seller an in-app update; an optional reason is included.

The default model is Google's documented `gemini-2.5-flash-lite` multimodal model; free-tier quotas depend on the account and can change. Each queued job gets at most two provider attempts. Failed listings remain pending and admins may request a rate-limited retry. Each execution is recorded in `listing_moderation_attempts`; only brief decision metadata and sanitized reasons are stored, never the API key or raw provider body. Before applying an outcome, the job locks and rechecks the listing state. A status decision made by an administrator while the request is in flight wins. Admins can review pending listings with the existing Approve/Reject controls, record an optional reason, see the latest decision details, and filter by moderation outcome, including auto-approved and auto-rejected listings.

Gemini receives the listing category, name, breed, description, quantity, pricing unit, and price, plus uploaded listing photos when they are available as local listing-image files. It does not receive seller identity/contact data, pickup location, health/vaccination details, or arbitrary remote image URLs. If a saved image cannot be safely read for analysis, moderation fails closed and the listing remains pending. This automated check is conservative assistance, not a guarantee of correctness or compliance.

## Listing photos

The seller listing form accepts up to five JPG, PNG, or WebP photos, each at most 5 MB. The API independently validates file type and size and stores uploads on Laravel's public disk under `listing-images`; set up the normal public storage link (`php artisan storage:link`) where the local filesystem disk is used. Existing HTTP(S) image URL submissions remain supported up to the same five-photo total.
