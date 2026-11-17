import "server-only";

type EmailLocale = "en" | "zh";
type Email = { subject: string; html: string; text: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Branded staff email shell using the site's design tokens (navy, teal, gold, ivory).
// Logo served from the app origin as an absolute URL so email clients can load it.
function staffLayout(
  origin: string,
  preheader: string,
  bodyHtml: string,
  footerHtml: string,
) {
  const logoUrl = `${origin}/brand/icon-180.png`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ebe5db;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#061722;">
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ebe5db;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

          <!-- Brand header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="${logoUrl}" width="44" height="44" alt="" style="display:block;border-radius:8px;margin:0 auto 10px;" />
              <span style="display:block;font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:#17545b;">Avelthorne People Group</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:10px;border:1px solid #d9d2c5;overflow:hidden;">

              <!-- Gold accent stripe -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:3px;background:linear-gradient(90deg,#b79761 0%,#d4b17a 100%);"></td></tr>
              </table>

              <!-- Body -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px 36px 28px;font-size:15px;line-height:1.75;color:#061722;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>

              <!-- Divider + footer -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 36px;"><div style="height:1px;background:#ebe5db;"></div></td>
                </tr>
                <tr>
                  <td style="padding:20px 36px 28px;font-size:12px;line-height:1.6;color:#7c808a;">
                    ${footerHtml}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const p = (html: string) => `<p style="margin:0 0 16px;">${html}</p>`;

function ctaButton(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:#17545b;border-radius:6px;">
        <a href="${url}" target="_blank" rel="noopener"
           style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">${label}</a>
      </td>
    </tr>
  </table>`;
}

export function staffPasswordResetEmail(
  locale: EmailLocale,
  recipientEmail: string,
  resetUrl: string,
  origin: string,
): Email {
  const safeEmail = escapeHtml(recipientEmail);
  const safeUrl = escapeHtml(resetUrl);

  if (locale === "zh") {
    const body =
      p("您好，") +
      p("管理员已为您的员工账号发起了密码重置请求。请点击下方按钮设置新密码。此链接 <strong>24 小时内</strong>有效，且只能使用一次。") +
      ctaButton("重置密码", safeUrl) +
      p(`如果您无法点击按钮，请将以下链接复制到浏览器：<br><span style="font-size:12px;color:#7c808a;word-break:break-all;">${safeUrl}</span>`) +
      p('<span style="font-size:13px;color:#7c808a;">如非本人操作，请忽略此邮件，或联系系统管理员。请勿将此链接分享给他人。</span>');
    return {
      subject: "员工账号密码重置",
      html: staffLayout(
        origin,
        "重置您的员工账号密码",
        body,
        `Avelthorne People Group 员工控制台 · 此邮件发送至 ${safeEmail}`,
      ),
      text: `您好，\n\n管理员已为您的员工账号发起了密码重置请求。请访问以下链接设置新密码（24小时内有效，仅可使用一次）：\n\n${resetUrl}\n\n如非本人操作，请忽略此邮件。\n\nAvelthorne People Group 员工控制台`,
    };
  }

  const body =
    p("Hi,") +
    p("An administrator has requested a password reset for your staff account. Click the button below to choose a new password. This link is valid for <strong>24 hours</strong> and can only be used once.") +
    ctaButton("Reset password", safeUrl) +
    p(`If the button doesn't work, copy this link into your browser:<br><span style="font-size:12px;color:#7c808a;word-break:break-all;">${safeUrl}</span>`) +
    p('<span style="font-size:13px;color:#7c808a;">If you didn\'t expect this, you can ignore this email or contact your system administrator. Do not share this link.</span>');

  return {
    subject: "Staff account password reset",
    html: staffLayout(
      origin,
      "Reset your staff account password",
      body,
      `Avelthorne People Group Staff Console · This email was sent to ${safeEmail}`,
    ),
    text: `Hi,\n\nAn administrator has requested a password reset for your staff account. Visit the link below to choose a new password (valid for 24 hours, single use only):\n\n${resetUrl}\n\nIf you didn't expect this, you can ignore this email.\n\nAvelthorne People Group Staff Console`,
  };
}

export function staffInviteEmail(
  locale: EmailLocale,
  recipientEmail: string,
  displayName: string,
  setupUrl: string,
  origin: string,
): Email {
  const safeEmail = escapeHtml(recipientEmail);
  const safeUrl = escapeHtml(setupUrl);
  const safeName = escapeHtml(displayName);

  if (locale === "zh") {
    const body =
      p(`${safeName}，您好，`) +
      p("您已被邀请加入 Avelthorne People Group 员工控制台。请点击下方按钮设置登录密码。此链接有效时间有限，且只能使用一次。") +
      ctaButton("设置密码", safeUrl) +
      p(`如果您无法点击按钮，请将以下链接复制到浏览器：<br><span style="font-size:12px;color:#7c808a;word-break:break-all;">${safeUrl}</span>`) +
      p('<span style="font-size:13px;color:#7c808a;">如非本人预期，请忽略此邮件，或联系系统管理员。请勿将此链接分享给他人。</span>');
    return {
      subject: "设置您的员工账号密码",
      html: staffLayout(
        origin,
        "您已被邀请加入员工控制台",
        body,
        `Avelthorne People Group 员工控制台 · 此邮件发送至 ${safeEmail}`,
      ),
      text: `${displayName}，您好，\n\n您已被邀请加入 Avelthorne People Group 员工控制台。请访问以下链接设置密码（有效时间有限，仅可使用一次）：\n\n${setupUrl}\n\n如非本人预期，请忽略此邮件。\n\nAvelthorne People Group 员工控制台`,
    };
  }

  const body =
    p(`Hi ${safeName},`) +
    p("You have been invited to the Avelthorne People Group staff console. Click the button below to choose your password. This link is valid for a limited time and can only be used once.") +
    ctaButton("Set up password", safeUrl) +
    p(`If the button doesn't work, copy this link into your browser:<br><span style="font-size:12px;color:#7c808a;word-break:break-all;">${safeUrl}</span>`) +
    p('<span style="font-size:13px;color:#7c808a;">If you weren\'t expecting this, you can ignore this email or contact your system administrator. Do not share this link.</span>');

  return {
    subject: "Set up your staff account password",
    html: staffLayout(
      origin,
      "You've been invited to the staff console",
      body,
      `Avelthorne People Group Staff Console · This email was sent to ${safeEmail}`,
    ),
    text: `Hi ${displayName},\n\nYou have been invited to the Avelthorne People Group staff console. Visit the link below to choose your password (valid for a limited time, single use only):\n\n${setupUrl}\n\nIf you weren't expecting this, you can ignore this email.\n\nAvelthorne People Group Staff Console`,
  };
}
