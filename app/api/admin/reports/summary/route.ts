import { apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { getReportSummary } from "@/lib/admin/service";

export async function GET() {
  try {
    const data = getReportSummary();
    return apiSuccess(data);
  } catch (error) {
    return handleRouteError(error);
  }
}
