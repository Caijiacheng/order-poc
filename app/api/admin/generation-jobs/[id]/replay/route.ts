import { apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { replayGenerationJob } from "@/lib/admin/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    assertLlmAvailable();
    const { id } = await params;
    return apiSuccess(await replayGenerationJob(id));
  } catch (error) {
    return handleRouteError(error);
  }
}
