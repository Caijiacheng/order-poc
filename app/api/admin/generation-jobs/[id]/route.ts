import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  cancelGenerationJob,
  getGenerationJobById,
  updateGenerationJob,
} from "@/lib/admin/service";
import { validateGenerationJobInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getGenerationJobById(id);
    if (!data) {
      return apiError("NOT_FOUND", "生成任务不存在", 404);
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
    const validation = validateGenerationJobInput(payload, "update");
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    return apiSuccess(updateGenerationJob(id, validation.value));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return apiSuccess(cancelGenerationJob(id));
  } catch (error) {
    return handleRouteError(error);
  }
}
