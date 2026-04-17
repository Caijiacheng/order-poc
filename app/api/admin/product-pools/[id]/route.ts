import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  getProductPoolById,
  softDeleteProductPool,
  updateProductPool,
} from "@/lib/admin/service";
import { validateProductPoolInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getProductPoolById(id);
    if (!data) {
      return apiError("NOT_FOUND", "商品池不存在", 404);
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
    const validation = validateProductPoolInput(payload, "update");
    if (!validation.valid) {
      return apiError(
        "VALIDATION_ERROR",
        "参数校验失败",
        400,
        validation.fieldErrors,
      );
    }
    const data = updateProductPool(id, validation.value);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = softDeleteProductPool(id);
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
