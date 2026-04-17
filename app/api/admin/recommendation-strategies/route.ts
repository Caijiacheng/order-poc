import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { parseListQuery } from "@/lib/admin/list-query";
import { handleRouteError } from "@/lib/admin/route-errors";
import {
  createRecommendationStrategy,
  listRecommendationStrategies,
} from "@/lib/admin/service";
import { validateRecommendationStrategyInput } from "@/lib/admin/validation";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = parseListQuery(searchParams);
    const data = listRecommendationStrategies(query);
    return apiSuccess(data, { query });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const validation = validateRecommendationStrategyInput(payload, "create");
    if (!validation.valid) {
      return apiError(
        "VALIDATION_ERROR",
        "参数校验失败",
        400,
        validation.fieldErrors,
      );
    }
    const data = createRecommendationStrategy(validation.value);
    return apiSuccess(data, {}, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
