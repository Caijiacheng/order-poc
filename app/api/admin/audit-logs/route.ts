import { apiSuccess } from "@/lib/admin/api-response";
import { parseListQuery } from "@/lib/admin/list-query";
import { handleRouteError } from "@/lib/admin/route-errors";
import { listAuditLogs } from "@/lib/admin/service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = parseListQuery(searchParams);
    const data = listAuditLogs(query);
    return apiSuccess(data, { query });
  } catch (error) {
    return handleRouteError(error);
  }
}
