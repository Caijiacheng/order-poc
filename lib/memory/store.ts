import { randomUUID } from "node:crypto";

import { loadSeedStore } from "@/lib/memory/seed";
import type { AppMemoryStore, AuditLogEvent, MetricEvent } from "@/lib/memory/types";

declare global {
  var __ORDER_POC_MEMORY_STORE__: AppMemoryStore | undefined;
}

export function getMemoryStore(): AppMemoryStore {
  if (!globalThis.__ORDER_POC_MEMORY_STORE__) {
    globalThis.__ORDER_POC_MEMORY_STORE__ = loadSeedStore();
  }
  return globalThis.__ORDER_POC_MEMORY_STORE__;
}

export function resetMemoryStoreToSeed(): AppMemoryStore {
  globalThis.__ORDER_POC_MEMORY_STORE__ = loadSeedStore();
  return globalThis.__ORDER_POC_MEMORY_STORE__;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAuditEvent(input: Omit<AuditLogEvent, "id" | "timestamp">): AuditLogEvent {
  return {
    id: randomUUID(),
    timestamp: nowIso(),
    ...input,
  };
}

export function appendAuditLog(event: Omit<AuditLogEvent, "id" | "timestamp">) {
  const store = getMemoryStore();
  store.auditLogs.unshift(createAuditEvent(event));
}

export function appendMetricEvent(event: Omit<MetricEvent, "id" | "timestamp">) {
  const store = getMemoryStore();
  store.metrics.latestEvents.unshift({
    id: randomUUID(),
    timestamp: nowIso(),
    ...event,
  });
  store.metrics.latestEvents = store.metrics.latestEvents.slice(0, 200);
}
