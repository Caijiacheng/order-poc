import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { getPublishedSuggestionsForCustomer } from "@/lib/admin/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId")?.trim() ?? "";
    if (!customerId) {
      return apiError("VALIDATION_ERROR", "customerId 不能为空", 400, {
        customerId: "customerId 不能为空",
      });
    }
    return apiSuccess(getPublishedSuggestionsForCustomer(customerId));
  } catch (error) {
    return handleRouteError(error);
  }
}
