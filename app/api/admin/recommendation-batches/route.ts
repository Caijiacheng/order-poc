import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { parseListQuery } from "@/lib/admin/list-query";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  createRecommendationBatch,
  listRecommendationBatches,
} from "@/lib/admin/service";
import { validateRecommendationBatchInput } from "@/lib/admin/validation";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = parseListQuery(searchParams);
    const data = listRecommendationBatches(query, {
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      jobId: searchParams.get("jobId") ?? undefined,
      customerId: searchParams.get("customerId") ?? undefined,
      scene: searchParams.get("scene") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      publicationStatus: searchParams.get("publicationStatus") ?? undefined,
      triggerSource: searchParams.get("triggerSource") ?? undefined,
      batchType: searchParams.get("batchType") ?? undefined,
    });
    return apiSuccess(data, { query });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const validation = validateRecommendationBatchInput(payload, "create");
    if (!validation.valid) {
      return apiError("VALIDATION_ERROR", "参数校验失败", 400, validation.fieldErrors);
    }
    return apiSuccess(createRecommendationBatch(validation.value), {}, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
