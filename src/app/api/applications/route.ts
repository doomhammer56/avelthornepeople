import {
  receiveApplication,
  intakeErrorResponse,
} from "@/server/applications/intake";
import { privateHeaders } from "@/server/auth/errors";

export async function POST(request: Request) {
  try {
    return Response.json(await receiveApplication(request), {
      status: 201,
      headers: privateHeaders,
    });
  } catch (error) {
    return intakeErrorResponse(error);
  }
}
