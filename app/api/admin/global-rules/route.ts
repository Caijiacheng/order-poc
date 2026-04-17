import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { getGlobalRules, updateGlobalRules } from "@/lib/admin/service";
import { validateGlobalRulesInput } from "@/lib/admin/validation";

export async function GET() {
  try {
    return apiSuccess(getGlobalRules());
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    const validation = validateGlobalRulesInput(payload);
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    return apiSuccess(updateGlobalRules(validation.value));
  } catch (error) {
    return handleRouteError(error);
  }
}
