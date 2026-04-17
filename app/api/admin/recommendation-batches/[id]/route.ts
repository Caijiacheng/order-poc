import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  getRecommendationBatchById,
  updateRecommendationBatch,
} from "@/lib/admin/service";
import { validateRecommendationBatchInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getRecommendationBatchById(id);
    if (!data) {
      return apiError("NOT_FOUND", "建议单批次不存在", 404);
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
    const validation = validateRecommendationBatchInput(payload, "update");
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    return apiSuccess(updateRecommendationBatch(id, validation.value));
  } catch (error) {
    return handleRouteError(error);
  }
}
