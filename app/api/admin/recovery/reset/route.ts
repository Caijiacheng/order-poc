import { apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { resetDemoData } from "@/lib/admin/service";

export async function POST() {
  try {
    return apiSuccess(resetDemoData());
  } catch (error) {
    return handleRouteError(error);
  }
}
