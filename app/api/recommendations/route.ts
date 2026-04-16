import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { generateRecommendationsForCustomer } from "@/lib/domain/business-service";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const payload = (await request.json()) as {
      customerId?: string;
      triggerSource?: "auto" | "manual" | "assistant";
      pageName?: "/procurement" | "/catalog" | "/basket";
    };

    if (!payload.customerId) {
      return apiError("VALIDATION_ERROR", "customerId 不能为空", 400, {
        customerId: "customerId 不能为空",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const data = await generateRecommendationsForCustomer({
      session_id: sessionId,
      customer_id: payload.customerId,
      trigger_source: payload.triggerSource,
      page_name: payload.pageName,
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
