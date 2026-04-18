import { randomUUID } from "node:crypto";

import { getMemoryStore } from "@/lib/memory/store";
import type { CopilotMetricEvent, CopilotMetricsStore } from "@/lib/copilot/types";

function roundRate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10000) / 10000;
}

export function deriveCopilotMetrics(events: CopilotMetricEvent[]): CopilotMetricsStore {
  const usageCount = events.filter((event) => event.event_type === "copilot_usage").length;
  const autofillStartCount = events.filter(
    (event) => event.event_type === "copilot_autofill_started",
  ).length;
  const previewSuccessCount = events.filter(
    (event) => event.event_type === "copilot_preview_succeeded",
  ).length;
  const applyAttemptCount = events.filter(
    (event) => event.event_type === "copilot_apply_attempted",
  ).length;
  const applySuccessCount = events.filter(
    (event) => event.event_type === "copilot_apply_succeeded",
  ).length;
  const campaignTopupAttemptCount = events.filter(
    (event) => event.event_type === "copilot_campaign_topup_attempted",
  ).length;
  const campaignTopupSuccessCount = events.filter(
    (event) => event.event_type === "copilot_campaign_topup_succeeded",
  ).length;
  const checkoutConvertedCount = events.filter(
    (event) => event.event_type === "copilot_checkout_converted",
  ).length;
  const latencies = events
    .filter((event) => event.event_type === "copilot_run_completed")
    .map((event) => event.latency_ms ?? 0)
    .filter((value) => value > 0);
  const avgLatencyMs =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);

  return {
    copilot_usage_count: usageCount,
    copilot_autofill_start_count: autofillStartCount,
    copilot_preview_success_rate: roundRate(
      autofillStartCount > 0 ? previewSuccessCount / autofillStartCount : 0,
    ),
    copilot_apply_to_cart_success_rate: roundRate(
      applyAttemptCount > 0 ? applySuccessCount / applyAttemptCount : 0,
    ),
    copilot_campaign_topup_success_rate: roundRate(
      campaignTopupAttemptCount > 0
        ? campaignTopupSuccessCount / campaignTopupAttemptCount
        : 0,
    ),
    copilot_checkout_conversion_rate: roundRate(
      applySuccessCount > 0 ? checkoutConvertedCount / applySuccessCount : 0,
    ),
    copilot_avg_latency_ms: avgLatencyMs,
  };
}

export function recordCopilotMetricEvent(
  event: Omit<CopilotMetricEvent, "id" | "timestamp">,
) {
  const store = getMemoryStore();
  store.copilotMetricEvents.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  });
  store.copilotMetricEvents = store.copilotMetricEvents.slice(0, 400);
  store.copilotMetrics = deriveCopilotMetrics(store.copilotMetricEvents);
  return store.copilotMetrics;
}

export function refreshCopilotMetrics() {
  const store = getMemoryStore();
  store.copilotMetrics = deriveCopilotMetrics(store.copilotMetricEvents);
  return store.copilotMetrics;
}
