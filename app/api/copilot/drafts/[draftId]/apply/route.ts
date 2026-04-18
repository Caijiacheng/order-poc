import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { applyCopilotDraft } from "@/lib/copilot/service";
import { copilotApplyDraftRequestSchema } from "@/lib/copilot/schemas";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

type Params = { params: Promise<{ draftId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { draftId } = await params;
    const payload = copilotApplyDraftRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return apiError("VALIDATION_ERROR", "copilot apply 参数不合法", 400, {
        payload: payload.error.issues[0]?.message ?? "参数不合法",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const result = await applyCopilotDraft({
      draft_id: draftId,
      session_id: sessionId,
      customer_id: payload.data.customerId,
    });

    const response = apiSuccess(result, {
      session_id: sessionId,
      trace_id: result.run.trace_id,
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
