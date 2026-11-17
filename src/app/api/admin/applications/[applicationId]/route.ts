import type { NextRequest } from "next/server";
import {
  recruitmentEndpoint,
  recruitmentBody,
} from "@/server/applications/http";
import {
  applicationDetails,
  changeApplicationStage,
} from "@/server/applications/service";
import { stageCommand } from "@/server/applications/contract";
import { notifyStageChange } from "@/server/applications/notify";
export const runtime = "nodejs";
type Context = { params: Promise<{ applicationId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return recruitmentEndpoint(request, false, async (identity) =>
    applicationDetails(identity, (await params).applicationId),
  );
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return recruitmentEndpoint(request, true, async (identity) => {
    const { applicationId } = await params;
    const body = await recruitmentBody(request);
    const changed = await changeApplicationStage(
      identity,
      applicationId,
      body,
    );
    // The stage change is already committed; a failed send is reported
    // back as `notified` rather than rolling back the stage move.
    // `body` already passed this same schema inside changeApplicationStage.
    let notified: Awaited<ReturnType<typeof notifyStageChange>> = "none";
    const parsed = stageCommand.safeParse(body);
    if (
      parsed.success &&
      (parsed.data.status === "REJECTED" ||
        parsed.data.status === "INTERVIEW" ||
        parsed.data.status === "OFFER")
    ) {
      try {
        notified = await notifyStageChange(
          identity,
          applicationId,
          parsed.data.status,
          parsed.data.interviewDetails,
          parsed.data.offerDetails,
        );
      } catch (error) {
        notified = "failed";
        console.error("application_notify_failed", {
          applicationId,
          stage: parsed.data.status,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return { ...changed, notified };
  });
}
