import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { getCopilotJobDetail } from "@/lib/copilot/service";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const data = getCopilotJobDetail(jobId);
    if (!data) {
      return apiError("NOT_FOUND", "Copilot 作业不存在", 404);
    }

    return apiSuccess(data, {
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
