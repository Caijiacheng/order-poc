import { apiSuccess } from "@/lib/admin/api-response";
import { submitCart } from "@/lib/cart/service";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function POST() {
  try {
    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const result = await submitCart(sessionId);
    const response = apiSuccess(result, {
      session_id: sessionId,
      trace_id: result.summary.trace_id,
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
    if (shouldSetCookie) {
      setSessionCookie(response, sessionId);
    }
    return response;
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
