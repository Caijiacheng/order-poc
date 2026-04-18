import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { submitCart } from "../../lib/cart/service";
import { applyCopilotDraft, runCopilotAutofill } from "../../lib/copilot/service";
import { deriveCopilotMetrics } from "../../lib/copilot/metrics";
import { getMemoryStore } from "../../lib/memory/store";
import { GET } from "../../app/api/admin/copilot/overview/route";
import {
  captureLlmEnv,
  resetRuntimeState,
  restoreLlmEnv,
  setMockLlmEnv,
} from "../helpers/runtime";

type CopilotOverviewPayload = {
  success: true;
  data: {
    metrics: ReturnType<typeof deriveCopilotMetrics>;
    total: number;
    rows: Array<{
      run: {
        run_id: string;
        page_name: "/purchase" | "/order-submit";
        status: "running" | "succeeded" | "blocked" | "failed";
        run_type: "autofill_order" | "explain_order";
        customer_id: string;
      };
      job: {
        job_id: string;
      } | null;
      draft: {
        draft_id: string;
      } | null;
    }>;
  };
};

async function fetchCopilotOverview(searchParams: URLSearchParams) {
  const url = `http://localhost/api/admin/copilot/overview?${searchParams.toString()}`;
  const response = await GET(new Request(url));
  expect(response.status).toBe(200);
  const payload = (await response.json()) as CopilotOverviewPayload;
  expect(payload.success).toBe(true);
  return payload;
}

async function seedCopilotRuns() {
  const purchaseSucceededSessionId = "sess_copilot_overview_purchase_succeeded";
  const purchaseSucceeded = await runCopilotAutofill({
    session_id: purchaseSucceededSessionId,
    customer_id: "dealer_xm_sm",
    user_message: "帮我按常购和活动做一单，偏保守",
    page_name: "/purchase",
  });
  await applyCopilotDraft({
    draft_id: purchaseSucceeded.draft.draft_id,
    session_id: purchaseSucceededSessionId,
    customer_id: "dealer_xm_sm",
  });
  await submitCart(purchaseSucceededSessionId);

  const purchaseBlocked = await runCopilotAutofill({
    session_id: "sess_copilot_overview_purchase_blocked",
    customer_id: "dealer_xm_sm",
    user_message: "不要厨邦，帮我做单",
    page_name: "/purchase",
  });

  const orderSubmitSucceeded = await runCopilotAutofill({
    session_id: "sess_copilot_overview_order_submit",
    customer_id: "dealer_cd_pf",
    user_message: "继续安全补齐，优先活动门槛",
    page_name: "/order-submit",
  });

  return {
    purchaseSucceededRunId: purchaseSucceeded.run.run_id,
    purchaseBlockedRunId: purchaseBlocked.run.run_id,
    orderSubmitSucceededRunId: orderSubmitSucceeded.run.run_id,
  };
}

describe.sequential("copilot admin overview route", () => {
  let envSnapshot: ReturnType<typeof captureLlmEnv>;

  beforeEach(() => {
    envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-copilot-overview");
    resetRuntimeState();
  });

  afterEach(() => {
    restoreLlmEnv(envSnapshot);
  });

  it("returns unfiltered totals and KPI metrics from full copilot dataset", async () => {
    const seeded = await seedCopilotRuns();
    const payload = await fetchCopilotOverview(new URLSearchParams());
    const store = getMemoryStore();

    expect(payload.data.total).toBe(store.copilotRuns.length);
    expect(payload.data.metrics).toEqual(deriveCopilotMetrics(store.copilotMetricEvents));
    expect(payload.data.rows.map((row) => row.run.run_id)).toEqual(
      expect.arrayContaining([
        seeded.purchaseSucceededRunId,
        seeded.purchaseBlockedRunId,
        seeded.orderSubmitSucceededRunId,
      ]),
    );
  });

  it("keeps filtered rows and KPI metrics query-consistent for blocked/succeeded slices", async () => {
    await seedCopilotRuns();
    const store = getMemoryStore();

    const blockedFilters = new URLSearchParams({
      pageName: "/purchase",
      status: "blocked",
      runType: "autofill_order",
      customerId: "dealer_xm_sm",
      limit: "20",
    });
    const blocked = await fetchCopilotOverview(blockedFilters);
    expect(blocked.data.total).toBe(1);
    expect(blocked.data.rows).toHaveLength(1);
    expect(blocked.data.rows[0].run.page_name).toBe("/purchase");
    expect(blocked.data.rows[0].run.status).toBe("blocked");
    expect(blocked.data.rows[0].run.run_type).toBe("autofill_order");
    expect(blocked.data.rows[0].run.customer_id).toBe("dealer_xm_sm");

    const blockedRunIdSet = new Set(blocked.data.rows.map((row) => row.run.run_id));
    const blockedEvents = store.copilotMetricEvents.filter((event) =>
      event.run_id ? blockedRunIdSet.has(event.run_id) : false,
    );
    expect(blocked.data.metrics).toEqual(deriveCopilotMetrics(blockedEvents));
    expect(blocked.data.metrics.copilot_preview_success_rate).toBe(0);
    expect(blocked.data.metrics.copilot_apply_to_cart_success_rate).toBe(0);

    const succeededFilters = new URLSearchParams({
      pageName: "/purchase",
      status: "succeeded",
      runType: "autofill_order",
      customerId: "dealer_xm_sm",
      limit: "20",
    });
    const succeeded = await fetchCopilotOverview(succeededFilters);
    expect(succeeded.data.total).toBe(1);
    expect(succeeded.data.rows).toHaveLength(1);
    expect(succeeded.data.rows[0].run.page_name).toBe("/purchase");
    expect(succeeded.data.rows[0].run.status).toBe("succeeded");

    const succeededRunIdSet = new Set(succeeded.data.rows.map((row) => row.run.run_id));
    const succeededEvents = store.copilotMetricEvents.filter((event) =>
      event.run_id ? succeededRunIdSet.has(event.run_id) : false,
    );
    expect(succeeded.data.metrics).toEqual(deriveCopilotMetrics(succeededEvents));
    expect(succeeded.data.metrics.copilot_preview_success_rate).toBe(1);
    expect(succeeded.data.metrics.copilot_apply_to_cart_success_rate).toBe(1);
    expect(succeeded.data.metrics.copilot_checkout_conversion_rate).toBe(1);
  });
});
