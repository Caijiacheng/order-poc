import { apiSuccess } from "@/lib/admin/api-response";
import { getCartBySession } from "@/lib/cart/service";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function GET() {
  try {
    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const cart = getCartBySession(sessionId);
    const response = apiSuccess(cart, { session_id: sessionId });
    if (shouldSetCookie) {
      setSessionCookie(response, sessionId);
    }
    return response;
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
