# FARMGATE chats API (backend)

The unified chat API is available to authenticated Sanctum users under
`/api/chat`. It supports saved AI conversations and participant-only direct
conversations. The server derives the actor and role from the authenticated
user; clients must not submit an actor, role, seller ID, or buyer ID.

## Provider configuration

Set these variables in the Laravel backend environment. Keep the API key
server-side; do not put it in the frontend environment:

```dotenv
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-2.5-flash
GEMINI_TIMEOUT=20
```

The Gemini key is sent as an HTTP header. `GEMINI_TIMEOUT` is the per-request
timeout in seconds. If the primary model is busy or unavailable, the server
tries the fallback model before returning a generic 503. Failed AI turns are
not persisted.

## Endpoints

- `GET /api/chat/conversations` lists the authenticated user's AI conversations and direct conversations they participate in (20 per page).
- `GET /api/chat/conversations/{id}` reads the last 20 messages; AI threads are owner-scoped and direct threads are participant-scoped.
- `POST /api/chat/messages` sends an AI message and persists the user/assistant pair only after provider success.
- `DELETE /api/chat/conversations/{id}` deletes an owned AI conversation and its messages. Direct conversations cannot be deleted by one participant.
- `PATCH /api/chat/conversations/{id}/report-context` clears the selected report context for an owned AI conversation.
- `GET /api/chat/recipients?search={name}` searches eligible recipients by name (at least two characters; results are capped at 15). It returns only `id`, `name`, and `role`.
- `POST /api/chat/direct-conversations` starts or retrieves the unique direct conversation for a recipient pair. The body contains `recipient_id` and may include `listing_id` for a buyer-seller listing chat. Listing context is accepted only when the listing belongs to the paired seller and an interest or order connects the buyer to that specific listing. The conversation response includes only the listing name, first image URL, and an in-app listing link.
- `POST /api/chat/conversations/{id}/messages` stores a direct message from the authenticated participant. Direct messages are limited to 2,000 characters and require a UUID `client_message_id` for retry idempotency.

Example AI request:

```json
{
  "conversation_id": null,
  "message": "Summarize my recent sales",
  "report": {
    "type": "sales",
    "from": "2026-01-01",
    "to": "2026-12-31"
  }
}
```

`conversation_id` is optional. `message` is limited to 2,000 characters.
`report` is optional and accepts only `type`, `from`, `to`, `status`, and `search`.
Report filters are saved as small, non-sensitive conversation metadata so
follow-up turns and refreshed chat history preserve the selected report. Send
`clear_report_context: true` with a later AI message to remove it.
Report aggregates are queried server-side through the same role-scoped query
rules and date/status filters as `/api/reports/{type}`; only aggregate counts
and suitable totals are sent to Gemini, not report rows.

## Direct conversations

Recipient search and direct chat allow other role pairs. A buyer and seller can
be listed, start a conversation, and send messages only when an order or
listing-interest record connects them. That relationship is checked again on
every send; a client-supplied recipient or conversation ID does not grant
access. Search requires a bounded name query, is rate-limited, excludes the
signed-in account and soft-deleted accounts, and returns only the minimal
identity needed to choose a recipient—never contact details.

Direct conversation pairs use a normalized unique key, so repeated or
concurrent starts return the same thread. Every read and send is scoped to the
authenticated participants. Direct messages are persisted with their sender
ID and timestamp. A sender's UUID `client_message_id` is unique within the
conversation; repeating it with the same content returns the saved message,
while reusing it with different content returns 409. Message contents are
excluded from audit change values.
Fetch/send is request-based; realtime delivery is not provided.

AI replies are informational and clearly labeled as automated in chat. The AI
is instructed not to promise refunds, complaint outcomes, or order/payment/
delivery status changes. When the AI marks uncertainty or a sensitive topic,
or a direct/AI message matches a sensitive-topic rule, the conversation is
flagged for human attention and a database notification is sent after commit
to the relevant seller or admins. Attention notifications contain no message
content and are de-duplicated per conversation. This is an escalation signal,
not a guarantee that a human has responded or resolved the issue.
Users can load or update their own chat and privacy preferences with
`GET /api/profile/settings` and `PUT /api/profile/settings`. The
`chat_notifications` preference controls database notifications for direct
messages, and `allow_direct_messages` controls whether other users can start
or continue a direct thread with that account.

Notification emails and device push share the notification center record and
its reference. Device delivery uses the Web Push API; configure
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` through the
deployment's secret manager, apply migrations, and run a queue worker for the
`notifications` queue. Never commit the VAPID private key. Users enable device permission from the Notifications page; denied or
unsupported devices continue to receive in-app notifications and eligible
transactional email. Push subscriptions are owner-scoped and encrypted at rest.
Email and push delivery attempts and outcomes are recorded per notification in
`notification_deliveries`.

AI role access follows existing reports: admins can request all report types;
sellers can request sales, transactions, listings, and deliveries; buyers can
request sales, transactions, and deliveries; riders can request deliveries.
An unauthorized report type returns 403. AI conversation IDs are owner-scoped
and return 404 when not owned; direct IDs return 404 unless the caller is a
participant. Chat sends and AI generation are limited to 8 requests per
authenticated user per minute, with an additional per-IP limit. Recipient
search has a separate authenticated-user and per-IP rate limit.
