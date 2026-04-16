import { apiSuccess } from "@/lib/admin/api-response";
import { addCartItem, setCartCustomer } from "@/lib/cart/service";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sku_id?: string;
      skuId?: string;
      qty?: number;
      quantity?: number;
      source?: "manual" | "recommendation";
      customerId?: string;
      recommendation_item_id?: string;
      recommendationItemId?: string;
      lifecycle_action?: "apply" | "ignore" | "reject";
      lifecycleAction?: "apply" | "ignore" | "reject";
      rejected_reason?: string;
      rejectedReason?: string;
    };
    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    if (payload.customerId) {
      setCartCustomer(sessionId, payload.customerId);
    }

    const result = addCartItem({
      session_id: sessionId,
      sku_id: payload.sku_id ?? payload.skuId,
      qty: Number(payload.qty ?? payload.quantity),
      source: payload.source,
      recommendation_item_id:
        payload.recommendation_item_id ?? payload.recommendationItemId,
      lifecycle_action: payload.lifecycle_action ?? payload.lifecycleAction,
      rejected_reason: payload.rejected_reason ?? payload.rejectedReason,
    });

    const response = apiSuccess(result, { session_id: sessionId });
    if (shouldSetCookie) {
      setSessionCookie(response, sessionId);
    }
    return response;
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
