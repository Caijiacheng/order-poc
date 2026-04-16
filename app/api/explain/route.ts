import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { generateExplanationForItems } from "@/lib/domain/business-service";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";
import type { SuggestionScene } from "@/lib/memory/types";

const VALID_SCENES = new Set<SuggestionScene>([
  "daily_recommendation",
  "weekly_focus",
  "threshold_topup",
  "box_pair_optimization",
]);

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const payload = (await request.json()) as {
      customerId?: string;
      scene?: SuggestionScene;
      targetItemIds?: string[];
    };

    if (!payload.customerId) {
      return apiError("VALIDATION_ERROR", "customerId 不能为空", 400, {
        customerId: "customerId 不能为空",
      });
    }
    if (!payload.scene || !VALID_SCENES.has(payload.scene)) {
      return apiError("VALIDATION_ERROR", "scene 不合法", 400, {
        scene: "scene 不合法",
      });
    }
    if (!Array.isArray(payload.targetItemIds) || payload.targetItemIds.length === 0) {
      return apiError("VALIDATION_ERROR", "targetItemIds 不能为空", 400, {
        targetItemIds: "targetItemIds 不能为空",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const data = await generateExplanationForItems({
      session_id: sessionId,
      customer_id: payload.customerId,
      scene: payload.scene,
      target_sku_ids: payload.targetItemIds,
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
