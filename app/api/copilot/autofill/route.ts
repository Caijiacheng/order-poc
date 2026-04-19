import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { runCopilotAutofill } from "@/lib/copilot/service";
import { copilotAutofillRequestSchema } from "@/lib/copilot/schemas";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const payload = copilotAutofillRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return apiError("VALIDATION_ERROR", "copilot autofill 参数不合法", 400, {
        payload: payload.error.issues[0]?.message ?? "参数不合法",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const result = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: payload.data.customerId,
      user_message: payload.data.message,
      images: payload.data.images,
      page_name: payload.data.pageName,
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
