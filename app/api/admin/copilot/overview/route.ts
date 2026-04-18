import { apiSuccess } from "@/lib/admin/api-response";
import { handleRouteError } from "@/lib/admin/route-errors";
import { deriveCopilotMetrics } from "@/lib/copilot/metrics";
import { getMemoryStore } from "@/lib/memory/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageName = searchParams.get("pageName") ?? "";
    const status = searchParams.get("status") ?? "";
    const runType = searchParams.get("runType") ?? "";
    const customerId = searchParams.get("customerId") ?? "";
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    const limit = Math.max(
      1,
      Math.min(200, Number.parseInt(searchParams.get("limit") ?? "80", 10) || 80),
    );

    const store = getMemoryStore();
    const filteredRuns = [...store.copilotRuns]
      .filter((run) => (pageName ? run.page_name === pageName : true))
      .filter((run) => (status ? run.status === status : true))
      .filter((run) => (runType ? run.run_type === runType : true))
      .filter((run) => (customerId ? run.customer_id === customerId : true))
      .filter((run) => (dateFrom ? run.created_at >= dateFrom : true))
      .filter((run) => (dateTo ? run.created_at <= dateTo : true))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    const filteredRunIdSet = new Set(filteredRuns.map((run) => run.run_id));

    const filteredEvents = store.copilotMetricEvents.filter((event) => {
      if (dateFrom && event.timestamp < dateFrom) {
        return false;
      }
      if (dateTo && event.timestamp > dateTo) {
        return false;
      }
      if (customerId && event.customer_id !== customerId) {
        return false;
      }
      if (event.run_id) {
        return filteredRunIdSet.has(event.run_id);
      }
      if (pageName || status || runType) {
        return false;
      }
      return true;
    });

    const rows = filteredRuns.slice(0, limit).map((run) => {
      const job =
        run.job_id
          ? store.copilotJobs.find((item) => item.job_id === run.job_id) ?? null
          : null;
      const draft = job?.draft_id
        ? store.copilotDrafts.find((item) => item.draft_id === job.draft_id) ?? null
        : null;
      return {
        run,
        job,
        draft,
      };
    });

    return apiSuccess(
      {
        metrics: deriveCopilotMetrics(filteredEvents),
        total: filteredRuns.length,
        rows,
      },
      {
        langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
      },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
