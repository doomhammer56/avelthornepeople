# Database migrations

`schema.prisma` defines the models. `migrations/` also owns SQL checks, triggers, access controls and indexes. Supabase owns `auth`; application migrations own `portal`.

For private CV buckets, Storage API credentials, policy setup and signed access,
see the [Storage-01 runbook](STORAGE.md). Storage policies are deployed separately
from Prisma's application-table migrations.

## Deploy

Pushing Git changes does not apply migrations. Until a release pipeline is configured, one release owner runs deployment from the reviewed commit before releasing the application.

Set `DIRECT_URL` for the intended Supabase environment through the release environment or an ignored `.env`. Use a direct connection or the session pooler on port 5432 with migration credentials. Keep the migration connection separate from the application's runtime `DATABASE_URL`.

For production, confirm the project and backup/restore readiness before applying SQL. Install development dependencies because they include the pinned Prisma CLI.

```sh
npm ci --include=dev
npm run db:validate
npm run db:deploy
npm run db:status
```

`db:deploy` applies pending migration directories in order and records them in `_prisma_migrations`. Running it again applies nothing when the database is current. It does not generate the client or check all schema drift.

Generate the client in the application build:

```sh
npm run db:generate
npm run build
```

The DB-01 baseline contains six migrations. DB-02 adds a separate roles/RLS migration; use `db:status` to check each environment before release. A fresh Supabase project receives them through the same deployment command. Run `npm run test:db` only against the dedicated test database, with `TEST_STAFF_USER_ID` pointing to its test identity. See the [database access contract](ACCESS.md) for public/staff connection boundaries, permissions and transactional RLS preview testing.

## Changes and recovery

### Shared job settings lock

Apply `20261029000100_job_settings_lock` before releasing the updated job editor.
It locks existing complete settings; incomplete drafts remain editable. The first
successful save with Department, Location, Job type and Experience filled in
freezes all Page 2 fields, including URL slug, salary and schedule, across languages.
Translations remain editable under the existing permissions and lifecycle rules.

The database owns `settings_locked` and rejects settings changes inside the
version-checked job command. Publication can still resolve an empty publication
date to the current time. Duplicated jobs start unlocked with an empty schedule
and lock when complete settings are saved or submitted.

The migration preserves the current draft, including pending settings changes.
Review those pending changes before rollout if needed. Validate with
`npm run test:jobs`, `npm run test:jobs:languages`, and `npm run test:jobs:editor`.

### Migration policy

`20261029000200_job_settings_lock_validation` fixes the save rules without
changing the settings-lock migration history. Complete settings with an expired
closing date are rejected before locking. Locked, unchanged references allow
translation draft saves after reference deactivation; submission and publication
still require active references. A previously locked job whose closing date has
passed can be duplicated to configure a new posting with a new schedule.

For a failed `20261029000100_job_settings_lock` attempt with no `settings_locked`
column or `job_settings_complete(jsonb)` function left in the target database,
use the corrected migration with its temporary schema CREATE grant. After
checking that the failed transaction has rolled back, recover with:

```sh
npx prisma migrate resolve --rolled-back 20261029000100_job_settings_lock
npm run db:deploy
npm run db:status
```

The resolve command updates migration history; deployment then executes the SQL.
Do not mark this migration applied while its schema changes are missing.
The isolated `tests/integration/jobs/settings-lock-migration.test.mjs` verifies
deployment as a non-superuser and removal of the temporary schema privilege.

- Create new migrations for schema changes. Preserve applied migration files, names and checksums.
- Use `migrate dev` only with disposable development/shadow databases. Never use `db push` or `migrate reset` to deploy.
- Review generated SQL for managed Auth changes. Update `external-auth.json` when the provider catalog changes; `shadow-auth.sql` is a development fixture and must not be deployed to Supabase.
- Keep the same migration owner across releases so ownership and default privileges remain consistent. DB-02 defines application runtime grants and RLS policies; provision its separate login credentials and verify application integration before rollout. Never transfer public views to a privileged owner.
- If deployment fails, stop the application release, inspect migration history and fix forward with reviewed SQL. Use `migrate resolve` only after reconciling the actual database state; never use it to skip failed SQL.

For future automation, use one serialized release job per environment with protected database credentials. Keep migration deployment out of preview builds.

[Prisma deployment behavior](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production) · [Supabase connection modes](https://supabase.com/docs/guides/database/prisma)
