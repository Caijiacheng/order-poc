import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  getDealerSegmentById,
  softDeleteDealerSegment,
  updateDealerSegment,
} from "@/lib/admin/service";
import { validateDealerSegmentInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getDealerSegmentById(id);
    if (!data) {
      return apiError("NOT_FOUND", "分群不存在", 404);
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
    const validation = validateDealerSegmentInput(payload, "update");
    if (!validation.valid) {
      return apiError(
        "VALIDATION_ERROR",
        "参数校验失败",
        400,
        validation.fieldErrors,
      );
    }
    const data = updateDealerSegment(id, validation.value);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = softDeleteDealerSegment(id);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
