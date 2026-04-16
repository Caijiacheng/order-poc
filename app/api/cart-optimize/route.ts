import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { generateCartOptimizationForSession } from "@/lib/domain/business-service";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const payload = (await request.json()) as {
      customerId?: string;
      cartItems?: Array<{ sku_id?: string; skuId?: string; qty?: number; quantity?: number }>;
    };

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const cartItems = payload.cartItems?.map((item) => ({
      sku_id: item.sku_id ?? item.skuId ?? "",
      qty: Number(item.qty ?? item.quantity ?? 0),
    }));

    if (cartItems && cartItems.some((item) => !item.sku_id || item.qty <= 0)) {
      return apiError("VALIDATION_ERROR", "cartItems 参数不合法", 400, {
        cartItems: "cartItems 内每条记录需要合法 sku_id 与 qty>0",
      });
    }

    const data = await generateCartOptimizationForSession({
      session_id: sessionId,
      customer_id: payload.customerId,
      cart_items: cartItems,
    });

    const response = apiSuccess(data, {
      session_id: sessionId,
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
