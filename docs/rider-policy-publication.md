# Rider policy publication and onboarding

## Initial state

Rider registration is closed until an administrator publishes a complete policy version with an effective date that has arrived. Policy text, version, date, and privacy contact are deliberately not seeded from configuration or repository drafts. A draft, an incomplete version, or a future-effective version does not expose a registration form or accept registration data.

## Current local development database

The configured local Farmgate database contains rider policy version 1.0, published through the authenticated Farmgate Admin workflow with an effective date of 9 November 2026. Its approval and publication actors are recorded as Farmgate Admin in the audit history. Rider registration remains closed because the `rider_registration_enabled` system setting is disabled. This is database state, not a migration or automatic seed; other environments remain closed until their authorized administrators review and publish their own policy package.

The public registration-status endpoint reports whether policies are unpublished, draft/incomplete, scheduled, or open. It does not expose draft contents. Only published and effective policy text is returned publicly.

## Administrator workflow

1. Sign in as an authorized administrator and open **Admin → Rider policies**.
2. Review the supplied rider policy package overview and source links. It is not the complete text of the four required policies; all standalone approved documents must be entered in their corresponding fields. Source placeholders remain unresolved until verified details are provided.
3. Create a draft version and enter the actual privacy notice, rider terms, safety policy, retention and secure disposal schedule, privacy contact, and effective date. Draft metadata and all four document fields may be incomplete while work is in progress.
4. Save the draft while content is being reviewed. The latest draft reopens after navigation or reload. Saving stores unfinished work, clears any prior approval, and does not assign an effective date or enable registration. Draft saves record the editor, version, changed field names, document character counts, and timestamp without putting policy text into the audit record.
5. After all four texts are complete and placeholder-free, explicitly approve the saved version. Approval is separately recorded with the administrator and timestamp. Any subsequent draft save resets approval.
6. Explicitly publish the approved version. The publication checklist requires a valid version, effective date, privacy contact, complete documents, approval, and explicit publication confirmation. Published versions are immutable; create a new version for revisions. Draft saves, approvals, and publication are linked to versioned audit history without copying policy text into the audit record.
6. Registration opens only when the persisted published version is complete and effective and the existing account/rider registration settings are enabled.

The publication confirmation is an administrative attestation; it is not legal advice, an independent legal review, or a compliance certification. Do not copy the repository's draft policy package into the publisher and treat it as approved. The organization must determine the actual policy contents and effective date.

## Applicant data and review

The registration form is not rendered while the backend reports closed. Required acknowledgments are versioned and timestamped separately for privacy, terms, safety, and retention. Optional rider updates consent is stored independently and is not required for application.

Identity and vehicle review is manual. New onboarding does not collect selfies and does not perform OCR, face matching, or biometric identification. Uploaded driver-license, vehicle-registration, and vehicle-photo files use the existing private rider disk and application-level encryption; signed document links still require an authenticated applicant owner or administrator.

Applicant status and history are available after rider sign-in. Anonymous status lookup is intentionally not offered so that a reference number and a guessed email address cannot be used to enumerate applicant status.

## Operational retention

Publishing a retention schedule records the approved policy document but does not create retention durations or a deletion schedule automatically. Before publication, administrators must ensure the entered schedule accurately reflects configured storage, backups, audit/history requirements, and actual deletion operations. No retention period is invented by this feature; automated retention enforcement remains dependent on approved durations and an operationally reviewed deletion process.
