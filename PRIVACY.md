# Compliance-01: recruitment retention and erasure

The backend provides retention enforcement and a verified candidate-erasure workflow. Jurisdiction is **not inferred from EN/ZH language**. Confirm the controller's location, candidate markets, applicable PDPA/PIPL/other law, privacy contact, and lawful exceptions before legal sign-off.

The existing `recruitment-24-months-v1` consent supplies the initial **organisation policy**, not a statutory retention period. GDPR storage limitation requires a purpose-based period; Article 17 provides erasure rights and exceptions. The request deadline here is **one calendar month in UTC from receipt**, including staff-recorded earlier receipt dates. Verification and legal holds do not reset that clock. The controller handles acknowledgements, decisions, extensions where legally available, and recipient notifications through its privacy case process. [GDPR Articles 5, 12, 17 and 19](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

## Retention behaviour

- Applications receive an immutable `retention_expires_at` on insertion; existing applications start at submission plus 24 calendar months.
- ADMIN can set recruitment retention and privacy-evidence retention to 1–24 months. A shorter recruitment policy also limits existing records. Non-personal policy history prevents relaxing a later policy from resurrecting expired records.
- Expired or deletion-blocked records are unavailable through recruitment reads, stage changes, CV issuance, and application-token replay. Legal holds preserve data but do not restore ordinary recruitment access to expired/request-blocked records.
- Automatic age-based destruction starts **disabled**. Explicitly verified deletion requests can be processed independently of that switch once the worker is configured.
- Each application expires independently: an additional application does not extend an older application's CV/profile retention. Candidate identity and all merge aliases are removed once the group has no remaining applications and no active hold. Unattached expired identities are also collected when retention is enabled.
- Completed/rejected request evidence and privacy command/audit evidence are purged in bounded batches after the configured evidence period. Open requests remain visible for review and overdue escalation. Request evidence contains opaque references and decision codes; identity documents and free-text explanations belong in the external restricted privacy case system.

## Backend endpoints

All ADMIN endpoints require an admitted ADMIN session, apply the existing CSRF rules for cookie writes, return private/no-store responses, and independently check authority inside the database command.

| Method     | Path                                       | Purpose                                                                 |
| ---------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| POST       | `/api/privacy/deletion-requests`           | Recent applicant requests review using an unexpired application receipt |
| GET / POST | `/api/admin/privacy/requests`              | List or register requests received through the privacy contact          |
| GET        | `/api/admin/privacy/requests/{id}`         | Request state, due date, verification and cleanup status                |
| POST       | `/api/admin/privacy/requests/{id}/actions` | Verify or reject with a controlled reason code                          |
| GET / PUT  | `/api/admin/privacy/policy`                | Read or change retention settings                                       |
| GET        | `/api/admin/privacy/holds`                 | List legal holds                                                        |
| POST       | `/api/admin/privacy/holds/{candidateId}`   | Set, renew or release a hold on the canonical candidate group           |
| GET        | `/api/internal/cron/privacy-cleanup`       | Authenticated, bounded cleanup worker                                   |

### Candidate and staff intake

Public intake requires the configured public site's `Origin`, JSON, an `Idempotency-Key` UUID header, and:

```json
{ "resumeToken": "UPLOAD_UUID.BASE64URL_CAPABILITY" }
```

It shares the application API's committed rate limits and trusted-proxy checks. Only a hash of the capability reaches SQL; a confirmed application's matching, unexpired receipt is required to create a request. All well-formed receipts receive the same `202 {"status":"received"}` response, including unknown/expired/already-requested receipts. This acknowledgement does not disclose a match or confirm erasure. The caller must explain that older applications or unavailable receipts require contacting the organisation's privacy contact. ADMIN verification is still required; this endpoint does not authorize automatic erasure.

Staff register older requests received through that contact with `POST /api/admin/privacy/requests`:

```json
{
  "id": "REQUEST_UUID",
  "candidateId": "CANDIDATE_UUID",
  "requesterRef": "OPAQUE_EXTERNAL_PRIVACY_CASE_UUID",
  "requestId": "IDEMPOTENCY_UUID",
  "receivedAt": "2026-10-31T09:00:00Z"
}
```

`receivedAt` is optional (defaults to server receipt), must be finite and not in the future, and can record an older overdue request. Use the actual earliest receipt rather than the later verification date. No name, contact details, passport scan, or free-text reason is accepted in these commands.

Verify identity using the controller's established proportionate process and keep its evidence in the external case referenced by `requesterRef` or the public request UUID. Then POST an action:

```json
{
  "action": "verify",
  "expectedVersion": 1,
  "requestId": "NEW_IDEMPOTENCY_UUID"
}
```

Rejection uses `action: "reject"` and a `reasonCode` from `IDENTITY_UNVERIFIED`, `DUPLICATE`, or `NOT_APPLICABLE`. Use a documented legal hold for legal obligations instead of rejecting the request and restoring recruitment access. A request blocks the whole candidate group while pending; rejecting a request lifts that request's block. Completed or processing requests cannot be rejected. Duplicate command IDs replay only for the same actor and exact command; changed commands/stale versions return 409.

### Legal holds

Set a hold **before cleanup starts**:

```json
{
  "action": "hold",
  "expectedVersion": 0,
  "requestId": "IDEMPOTENCY_UUID",
  "caseRef": "EXTERNAL_LEGAL_CASE_UUID",
  "reasonCode": "LEGAL_CLAIM",
  "until": "2027-01-31T09:00:00Z"
}
```

Use version 0 only when no hold exists. Renew using the returned hold version. Reasons are `LEGAL_CLAIM` or `LEGAL_OBLIGATION`; each expiry must be future and no more than one year away. Release with `action: "release"`, `expectedVersion`, and `requestId`. Any remaining hold on an alias still protects the group. An active hold puts verified requests on hold; released/expired holds allow processing to resume. Once erasure is queued or a request is PROCESSING, new holds and rejection are refused because external removal may already have started.

## Worker and storage guarantees

The scheduler runs every ten minutes. A run prepares at most 20 applications and leases at most five removals. Database transactions are closed before Storage HTTP calls. Failed calls keep the metadata and request retryable with backoff; expired/stale lease tokens cannot finalize a later claim. Processing is not marked complete until every application in the merged group has completed storage and database cleanup.

CV access is revoked before removal. Cleanup waits for signed upload expiry plus five minutes and at least one minute after access revocation, covering the existing 60-second download URL lifetime. Both `cv-quarantine` and `cv-clean` are enumerated under the exact upload UUID: promotion can create a different object key. Listing/removal failures, partial deletion, unexpected names, oversized listings and unsupported storage providers fail closed. The current worker supports Supabase; S3 descriptors remain pending for an appropriate adapter.

Successful erasure removes application profiles, cover letters, consent/application metadata, upload metadata, candidate encrypted identity/HMACs when no group applications remain, and related recruitment command/audit/outbox references. Minimal request completion and non-identifying erasure receipts remain for their bounded evidence period. Monitor cron responses (`queued`, `removed`, `failed`, `skipped`, `completed`, `pending`, `overdue`) and `GET /api/admin/privacy/requests?overdue=1`; provider outages and large backlogs need operator attention.

## Rollout

1. Apply the new migration through the normal reviewed migration process (`npm run db:deploy`), then deploy the application. Existing migrations were not edited.
   Include `20261102000100_privacy_dependency_permissions`: it grants the privacy definer access to the legacy candidate-blocking predicate as that function's actual owner. Without this repair, admitted staff dashboard and application reads can return 503 with SQLSTATE `42501`.
2. Provision a separate server-only login using a generated password:

   ```sql
   CREATE ROLE portal_privacy_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
     NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<generated password>';
   GRANT portal_privacy_worker TO portal_privacy_app;
   ```

   Its only direct role membership must be `portal_privacy_worker`. Do not grant runtime/owner/provider memberships. It has EXECUTE capabilities, without candidate-table reads. Set `PRIVACY_WORKER_DATABASE_URL` to that login's secure database connection. Configure the existing `CRON_SECRET`; the cron never falls back to a staff cookie or ordinary runtime connection.

3. Review eligible legacy data and legal holds, privacy contact instructions, storage inventory, and recipient/export obligations. Establish a backup retention window and record erasures in the restricted external case/recovery process. A restored backup must have those erasures reapplied before serving traffic. Downloaded/exported copies and third-party recipients require the controller's own notification/removal process; this worker cannot recall external copies or provider backups.
4. Read `/api/admin/privacy/policy`, then enable scheduled age-based retention with its current version:

   ```json
   {
     "expectedVersion": 1,
     "requestId": "IDEMPOTENCY_UUID",
     "retentionMonths": 24,
     "evidenceMonths": 24,
     "retentionEnabled": true
   }
   ```

5. Observe authenticated cron runs, retry/overdue counts and a synthetic request before accepting the deployment. Storage removal is irreversible; changing the retention switch does not cancel already queued erasures or verified requests.

## Verification

```powershell
npm.cmd run test:privacy
npm.cmd run test:privacy:integration
npm.cmd run test:privacy:hosted
npm.cmd run build
npm.cmd run test:privacy:e2e
```

The hosted migration check uses `.env.test`, requires the new migration to be unapplied there, and rolls back all DDL/data changes. The E2E access check uses temporary HR/READ_ONLY identities against the production build, with no candidate erasure. Isolated PostgreSQL tests execute the migration and real commands with representative constraints/RLS. Storage tests exercise listing/removal failure and retry semantics through a test adapter. No test run authorizes destruction of existing candidate records or configures production retention.
