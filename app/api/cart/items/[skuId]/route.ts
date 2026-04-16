import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { patchCartItem, removeCartItem } from "@/lib/cart/service";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

type Params = { params: Promise<{ skuId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      qty?: number;
      quantity?: number;
      recommendation_item_id?: string;
      recommendationItemId?: string;
    };
    const qty = Number(payload.qty ?? payload.quantity);
    if (!Number.isFinite(qty)) {
      return apiError("VALIDATION_ERROR", "qty 参数不合法", 400, {
        qty: "qty 参数不合法",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const { skuId } = await params;
    const result = patchCartItem({
      session_id: sessionId,
      sku_id: skuId,
      qty,
      recommendation_item_id:
        payload.recommendation_item_id ?? payload.recommendationItemId,
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

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const { skuId } = await params;
    const result = removeCartItem({
      session_id: sessionId,
      sku_id: skuId,
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
