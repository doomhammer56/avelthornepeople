# Database access contract (DB-02)

The RLS migration adds three NOLOGIN, NOBYPASSRLS roles. Keep `portal` and
`portal_private` outside Supabase's exposed schemas. Browser/provider roles
`anon`, `authenticated` and `service_role` retain no application grants. Public
and staff services use separate, narrowly provisioned PostgreSQL connections.

| Role                       | Purpose                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `portal_public_reader`     | SELECT on public views only, including job-option labels; no base-table access                                |
| `portal_public_view_owner` | Owns those views and can read necessary public source columns under RLS; never assign to an application login |
| `portal_runtime`           | Staff reads and limited column writes under live staff-role RLS                                               |

Provision separate login identities through the deployment secret-management
process. Grant each login only its intended capability role, without ADMIN OPTION,
CREATE, BYPASSRLS, table ownership or membership in another application/provider
role. Use NOINHERIT logins and select the capability with `SET LOCAL ROLE` inside
the query transaction. Never use migration credentials as a runtime connection.
This migration creates no passwords or login identities and does not change
Supabase Data API configuration.

All four application pools now use verified TLS by default, with hostname and
certificate checks enabled explicitly. Connection-string SSL flags are removed
before the driver parses the URL so they cannot weaken or replace that policy.
`DATABASE_TLS_CA` accepts an optional trusted project CA PEM/bundle, including
escaped newlines. Obtain it through the project administrator, never from an
unverified server connection. Without it, Node's default trust store applies.
`DATABASE_ALLOW_LOCAL_PLAINTEXT=true` is permitted only for literal loopback
endpoints and rejects a remote `host` override. It is not a hosted workaround.
Before deployment, configure the CA if needed and verify all four restricted
roles with `pg_stat_ssl`, hostname checks and a deliberately untrusted CA.

The environment contract reserves `DATABASE_URL` for the staff connection and
`PUBLIC_DATABASE_URL` for the separate public connection; `DIRECT_URL` is for
migrations/tests. Staff authentication and CV access now use the shared checked
runtime transaction module. Public job reads use the checked public-reader
transaction in `src/server/database/public.ts` with `PUBLIC_DATABASE_URL`. See the
[Auth runbook](../runbooks/auth.md) for session checks and narrow staff commands;
adding environment names alone does not enforce RLS on other connection code.

## Public queries

Use the public connection and select only from:

- `portal.visible_jobs`: approved `PUBLISHED` jobs whose publication time has
  arrived and closing time has not. Explicit columns omit draft, owner and
  approval metadata. All four salary values are null when `show_salary` is false.
- `portal.published_content`: due, published company content, without draft data.
- `portal.public_departments` and `portal.public_locations`: active lookups.
- `portal.visible_job_locations`: assignments to visible jobs and active locations.

The migration owner retains membership in the view-owner role to maintain views
in later migrations. No application/provider login may receive that membership.

The views deliberately use the privileges of `portal_public_view_owner`, not the
caller. That role owns no base tables, has no BYPASSRLS, and has explicit public
SELECT policies plus column grants. It cannot read drafts or HR tables. The
`security_barrier` setting protects row filtering. Do not transfer these views
to `postgres` or another privileged owner: doing so would bypass their RLS
visibility predicates. Do not grant source tables or the view-owner role to
the public connection.

Public visibility uses `statement_timestamp()`, including in long transactions.
Discovery excludes paused/closed/never-published jobs. A safe closed-link DTO
requires a separate authorized server query in the jobs service. JSON in
`published_content` must already be sanitized and contain public fields only;
the database's object-shape check does not sanitize arbitrary nested JSON.

Public job lists have a separate summary projection: SQL extracts only the two
title JSON values and the strict boolean fallback flag, alongside identifiers,
publication time and reference labels. It does not return the description
document, closing date or salary columns. Titles retain their JSON types until
DTO validation so numbers/objects cannot silently become valid strings. Summary
validation remains independent of detail-only fields and rejects duplicate IDs
or slugs. Detail queries still validate the complete public record and use a
parameterized slug with `LIMIT 1`. Both paths use the same checked reader,
public views, reference joins and active-location rule. There is no persistent
cache or new grant/migration for these public reads. `publishedJobPage` applies
parameterized title/facet filters and bounds page sizes to 1–100 (Careers uses
10, Home uses 6). Counts and rows share one SQL statement. Only page IDs and
publication timestamps are materialized for filtering/counting; full summary
projection is restricted to the selected IDs. Facets use a separate query over
the complete visible set, returning at most 100 options per field. Each field
has independent pages, including UI links, so options are not silently dropped.
Counts/search/facet distinct work can still scan visible rows; this is not a
claim of constant database execution time. Sitemap deliberately exports only
slug/date metadata in database mode and traverses bounded pages in external
API mode. External APIs must implement the new page/facet envelope.
Run `npm run test:jobs:public-summaries` for the isolated SQL regression checks.

## Staff queries

The staff directory uses the admitted ADMIN-only
`portal_private.read_staff_accounts(integer)` function. It returns at most 51
rows (50 accounts plus lookahead), projecting only staff/profile fields, Auth
identity ID/email/last-sign-in time, and the oldest pending provider operation.
It uses the established administrative definer owner and `require_staff_admin()`
guard, with an empty search path. Runtime receives execute permission only; no
new Auth table grants, Auth policies, identity copies, or browser/provider access
are introduced. Deployment must retain the established migration owner with its
existing Auth read capability. A partial index supports pending operations by
profile. This replaces per-account Auth HTTP requests without caching identity
or authorization data across requests.

BE-07 adds `portal_audit_owner`, a NOLOGIN/NOBYPASSRLS trigger owner with only
staff identity/active inspection and audit/outbox insertion. Never assign it to
application/provider logins. The new payload/code constraints protect future
audit writes; unsafe legacy details are withheld by the ADMIN-only audit service.
Runtime audit mutation grants remain absent. See the [Audit runbook](../runbooks/audit.md).

Validate the Supabase JWT server-side using the supported Auth SDK, including
signature, issuer, audience and expiry, before using its subject. Within one
Prisma interactive transaction or one checked-out `pg` client:

1. Begin a transaction and `SET LOCAL ROLE portal_runtime` (constant SQL).
2. Parameterize `SELECT set_config('request.jwt.claim.sub', $1, true)` with the
   verified UUID, and set `request.jwt.claims` transaction-locally to a minimal
   verified JSON claim object as needed. Set both on every request; do not retain
   user-supplied metadata or accept a client-selected subject.
3. Execute the protected queries on that same transaction/connection.
4. Commit or roll back before returning the connection to its pool.

Never use session-scoped role/claim changes or independent pooled calls for these
steps. Supabase JWTs do not automatically propagate through Prisma. A privileged
Prisma connection can bypass RLS and still needs fresh service authorization.
RLS assumes only trusted services possess SQL credentials: those credentials
can set a subject and must never be shipped to a browser. Provider session
revocation checks and HTTP/CSRF protections remain Auth-01/service work.

The checked `pg` wrappers batch constant `BEGIN`, session-user role inspection,
and `SET LOCAL ROLE` statements in one simple-protocol exchange. Role inspection
still runs on every transaction; the result must pass before claims or business
queries execute. Claims remain a separate parameterized statement. Setup failure
rolls back before release. Public reads retain `BEGIN READ ONLY`; analytics and
expiry workers retain their separate role checks. Staff admission and profile
authorization now share one SQL statement, and the endpoint gate and service
before/after checks remain live. No authorization or role-validation cache is used.
Run `npm run test:database:transactions` for isolated SQL/RLS/reuse regression checks.

The private SECURITY DEFINER helper reads the current active `staff_profiles`
role by `auth.uid()`, with an empty search path and fully qualified relations.
It accepts no UUID/role arguments and ignores editable JWT metadata. Only
`portal_runtime` may call it. Missing/inactive profiles return no role. Role
changes take effect on the next statement under READ COMMITTED; do not cache
authorization across requests or use long-lived repeatable-read staff sessions.

| Staff role | Read                                                                                         | Direct writes                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| READ_ONLY  | Jobs, company content, departments/locations/assignments, non-PII daily metrics, own profile | None                                                                                        |
| HR         | READ_ONLY plus candidates, confirmed applications, their clean/unscanned uploads, contact messages | Audited job and application-stage/candidate-merge commands; direct message assignment/state |
| ADMIN      | HR plus staff directory, audit and deletion requests                                         | HR commands plus audited job-reference, team and company-content commands                    |

Only the listed columns are writable. Publication/approval fields, approved job
filters/salary/schedules, job-location assignments, company-content publication,
staff activation/roles, intake/scan state, deletion processing, audit mutation
and outbox operations have no direct runtime write grant. These stay with
separately authorized server commands/worker capabilities that atomically write
the business change, allowlisted audit and outbox event. Admin status alone does
not grant arbitrary SQL writes. There are no runtime DELETE or TRUNCATE grants.

CV storage/signing is separate: a visible upload row does not grant object
download. Storage-01 must verify authorization and issue short-lived signed links.
READ_ONLY never receives candidate, application, upload, message, audit or
deletion rows. Worker/retention capabilities require their own reviewed grants;
do not reuse `service_role` or widen `portal_runtime` as a shortcut.

## Validation and rollout

BE-06 adds `portal_content_owner` (NOLOGIN), admitted ADMIN content/image commands,
managed publication projections and a private company-image bucket. Runtime direct
content INSERT/UPDATE grants are revoked. HR/READ_ONLY retain draft/media inspection
without write permission. `portal_public_reader` sees only managed published blocks
and referenced image metadata, never draft columns or direct private object access.
Application/provider logins must not inherit the content owner. Existing legacy
content views remain intact; new APIs select managed slots. See the
[Company content runbook](../runbooks/content.md).

BE-05 adds `portal_recruitment_owner` (NOLOGIN): narrowly scoped stage/merge
commands, candidate-group deletion checks and atomic audit/outbox writes.
`portal_runtime` loses direct application status/version updates and only calls
the admitted HR/ADMIN command. It receives no candidate write/delete grant and
must never inherit the command-owner role. Candidate aliases/versioning retain
original encrypted profiles and application/CV history. Deletion requests on
any alias block the canonical group's profile/CV access. Operator-owned CV and
attachment functions retain explicit execute permission on the group check.
See [Applications runbook](../runbooks/applications.md) for keys and rollout.

Public intake now uses narrow execute-only commands owned by the same recruitment
owner. They validate bound capabilities and job state, write encrypted profiles,
and atomically confirm applications with explicit `UNSCANNED` CVs. Provider roles
still have no application SQL grants. The public routes use the checked runtime
connection, not operator credentials. Admin Settings uses `portal_jobs_owner`
commands; direct department/location writes are revoked. New job-option labels
are exposed through a separate public view. See [intake and Settings rollout](../runbooks/public-applications.md).

### Dashboard collection (BE-02)

The additive dashboard migration defines `portal_metrics_writer`, an execute-only
capability for a separate server login configured as `ANALYTICS_DATABASE_URL`.
It cannot read application tables or issue arbitrary metrics writes. Never grant
it to the staff runtime, public reader or browser/provider roles. Its single
command checks public job eligibility, tracking enablement, bounded dimensions
and shared quotas before an atomic daily increment. The internal
`portal_metrics_owner` has no login/BYPASSRLS/table ownership; never assign it to
an application login. See [Dashboard runbook](../runbooks/dashboard.md).

ADMIN/HR aggregation uses the existing checked staff transaction. READ_ONLY does
not gain application access. Confirmed application conversion uses the explicit
nullable `submission_channel`; existing source labels are not backfilled as
submission channels.

Use the dedicated Supabase test project and its synthetic Auth identity supplied
by `TEST_STAFF_USER_ID`; fixtures and profile changes roll back. The RLS suite
changes no managed Auth records. Before deploying the new migration, set
`DB_RLS_PREVIEW=1` for `npm run test:db:rls`: the exact new SQL, roles and fixtures
run in one transaction and roll back, without migration-history changes. Unset
that flag after preview; preview is for the DB-01 baseline, not an already
migrated database.

After reviewed deployment run `npm run db:status`, `npm run test:db`,
`npm run db:validate`, lint and formatting checks. Migration deployment needs
CREATEROLE and ownership of application objects; role names are cluster-scoped.
Provider/browser default-deny tests remain mandatory. Verify login-role grants,
exposed-schema configuration, JWT validation and live public DTOs in the target
deployment before marking runtime integration complete.

See [PostgreSQL view ownership and RLS](https://www.postgresql.org/docs/current/sql-createview.html)
and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## BE-03 job commands and expiry

`portal_runtime` may execute `portal_private.manage_job`; its former direct job
INSERT/draft UPDATE column grants are revoked. The command checks an admitted
session and locks the active staff profile, validates the version under a job row
lock, and writes the job, audit and outbox event together. ADMIN alone approves,
publishes and resumes. No runtime job-location/audit/outbox table writes are granted.

`portal_jobs_app` is a separately provisioned NOINHERIT login with only
`portal_jobs_worker`. It can execute only `close_expired_jobs(integer,uuid)` in the
private schema, without access to the portal tables or staff commands. Store its
connection as `JOBS_WORKER_DATABASE_URL`. The server verifies this membership and
rejects mixed/elevated logins before invocation.

`portal_jobs_owner` is the NOLOGIN, non-BYPASSRLS owner of these narrow functions;
it owns no application tables and receives explicit RLS policies. Never grant it
to a runtime/login/provider role. The legacy-settings data migration represents
existing metadata in draft/approved snapshots without changing public fields or
lifecycle versions. See the [Jobs runbook](../runbooks/jobs.md).

BE-04 extends the same boundary with owner-only normalization/validation helpers.
The restricted command independently enforces language content, raw input bounds,
salary precision, active references and UTC schedules. Runtime/public/worker
roles receive no helper EXECUTE or additional table privileges. Publication
promotes normalized settings atomically and preserves an existing publication
time when an immediate/null schedule accompanies an ordinary content edit.

## Recruitment write locking

`20261028000100_recruitment_lock_scope` uses a shared identity gate for ordinary
intake and stage changes, with per-request and sorted contact HMAC locks for
intake (all supplied key versions). Candidate insertion takes the same active
contact locks. Merge, identity update/delete, application reattachment/delete
and deletion-request writes retain the exclusive gate. Keep a shared overlapping
HMAC keyring across application instances during rotation. Existing command
validation, version/replay checks, ownership/grants and audit/outbox behavior are
retained. The migration refuses unexpected applied function definitions instead
of replacing an unknown lock implementation. Isolated SQL checks inspect actual
lock modes and command behavior; multi-session deployment acceptance is separate.
Run `npm run test:applications:locks`.

## BE-08 team access

`20261028000200_staff_provider_claims` replaces runtime access to the unfenced
completion helper with admitted-Admin-only claim/finish functions. A short
transaction commits an opaque claim and target profile version, then releases
the connection before Auth HTTP. Completion checks fresh admission, the exact
claim, target version and intended ban/unban state. Existing pending operations
block newer profile transitions. Provider rejection statuses 400/401/403/404/422/
429 may release a claim for retry; timeouts, transport errors, 5xx, abandoned
workers and uncertain completion retain it. Claims never expire automatically:
the provider has no fencing token. See the operator recovery notes in
[Team access](../runbooks/team.md). Deploy this migration and application
together after draining old reconciliation workers; older binaries cannot use
the revoked completion helper.

`portal.staff_profiles.version` advances when name/role/activation changes. The
runtime's former `change_staff` EXECUTE grant is revoked; it calls the Admin-only
`manage_team_change` wrapper with an expected version and request UUID. The wrapper
rechecks admitted Admin authority after taking the lifecycle lock, preserves
self/last-Admin safeguards, and commits profile changes, audit, outbox and safe
replay metadata together. A private RLS-protected command ledger has no runtime
or provider table grants. `pending_team_operations` exposes only bounded pending
operation references to an admitted Admin. No new role or login is introduced.
See [Team access](../runbooks/team.md).
