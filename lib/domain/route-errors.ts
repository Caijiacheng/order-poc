import { apiError, getErrorMessage } from "@/lib/admin/api-response";
import { isBusinessError } from "@/lib/domain/errors";

export function handleBusinessRouteError(error: unknown) {
  if (isBusinessError(error)) {
    return apiError(error.code, error.message, error.status, error.fieldErrors);
  }
  return apiError("INTERNAL_ERROR", getErrorMessage(error), 500);
}
