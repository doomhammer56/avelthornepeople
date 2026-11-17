import type { NextRequest } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "@/server/auth/middleware";
import { authAdminClient } from "@/server/adapters/auth/admin";
import { appOrigin } from "@/server/adapters/auth/config";
import { sendMail } from "@/server/mail/transport";
import { staffPasswordResetEmail } from "@/server/mail/staffEmails";
import { staffConfirmUrl } from "@/server/auth/emailLinks";
import { StaffAuthError } from "@/server/auth/errors";
import { authErrorResponse } from "@/server/auth/errors";

export const runtime = "nodejs";

type Context = { params: Promise<{ userId: string }> };

export function POST(request: NextRequest, { params }: Context) {
  return staffEndpoint(
    request,
    "team.manage",
    async () => {
      const { userId } = await params;
      if (!z.uuid().safeParse(userId).success) throw new StaffAuthError(400);

      const admin = authAdminClient();

      const { data: userData, error: userError } =
        await admin.auth.admin.getUserById(userId);
      if (userError || !userData?.user?.email) throw new StaffAuthError(400);

      const email = userData.user.email;
      const origin = appOrigin();

      const { data: linkData, error: linkError } =
        await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${origin}/auth/confirm` },
        });
      if (linkError || !linkData?.properties?.hashed_token)
        throw new StaffAuthError(503);

      const lang =
        request.nextUrl.searchParams.get("lang") === "zh" ? "zh" : "en";
      // Link to the app's confirm page with the hashed token. The provider's
      // own action_link redirects with the session in the URL fragment, which
      // the confirm page rejects as "invalid or expired".
      const mail = staffPasswordResetEmail(
        lang,
        email,
        staffConfirmUrl(
          origin,
          linkData.properties.hashed_token,
          "recovery",
          lang,
        ),
        origin,
      );

      await sendMail({ to: email, ...mail });

      return Response.json({ sent: true });
    },
    { write: true, errorResponse: authErrorResponse },
  );
}
