import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { getRules, updateRules } from "@/lib/admin/service";
import { validateRulesInput } from "@/lib/admin/validation";

export async function GET() {
  try {
    const data = getRules();
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json();
    const validation = validateRulesInput(payload);
    if (!validation.valid) {
      return apiError(
        "VALIDATION_ERROR",
        "参数校验失败",
        400,
        validation.fieldErrors,
      );
    }
    const data = updateRules(validation.value);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
