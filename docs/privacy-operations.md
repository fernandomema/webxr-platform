# Privacy operations

Owner: Fernando Merino Marquez, Reus, Spain. Privacy contact: support@kithin.app.

Status: the privacy page is a local policy draft. The limits below were selected on October 1, 2026 at the owner's request. They are operational commitments to implement before deploying this version, not evidence of existing server configuration. No production server, mailbox, backup or database settings were changed during this review.

## Retention schedule

| Data | Limit | Required operation |
| --- | --- | --- |
| Account and saved content | While account remains open; ordinary erasure within one month of request | Verified manual erasure workflow below |
| Routine access and security logs | 30 days | Configure reverse proxy, container/runtime, OS and application log rotation; exclude bodies, credentials and AI payloads |
| Authentication sessions and verification records | Seven days after expiry | Daily cleanup of expired rows; expiry alone does not delete a database record |
| World hosting history | 30 days after endedAt | Daily cleanup; resolve stale active records before cleanup |
| Support correspondence | 12 months after resolution | Monthly mailbox review and deletion, including mailbox trash and provider backups |
| Recovery backups under Kithin's control | 30 days from creation | Daily encrypted backups; prune snapshots, database dumps and object versions, including provider snapshots; document restore procedure |
| Live voice and movement | No archive | Preserve existing live-only implementation |
| Unreferenced uploaded assets | Existing seven-day GC grace period | Run GC regularly and allow completion within the erasure deadline; check marketplace references before enabling destructive cleanup |

Specific incidents, statutory retention or legal claims may justify exceptions. Document the purpose, legal basis, limited data, access restrictions and review date. Do not retain all logs indefinitely under a general security exception.

## Erasure workflow

1. Receive the request at support@kithin.app; record receipt date and one-month response deadline. Verify control of the account using proportionate means. Never request a password or routinely collect an identity document.
2. Identify account, provider tokens, sessions, worlds and hosting records, cloud inventory, publications, marketplace listings and acquisitions, uploaded assets and support correspondence.
3. Review legal retention exceptions and files copied or referenced by other users. Shared references do not override the right to erase personal data contained in a file.
4. Use a transaction for applicable account deletion and related records. Inspect schema cascades first. The asset.firstUploadedById field has no user foreign key and must be cleared or anonymised explicitly. Audit JSON scene data and copies in other users' inventory for remaining personal information.
5. Revoke access, remove applicable live records and complete asset cleanup. Retain a minimal deletion record to prevent reintroducing erased data during restores, with access restricted and a justified retention period.
6. Backups expire no later than 30 days from creation. Restrict backup access and reapply all relevant deletion requests before a restored system resumes service.
7. Confirm the outcome and explain any lawful exceptions. An extension of up to two further months requires notice with reasons within the original first month; it is not the default processing time.

## Hosting and international transfers

- The owner identifies the hosting provider as Bytehosting. Its public homepage says Frankfurt, Germany: https://bytehosting.cloud/index. Confirm that this is the actual provider and contracted VPS region, including database, S3-compatible object storage, disaster recovery and backups. Local environment configuration does not prove production location.
- Obtain the Article 28 processor agreement and subprocessors/locations from Bytehosting: https://bytehosting.cloud/privacy-policy. The provider's customer billing retention rules do not set Kithin users' retention periods.
- The checked local configuration and .env.example use Google STUN, stun:stun.l.google.com:19302. No TURN relay is configured there. Recheck production environment before publication. Google Fonts also loads externally.
- Map each Google, Discord, Meta and optional AI flow. Establish whether each party acts as processor or independent controller. Obtain service-specific terms; do not assume Google's general privacy policy proves a processor agreement for its public STUN service.
- Where Kithin is responsible for a transfer outside the EEA, verify an applicable adequacy decision or actually executed appropriate safeguards, assess the transfer and document supplementary measures when needed. Standard contractual clauses are a possible mechanism, not a contract signed merely by writing this policy. Do not use optional-feature permission as blanket transfer consent.
- If safeguards cannot be established for the current STUN service, use a documented EEA-hosted STUN service instead. Consider self-hosted fonts to remove that external request. These infrastructure changes are not implemented by this policy review.

## Outstanding publication details

- Obtain a complete postal contact address. Reus is a city, not a full postal address. Do not invent a street or publish a private address without the owner's instruction.
- Age recommendation: initially adults only (18+), pending the owner's choice. No age restriction has been added to the public page yet. A chosen limit must also be communicated and supported in registration, guest entry and Discord sign-in; the statement alone is not age verification.
- Verify public Meta Quest store declarations against the final APK and privacy policy. The reviewed packaging code disables Android backups and opens the web app; no separate Meta identity, purchase or analytics integration was found in the reviewed source.
- Confirm mailbox operation, backup configuration, retention jobs and one test erasure/restore workflow before publishing the numeric limits.
