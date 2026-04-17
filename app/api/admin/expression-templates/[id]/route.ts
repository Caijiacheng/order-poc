import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  getExpressionTemplateById,
  softDeleteExpressionTemplate,
  updateExpressionTemplate,
} from "@/lib/admin/service";
import { validateExpressionTemplateInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getExpressionTemplateById(id);
    if (!data) {
      return apiError("NOT_FOUND", "表达模板不存在", 404);
    }
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const payload = await request.json();
    const validation = validateExpressionTemplateInput(payload, "update");
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    const data = updateExpressionTemplate(id, validation.value);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = softDeleteExpressionTemplate(id);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
