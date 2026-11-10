<p align="center"><a href="https://laravel.com" target="_blank"><img src="https://raw.githubusercontent.com/laravel/art/master/logo-lockup/5%20SVG/2%20CMYK/1%20Full%20Color/laravel-logolockup-cmyk-red.svg" width="400" alt="Laravel Logo"></a></p>

<p align="center">
<a href="https://github.com/laravel/framework/actions"><img src="https://github.com/laravel/framework/workflows/tests/badge.svg" alt="Build Status"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/dt/laravel/framework" alt="Total Downloads"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/v/laravel/framework" alt="Latest Stable Version"></a>
<a href="https://packagist.org/packages/laravel/framework"><img src="https://img.shields.io/packagist/l/laravel/framework" alt="License"></a>
</p>

## About Laravel

Laravel is a web application framework with expressive, elegant syntax. We believe development must be an enjoyable and creative experience to be truly fulfilling. Laravel takes the pain out of development by easing common tasks used in many web projects, such as:

- [Simple, fast routing engine](https://laravel.com/docs/routing).
- [Powerful dependency injection container](https://laravel.com/docs/container).
- Multiple back-ends for [session](https://laravel.com/docs/session) and [cache](https://laravel.com/docs/cache) storage.
- Expressive, intuitive [database ORM](https://laravel.com/docs/eloquent).
- Database agnostic [schema migrations](https://laravel.com/docs/migrations).
- [Robust background job processing](https://laravel.com/docs/queues).
- [Real-time event broadcasting](https://laravel.com/docs/broadcasting).

Laravel is accessible, powerful, and provides tools required for large, robust applications.

## Learning Laravel

Laravel has the most extensive and thorough [documentation](https://laravel.com/docs) and video tutorial library of all modern web application frameworks, making it a breeze to get started with the framework.

In addition, [Laracasts](https://laracasts.com) contains thousands of video tutorials on a range of topics including Laravel, modern PHP, unit testing, and JavaScript. Boost your skills by digging into our comprehensive video library.

You can also watch bite-sized lessons with real-world projects on [Laravel Learn](https://laravel.com/learn), where you will be guided through building a Laravel application from scratch while learning PHP fundamentals.

## Google OAuth (Local Development)

Create a Google OAuth 2.0 Web application client and add this authorized redirect URI:

```text
http://127.0.0.1:8000/api/auth/google/callback
```

Set the following values in `.env` using the credentials from Google Cloud Console. Do not commit the client secret.

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/api/auth/google/callback
FRONTEND_URL=http://127.0.0.1:5173
```

If the backend or frontend uses `localhost` instead of `127.0.0.1`, update the redirect URI and `FRONTEND_URL` to match, including the host. Run `php artisan config:clear` after changing `.env`.

## PayMongo payments

In PayMongo, use your test-mode secret key while developing and set it in the Laravel backend's `.env`. Never expose the secret key in the React app or commit it.

```dotenv
PAYMONGO_SECRET_KEY=sk_test_your_secret_key
PAYMONGO_WEBHOOK_SECRET=your_webhook_signing_secret
FRONTEND_URL=http://127.0.0.1:5173
```

Create a webhook in the PayMongo dashboard targeting `https://your-public-backend-host/api/payments/paymongo/webhook`. For local testing, expose the Laravel backend through an HTTPS tunnel and use that tunnel URL. Subscribe to `checkout_session.payment.paid`, `checkout_session.payment.failed`, and `checkout_session.expired`. Copy the webhook's signing secret to `PAYMONGO_WEBHOOK_SECRET`; this is separate from the API secret key. Keep both keys private.

After changing `.env`, run `php artisan config:clear` from `backend/laravel`. Make a test checkout from the React app using GCash or card, complete it with PayMongo's test credentials, and verify the order becomes paid after the webhook arrives. Do not use live keys until test checkout and webhook delivery are confirmed. Online payment is unavailable until `PAYMONGO_SECRET_KEY` is configured.

## Hostinger SMTP email delivery

Email delivery stays in `setup_required` until a valid SMTP transport, credentials,
and sender address are configured. The `.env.example` points to Hostinger's SMTP
host and the SSL port, but leaves mailbox credentials and sender address blank;
do not add live Hostinger credentials to source control or configure a real mail
account for local development. Laravel's mail configuration still defaults to
the `log` mailer when `MAIL_MAILER` is not set.

In Hostinger hPanel, open the relevant mailbox's email-client/connection settings
and use the SMTP hostname, port, encryption mode, username, and password shown
there. The mailbox address is commonly the SMTP username, but use the account's
actual Hostinger-provided values. Put those values only in the Laravel server's
environment:

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=smtps
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_USERNAME=support@farmgates.site
MAIL_PASSWORD=0000@Farmgate
MAIL_FROM_ADDRESS=support@farmgates.site
MAIL_FROM_NAME=Farmgate
```

For SSL/TLS on port 465 use `MAIL_SCHEME=smtps`. For STARTTLS on port 587 use
`MAIL_SCHEME=smtp` with `MAIL_PORT=587`. Confirm the encryption mode and mailbox
settings in Hostinger hPanel before deploying. `MAIL_FROM_ADDRESS` must be a
sender address authorized for the configured mailbox/domain. After changing server environment values, clear
Laravel's cached configuration (`php artisan config:clear`) and restart queue
workers so they reload it.
Apply the application's pending migrations (`php artisan migrate --force`) so
the admin email-test outcome table exists before using the status/test controls.

In the admin workspace, Email delivery reports readiness without revealing
credentials. An administrator may queue a plain test message only to their own
verified account email. Delivery status and retry attempts are recorded without
storing message content or SMTP error text. Run the `notifications` queue worker
in production, for example `php artisan queue:work --queue=notifications,default`.
The admin page's refresh action displays the latest test outcome.

For domain authentication, follow Hostinger's current hPanel instructions for
the sending domain's SPF and DKIM records, then verify the records and domain
status using Hostinger's tools. If DNS is hosted elsewhere, publish exactly the
records Hostinger provides at that DNS provider and allow for DNS propagation.
Do not copy example or guessed SPF/DKIM records: use the values shown for the
actual domain and mailbox in Hostinger.

## UniSMS SMS delivery

Configure `UNISMS_API_KEY` and the account-authorized `UNISMS_SENDER_ID` in the
Laravel backend's `.env`. The official endpoint is
`https://unismsapi.com/api/sms`; the integration uses HTTP Basic authentication
and sends `recipient`, `content`, and `sender_id` JSON fields. Set
`UNISMS_API_URL` only if UniSMS gives your account a different endpoint.
`UNISMS_SENDER_NAME` remains supported as a legacy fallback. Requests require
HTTPS; `UNISMS_TIMEOUT` controls the connection and request timeout (bounded to
1–30 seconds). Run `php artisan config:clear` after changing environment settings.

`App\Services\UniSmsService::send($recipient, $message)` is available to
the phone-number verification workflow. It fails closed when credentials are
absent and raises `UniSmsException` for invalid input or provider failures.
New registrations request a phone OTP, and users can manage verification in
their account settings. Provider acceptance is not treated as proof of handset
delivery. See [phone verification](docs/phone-verification.md) for endpoints,
limits, storage, and operational notes. Automated tests fake the provider and
do not send live SMS.

## Agentic Development

Laravel's predictable structure and conventions make it ideal for AI coding agents like Claude Code, Cursor, and GitHub Copilot. Install [Laravel Boost](https://laravel.com/docs/ai) to supercharge your AI workflow:

```bash
composer require laravel/boost --dev

php artisan boost:install
```

## Local Demo Data

The demo dataset is never called by `DatabaseSeeder` or deployment seeding. In a local or testing environment, load it explicitly:

```bash
php artisan db:seed --class=FarmgateDemoDataSeeder
```

This creates 100 listings across the valid listing statuses, 100 orders across the valid order statuses, 100 buyer interests, 10 demo sellers, and 20 demo buyers. The demo accounts use the password `FarmgateTest123!` and emails `farmgate-demo-seller-01@farmgate.test` through `farmgate-demo-seller-10@farmgate.test` and `farmgate-demo-buyer-01@farmgate.test` through `farmgate-demo-buyer-20@farmgate.test`.

To remove only these demo accounts and their related records before deployment, run this while `APP_ENV=local` or `APP_ENV=testing`:

```bash
php artisan db:seed --class=ResetFarmgateDemoDataSeeder
```

Both seeders refuse to run in other environments. Running the demo seeder again first removes and then recreates its reserved test dataset.

## Seller Promotions

Run `php artisan migrate` when deploying seller promotions. Sellers can prepare date-bounded percentage or fixed-amount discounts for all active listings or selected listings. Drafts do not affect buyer prices; active promotions are checked for conflicting dates, and the server recalculates discounted prices in listing, cart, and checkout responses. Configure Laravel's scheduler as described below so expired promotions are ended and audited.

## Standard Delivery Rider Offers

Standard-delivery orders create a delivery record at checkout. Cash-on-delivery orders are offered to the nearest eligible rider after checkout commits; online-payment orders wait for PayMongo's paid webhook. One rider gets the first offer for up to eight hours. If it expires, the system offers the delivery to other currently available, verified riders. The first successful acceptance claims the delivery in a database transaction; competing offers are revoked.

Rider workspaces refresh available offers every ten seconds. Laravel's scheduler also processes waiting and expired offers. Run it continuously during local development:

```bash
php artisan schedule:work
```

In production, configure the host scheduler to run Laravel's scheduler once per minute:

```cron
* * * * * cd /path/to/backend/laravel && php artisan schedule:run >> /dev/null 2>&1
```

Boost provides your agent 15+ tools and skills that help agents build Laravel applications while following best practices.

## Contributing

Thank you for considering contributing to the Laravel framework! The contribution guide can be found in the [Laravel documentation](https://laravel.com/docs/contributions).

## Code of Conduct

In order to ensure that the Laravel community is welcoming to all, please review and abide by the [Code of Conduct](https://laravel.com/docs/contributions#code-of-conduct).

## Security Vulnerabilities

If you discover a security vulnerability within Laravel, please send an e-mail to Taylor Otwell via [taylor@laravel.com](mailto:taylor@laravel.com). All security vulnerabilities will be promptly addressed.

## License

The Laravel framework is open-sourced software licensed under the [MIT license](https://opensource.org/licenses/MIT).
