import test from "node:test";
import assert from "node:assert/strict";
import { staffConfirmUrl } from "../../../src/server/auth/emailLinks.ts";
import {
  staffInviteEmail,
  staffPasswordResetEmail,
} from "../../../src/server/mail/staffEmails.ts";

const origin = "https://staff.example.test";
const tokenHash = "a".repeat(40);

// /auth/confirm only accepts ?token_hash=…&type=invite|recovery. A provider
// action_link instead redirects with #access_token=… which the page rejects as
// "invalid or expired", so emails must be built from the hashed token.
test("staff email links target the confirm page with a hashed token and no session fragment", () => {
  for (const type of ["invite", "recovery"]) {
    for (const lang of ["en", "zh"]) {
      const url = new URL(staffConfirmUrl(origin, tokenHash, type, lang));
      assert.equal(url.origin, origin);
      assert.equal(url.pathname, "/auth/confirm");
      assert.equal(url.searchParams.get("token_hash"), tokenHash);
      assert.equal(url.searchParams.get("type"), type);
      assert.equal(url.searchParams.get("lang"), lang);
      assert.equal(url.hash, "");
      // The same shape the confirm page validates.
      assert.match(url.searchParams.get("token_hash"), /^[a-z0-9_-]{32,256}$/i);
    }
  }
});

test("invite and reset emails carry the link, in both languages, with names escaped", () => {
  const link = staffConfirmUrl(origin, tokenHash, "invite", "en");
  for (const locale of ["en", "zh"]) {
    const invite = staffInviteEmail(
      locale,
      "new@example.test",
      '<b>Eve</b> & "Co"',
      link,
      origin,
    );
    assert.ok(invite.text.includes(link));
    assert.ok(invite.html.includes(link.replaceAll("&", "&amp;")));
    assert.ok(!invite.html.includes("<b>Eve</b>"));
    assert.ok(invite.html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
    assert.ok(!invite.html.includes("#access_token"));
    const reset = staffPasswordResetEmail(
      locale,
      "new@example.test",
      staffConfirmUrl(origin, tokenHash, "recovery", locale),
      origin,
    );
    assert.ok(reset.text.includes("type=recovery"));
  }
});
