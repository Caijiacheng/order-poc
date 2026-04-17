import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  archiveRecoverySnapshot,
  getRecoverySnapshotById,
  updateRecoverySnapshot,
} from "@/lib/admin/service";
import { validateRecoverySnapshotInput } from "@/lib/admin/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getRecoverySnapshotById(id);
    if (!data) {
      return apiError("NOT_FOUND", "恢复快照不存在", 404);
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
    const validation = validateRecoverySnapshotInput(payload, "update");
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    return apiSuccess(updateRecoverySnapshot(id, validation.value));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return apiSuccess(archiveRecoverySnapshot(id));
  } catch (error) {
    return handleRouteError(error);
  }
}
