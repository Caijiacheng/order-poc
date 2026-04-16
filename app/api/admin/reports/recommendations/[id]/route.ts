import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { getRecommendationRunDetail } from "@/lib/admin/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = getRecommendationRunDetail(id);
    if (!data) {
      return apiError("NOT_FOUND", "推荐批次不存在", 404);
    }
    return apiSuccess(data, {
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
