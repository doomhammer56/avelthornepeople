# QA-01: Admin publishing sync

Date: 2026-10-30  
Status: **COMPLETE**  
Requirement: Admin publishing state changes reach the public site within 60 seconds.

## Results

- **15 E2E checks passed; 0 failures.** Real authenticated admin requests, restricted database connections, public APIs, and EN/ZH server-rendered pages were exercised through the existing local production build and guarded Supabase test project.
- **46 timed observations passed.** URLs were warmed before each mutation. Every public response shared a hard 60-second deadline starting when the successful admin response arrived, including response-body reads.
- **4 helper tests passed:** stale-response retries, deadline enforcement, acknowledgement-based timing, and safe content-slot restoration/concurrent-edit protection.
- Targeted ESLint, Prettier, and Git whitespace checks passed.

| Transition                                     | Slowest public API | Slowest EN/ZH page |
| ---------------------------------------------- | -----------------: | -----------------: |
| Job publish / republish                        |            0.840 s |            1.779 s |
| Job pause                                      |            0.684 s |            1.466 s |
| Job resume                                     |            1.023 s |            1.806 s |
| Job close                                      |            0.625 s |            1.430 s |
| Content publish / republish / Chinese fallback |            0.819 s |            1.492 s |
| Content unpublish                              |            0.983 s |            1.500 s |

Draft isolation, permissions, conflicts, image privacy, other content sections, and expiry checks also passed. All six original managed content rows were restored and verified exactly, including timestamps; synthetic fixtures were cleaned up.

## Manual sign-off and scope

The user confirmed their manual browser check showed all updates working. Automated timing covers API responses and server-rendered HTML; browser auto-refresh confirmation is user-provided, with no separate browser timing recorded. No automated production-deployment run is claimed.

## Repeat the checks

Requires a production build and configured `.env.test`:

```powershell
npm.cmd run test:publishing
npm.cmd run test:publishing:e2e -- --park-managed-test-content
```

Keep the QA project idle during E2E. The explicit parking option temporarily frees managed slots, backs up originals under `.cache/qa01/`, and restores/verifies them after fixture cleanup. Without that option, the original managed-content safeguard remains enabled.

Detailed run evidence: `.cache/qa01/publishing-test.log` (local, ignored by Git). Application code and environment files were unchanged for QA-01.

# Compliance-01: retention and candidate deletion

Date: 2026-10-31

Status: **Backend implemented and tested; production activation and jurisdiction confirmation remain.**

- Configurable 1–24 month recruitment retention, immutable application deadlines, expiry enforcement, and policy history that prevents expired records reappearing after a policy change.
- Candidate receipt-based request intake and ADMIN registration/verification/rejection, calendar-month response deadlines, legal holds, and overdue tracking.
- Separate, restricted cleanup worker with leases/retries. Verifies quarantine and clean CV removal before deleting application data and candidate aliases; scrubs related references and retains bounded, minimal evidence.
- ADMIN-only APIs, private responses, CSRF/rate-limit protections, idempotency/version checks, and EN/ZH audit labels.
- Validation: **89 unit/integration/regression checks, 1 hosted rollback migration check, and 1 built-API access check passed.** Production build, TypeScript, Prisma validation, targeted ESLint and formatting checks passed.

Combined run evidence: `.cache/privacy/tests.log` (91 passed; 0 failed).

Automatic age-based destruction defaults to disabled. The hosted migration test rolled back all changes; no existing candidate records or stored CVs were erased. Apply the migration, configure `PRIVACY_WORKER_DATABASE_URL`, and review/enable the policy for rollout. Details and request examples: [PRIVACY.md](PRIVACY.md).

ZH language does not establish the applicable PDPA. Confirm jurisdiction and the controller's backup, recipient/export, privacy-contact and legal-exception procedures before legal compliance sign-off. Automated Storage tests use a test adapter; production erasure was not exercised.

## Follow-up: dashboard permission repair (2026-11-02)

Reproduced the dashboard failure against the database configured in `.env`: SQLSTATE `42501`, permission denied for `candidate_group_blocked`. Added a separate migration granting the privacy definer EXECUTE as the legacy function's owner. All 13 isolated privacy integration tests passed, including a regression that reproduces the missing permission and verifies restored application/candidate reads while worker access remains restricted. Apply the repair migration to the affected database; production repair has not been applied by this check.
