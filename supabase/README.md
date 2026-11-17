# Staff authentication email setup

Supabase Auth owns password recovery and invitation delivery. Configure its
custom SMTP transport with Resend; the Next.js app continues to use Supabase's
CAPTCHA-protected recovery API. Store the Resend key as the SMTP password in
Supabase. No Resend key is bundled into the browser or committed here.

## Test with Resend's onboarding sender

In the **test** project's Authentication → Email → SMTP Settings, enable custom
SMTP and save:

| Setting      | Value                   |
| ------------ | ----------------------- |
| Sender email | `onboarding@resend.dev` |
| Sender name  | `Tricore Customer Care LLC Staff`       |
| Host         | `smtp.resend.com`       |
| Port         | `465` (implicit TLS)    |
| Username     | `resend`                |
| Password     | Your Resend API key     |

The onboarding sender can send real test messages only to the email address
associated with the Resend account. Use that address for the test Supabase Auth
user. A successful SMTP submission is not proof the message reached the inbox;
check Resend delivery status and the recipient's inbox/spam folder.

See [Resend SMTP settings](https://resend.com/docs/send-with-supabase-smtp) and
[onboarding recipient restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

## Callback and templates

1. Use the exact app origin as the Supabase **Site URL**, without a trailing
   slash. `npm.cmd run auth:dev:test` defaults to `http://127.0.0.1:3000` unless
   `.env.test` explicitly sets another loopback `AUTH_APP_ORIGIN`.
2. Allow that origin plus `/auth/confirm` under **Redirect URLs**. Open the app
   with the same hostname and port. Turnstile must allow that hostname too.
3. Under **Email Templates → Reset password**, use the contents of
   [templates/recovery.html](templates/recovery.html). Suggested subject:
   `Reset your Tricore Customer Care LLC staff password / 重置员工密码`.
4. Under **Email Templates → Invite user**, use
   [templates/invite.html](templates/invite.html). Suggested subject:
   `Set up your Tricore Customer Care LLC staff password / 设置员工密码`.
5. Keep the `{{ .RedirectTo }}` and `{{ .TokenHash }}` placeholders intact.
   The app sends a fixed `/auth/confirm` redirect, and the user confirms with a
   same-origin POST. Link previews and GET requests do not exchange the token.
   Send invitations through the staff API, which supplies this callback; any
   operator-issued invitation must specify the same callback URL.
6. Disable link tracking/rewriting for authentication emails. Configure hosting
   logs/analytics to omit callback query strings containing one-time credentials.

Do not use Supabase's default confirmation link with these custom callback
pages: it exchanges the token before the app receives its scoped password grant.
Keep public signup disabled. An invitation sets up a password; it does not
activate staff or grant an administrator role.

See [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates).

## Verify the complete recovery flow

1. Run `npm.cmd run auth:dev:test`; open `/admin/forgot-password` at the printed
   app origin. Enter the existing test staff email associated with Resend and
   complete Turnstile. Submit one recovery request.
2. Confirm delivery in Resend and the inbox. Follow the newest email and select
   **Continue with this email link**. Choose a new password of at least 12
   characters, confirm it, and save.
3. Confirm redirect to sign-in with the password-updated notice. Previous staff
   sessions must no longer access protected APIs. Sign in with the new password
   after any existing temporary login lock expires.
4. Reopening a used/expired link must offer a new recovery link. Rejected weak
   or reused passwords may be corrected while the grant remains valid. Concurrent
   submissions permit one provider write. A provider timeout requires a new link.

Automated Auth tests generate disposable provider links without sending email;
they do not replace this inbox/real-CAPTCHA check. `auth:verify` checks database
helpers and public Auth settings, not SMTP delivery or template configuration.

## Production

Use a domain you own and verify its Resend DNS records before sending to other
staff. The sending domain can differ from the website's `*.vercel.app` hostname.
Configure production SMTP, templates, Site URL and redirect allowlist separately.
Apply `20261021000200_password_recovery_completion` before deploying the matching
app, using the existing migration/operator process. Never copy test database
credentials into production. Keep the runtime database login restricted.

The recovery migration adds narrow private password operations, safe retry
handling and local session revocation. A successful reset does not clear an
active login lock or change the staff role/active flag. Global provider sign-out
is attempted in addition to the committed application-session cutoff.
