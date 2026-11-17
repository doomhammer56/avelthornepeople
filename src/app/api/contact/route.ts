import {
  receiveContactMessage,
  contactErrorResponse,
} from "@/server/contact/intake";
import { privateHeaders } from "@/server/auth/errors";

export async function POST(request: Request) {
  try {
    return Response.json(await receiveContactMessage(request), {
      status: 201,
      headers: privateHeaders,
    });
  } catch (error) {
    return contactErrorResponse(error);
  }
}
