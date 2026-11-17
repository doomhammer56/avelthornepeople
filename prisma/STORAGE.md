# Private CV storage (Storage-01)

The implementation uses two fixed private buckets: `cv-quarantine` and `cv-clean`.
Files are limited to **10,000,000 bytes**, PDF (`application/pdf`) or legacy DOC
(`application/msword`). New uploads are never public. With malware scanning
currently deferred, byte-validated CVs are explicitly `UNSCANNED`, stay in
`cv-quarantine`, and are available to Admin/HR only as signed attachments.

## Supabase setup

Use the dedicated test project first. Keep its `DIRECT_URL` and test identity
separate from production. In the project's **Connect** dialog copy the project
URL and publishable key; the server secret is available under **Settings > API
Keys**. Put values only in the ignored `.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

The server also accepts a legacy `service_role` key under `SUPABASE_SECRET_KEY`.
Never use an `anon`/publishable key there, prefix a secret with `NEXT_PUBLIC_`,
paste secrets into chat, or commit `.env`. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Run from the project root (PowerShell `.cmd` avoids execution-policy shim errors):

```powershell
npm.cmd run db:validate
npm.cmd run db:deploy
npm.cmd run storage:policies
npm.cmd run storage:setup
npm.cmd run storage:verify
```

`storage:setup` creates missing buckets or updates only their privacy/size/type
configuration through the Storage API; it never empties/recreates buckets.
`storage:verify` reads their configuration without changing it. Run setup twice
to check repeatability. No dashboard bucket creation is needed when these commands
have working API credentials.

`storage:policies` applies the versioned SQL in
`supabase/storage/001_private_cv_policies.sql` through `DIRECT_URL`. If the project
rejects policy ownership, run that exact file in its SQL editor with the authorized
owner role. It adds restrictive CV-only guards to `storage.objects` and
`storage.buckets`; existing policies for other buckets remain intact. Do not add
an "all authenticated users" allow policy to either CV bucket. Do not manage
provider Storage tables through Prisma or delete object metadata directly.
[Storage schema contract](https://supabase.com/docs/guides/storage/schema/design).

## Runtime database login

The signed-download endpoint deliberately rejects migration, table-owner,
CREATEROLE and BYPASSRLS connections. `DIRECT_URL` remains the migration/test
connection. Configure `DATABASE_URL` with a separate login, for example by running
this once in the intended project's SQL editor with a freshly generated password:

```sql
CREATE ROLE portal_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD 'REPLACE_WITH_A_UNIQUE_GENERATED_PASSWORD';
GRANT CONNECT ON DATABASE postgres TO portal_app;
GRANT portal_runtime TO portal_app;
```

If that role already exists, inspect it before changing membership/password.
Do not execute the example with its placeholder password. Store the real password
only in the deployment secret store/ignored environment. Using the project's
connection settings, set the runtime URL to the corresponding `portal_app` login;
for a shared pooler use `portal_app.PROJECT_REF` as the username. URL-encode the
password. Keep its host/port/database correct for the selected connection mode.
Do not give this login membership in `portal_public_view_owner`, provider/admin
roles, or ownership/DDL privileges. The existing public connection remains separate.
[Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

The server uses a bounded two-connection pool. Each request opens one transaction,
checks the login, sets `LOCAL ROLE portal_runtime` and the verified user subject,
queries the authorized CV and records a narrow audit event, then commits before
returning the URL. Roles and claims are transaction-local; authorization is not
cached across requests. The runtime credential cannot insert arbitrary audit
rows or edit scan/approval/privilege fields.

## Implemented boundaries

- The server-only adapter validates CV types/sizes and opaque UUID keys. It creates
  exact-key upload tickets with upsert disabled. Supabase upload tokens last two
  hours; the application acceptance window is separately 15 minutes. The trusted
  upload-intent service reserves the hashed application capability and a conservative
  provider deadline before minting, then records the exact provider expiry before
  returning the token. It requires a caller-supplied abuse/eligibility guard and
  narrow persistence implementation. The public intake routes now provide their
  own bounded persistence commands, origin checks, traffic limits and job checks;
  see [public applications](../runbooks/public-applications.md).
- Trusted worker promotion verifies the source size and SHA-256 against the exact
  scan receipt, then writes a new clean key without overwriting. The adapter never
  marks a database row CLEAN. A future private scanner must scan those same bytes
  before promoting them. A MIME header or
  digest alone is not malware detection. No browser can call a promotion endpoint.
- `POST /api/admin/applications/{UUID}/cv-url?mode=download|preview` supports verified
  staff bearer tokens or admitted console sessions. Cookie writes require the
  configured Origin. The server checks fresh HR/Admin membership, requires a
  confirmed application and a clean or explicitly unscanned,
  non-revoked upload whose candidate is not flagged for deletion, and confirms
  provider size/type before signing. READ_ONLY, missing/inactive staff and public
  callers are denied. PostgreSQL RLS gates the lookups as well.
- Downloads are signed for a fixed 60 seconds, use neutral filenames and return
  `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. DOC always
  downloads; unscanned files always download. PDF preview requires the future isolated viewer. Tokens/URLs/PII and
  provider error bodies are not logged. The new audit helper rechecks authorization
  after signing and records only actor/application/upload/request UUIDs. Failed
  audit, changed authorization or failed commit returns no URL.
- `uploads.access_revoked_at` blocks new staff reads/signatures without changing
  the CLEAN/UNSCANNED discriminator protected by the confirmed-application FK.
  `provider_upload_expires_at` supports replay-aware orphan cleanup. Those fields
  are additive; existing applied migrations are preserved.

Public intake is now open for database-backed public vacancies, with origin
checks, distributed traffic limits, bound upload capabilities, expiry, job
eligibility and consent/idempotency. Malware scanning is explicitly deferred;
signature/size validation does not mark a file clean. Public intake currently
does not use a CAPTCHA; staff-login CAPTCHA configuration is separate.

## Encryption, expiry and revocation

Hosted Supabase documents AES-256 encryption at rest and TLS in transit.
This implementation requires HTTPS except for an explicit loopback development
origin. Provider-managed encryption has no per-bucket application switch. Signed
URLs grant access; they do not encrypt CV bytes. Application-managed envelope
encryption/key custody would require a separate scanner/decryption design.
[Provider encryption](https://supabase.com/security).

Signed URLs are bearer capabilities. A staff deactivation prevents new signing,
but does not revoke an already issued URL. Auth key rotation does not revoke
Storage signatures. The 60-second signature lifetime is not a guarantee that a
browser or CDN discards previously downloaded bytes. Uploads made by the adapter
use `cacheControl: '0'`. The integration test warms a short-lived signed URL and
measures post-expiry HTTP behavior. Record the deployed result; fix unexpected
cache serving before production acceptance. [Signing behavior](https://supabase.com/docs/guides/storage/serving/downloads),
[Smart CDN behavior](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

Cleanup must use the Storage API, preserve durable object locators for retries,
and wait until provider upload expiry plus the documented grace period before
orphan deletion. A 15-minute application expiry does not revoke the two-hour
provider upload token; deletion before transport expiry can allow re-upload.
Keep clean keys distinct and immutable. Stop new signatures before a privacy
deletion and resolve legal holds/retention through the approved workflow.

## Verification

```powershell
npm.cmd run test:storage
npm.cmd run test:storage:integration
npm.cmd run test:db
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:storage:e2e
```

Unit tests require no live credentials. Storage HTTP tests require all three API
environment values, `DIRECT_URL` and `TEST_STAFF_USER_ID` for the same dedicated
project. They create a confirmed synthetic Auth user via the supported Admin API
(no email sent), upload exact UUID-key fixtures, exercise direct access denial,
scoped uploads, immutable promotion, signing/tampering and cache expiry, then
remove their files/user. Test objects cannot roll back with a database transaction;
teardown removes exact tracked keys only. Tests never empty a shared bucket.
The synthetic scan receipt proves transport/digest handling, not a production
scanner. Database CV tests roll back their profile/domain/audit fixtures.

`test:storage:e2e` requires the production build and a restricted `DATABASE_URL`.
It starts the built app on an ephemeral localhost port, creates one synthetic
staff identity and private PDF fixture, verifies the actual route with real JWTs,
then stops the server and removes its exact fixtures and identity. No email is sent.

## Verified test deployment: 19 October 2026

Both buckets are provisioned and verified private with the configured size/MIME
restrictions. Re-running setup makes no changes. The two restrictive Storage
guards are applied. A dedicated `portal_app` login has only the staff-runtime
capability; its generated connection is configured in local `.env` as
`DATABASE_URL`. Migration credentials remain under `DIRECT_URL`. No secret
values are stored in this runbook or tracked source.

All nine hosted Storage integration tests pass across the completed runs,
including restricted-login checks, scoped uploads, exact byte-limit and MIME
enforcement, overwrite/path/bucket denial, immutable promotion, direct
anonymous/authenticated denial, signed download/tampering and expiry.
The warmed short-lived URL returned HTTP 400 after expiry with CDN BYPASS in
this test environment; repeat this check for the actual production deployment.

All seven built-endpoint tests pass with real Supabase staff JWTs: editable
metadata cannot elevate READ_ONLY, active HR/Admin can sign, deactivation applies
to the same unexpired JWT, revoked/deletion-blocked/pending CVs yield no URL,
and only successful issuance creates safe audit references. Synthetic files,
domain rows and Auth identities are removed by teardown. A final database check
confirmed no CV objects, synthetic Auth users/profiles or temporary test logins
remain; the two configured buckets and restricted runtime login remain in place.

The storage infrastructure and public intake are verified in the dedicated test
project. Production still requires its own migration and private-bucket/policy
setup, runtime credentials, stable candidate keys, matching public Origin and
trusted traffic-limiter configuration. Scanning is explicitly deferred under the
UNSCANNED policy described above. Retention/privacy-deletion processing and
automatic confirmation-email delivery remain separate unfinished workflows.
