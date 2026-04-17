import { apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { publishGenerationJob } from "@/lib/admin/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return apiSuccess(publishGenerationJob(id));
  } catch (error) {
    return handleRouteError(error);
  }
}
