import { apiSuccess } from "@/lib/admin/api-response";
import { parseListQuery } from "@/lib/admin/list-query";
import { handleRouteError } from "@/lib/admin/route-errors";
import { listRecommendationRecords } from "@/lib/admin/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = parseListQuery(searchParams);
    const data = listRecommendationRecords(query, {
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      customerId: searchParams.get("customerId") ?? undefined,
      scene: searchParams.get("scene") ?? undefined,
      surface: searchParams.get("surface") ?? undefined,
      generationMode: searchParams.get("generationMode") ?? undefined,
      skuId: searchParams.get("skuId") ?? undefined,
      adoptionStatus: searchParams.get("adoptionStatus") ?? undefined,
      modelName: searchParams.get("modelName") ?? undefined,
      batchId: searchParams.get("batchId") ?? undefined,
      strategyId: searchParams.get("strategyId") ?? undefined,
      expressionTemplateId: searchParams.get("expressionTemplateId") ?? undefined,
    });
    return apiSuccess(data, {
      query,
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
