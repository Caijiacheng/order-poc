import { apiError, getErrorMessage } from "@/lib/admin/api-response";
import { AdminServiceError } from "@/lib/admin/service";

export function handleRouteError(error: unknown) {
  if (error instanceof AdminServiceError) {
    return apiError(error.code, error.message, error.status, error.fieldErrors);
  }
  return apiError("INTERNAL_ERROR", getErrorMessage(error), 500);
}
