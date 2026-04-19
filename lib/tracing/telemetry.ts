import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";
import type { TelemetrySettings } from "ai";
import Langfuse from "langfuse";

const TRACER_NAME = "order-poc.business";

declare global {
  var __ORDER_POC_LANGFUSE_CLIENT__: Langfuse | undefined;
}

type TraceSummaryConfig<T> = {
  input?: unknown;
  output?: (result: T) => unknown;
  errorOutput?: (error: unknown) => unknown;
};

export function isLangfuseTracingEnabled() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY &&
      process.env.LANGFUSE_BASE_URL,
  );
}

export function buildTelemetrySettings(
  functionId: string,
  metadata: Record<string, string | number | boolean | undefined>,
): TelemetrySettings {
  const compactMetadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      compactMetadata[key] = value;
    }
  }

  return {
    isEnabled: isLangfuseTracingEnabled(),
    functionId,
    metadata: compactMetadata,
    recordInputs: true,
    recordOutputs: true,
  };
}

function getLangfuseClient() {
  if (!isLangfuseTracingEnabled()) {
    return null;
  }

  if (!globalThis.__ORDER_POC_LANGFUSE_CLIENT__) {
    globalThis.__ORDER_POC_LANGFUSE_CLIENT__ = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? "local",
      release: process.env.LANGFUSE_RELEASE ?? "dev",
    });
  }

  return globalThis.__ORDER_POC_LANGFUSE_CLIENT__;
}

function serializeTraceMetadata(attributes: Attributes) {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      metadata[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const normalizedArray = value.filter(
        (item): item is string | number | boolean =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
      if (normalizedArray.length === value.length) {
        metadata[key] = normalizedArray;
      }
    }
  }

  return metadata;
}

function serializeTraceContent(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

export async function recordLangfuseGenerationDiagnostic(input: {
  traceId?: string;
  name: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  statusMessage?: string;
  level?: "DEFAULT" | "ERROR";
}) {
  if (!input.traceId) {
    return;
  }

  const client = getLangfuseClient();
  if (!client) {
    return;
  }

  const timestamp = new Date();
  client.generation({
    traceId: input.traceId,
    name: input.name,
    startTime: timestamp,
    endTime: timestamp,
    model: input.model,
    input: serializeTraceContent(input.input),
    output: serializeTraceContent(input.output),
    metadata: serializeTraceContent(input.metadata),
    statusMessage: input.statusMessage,
    level: input.level ?? "ERROR",
  });

  await client.flushAsync();
}

async function upsertLangfuseTrace(input: {
  traceId: string;
  name: string;
  attributes: Attributes;
  traceInput?: unknown;
  traceOutput?: unknown;
}) {
  const client = getLangfuseClient();
  if (!client) {
    return;
  }

  const body = {
    id: input.traceId,
    name: input.name,
    sessionId:
      typeof input.attributes["session.id"] === "string"
        ? input.attributes["session.id"]
        : undefined,
    userId:
      typeof input.attributes["customer.id"] === "string"
        ? input.attributes["customer.id"]
        : undefined,
    metadata: serializeTraceMetadata(input.attributes),
    ...(input.traceInput !== undefined
      ? { input: serializeTraceContent(input.traceInput) }
      : {}),
    ...(input.traceOutput !== undefined
      ? { output: serializeTraceContent(input.traceOutput) }
      : {}),
  } as Parameters<Langfuse["trace"]>[0];

  client.trace(body);

  await client.flushAsync();
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (traceId: string) => Promise<T>,
  traceSummary?: TraceSummaryConfig<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    const traceId = span.spanContext().traceId;
    const traceInput = traceSummary?.input;
    await upsertLangfuseTrace({
      traceId,
      name,
      attributes,
      traceInput,
    });
    try {
      const result = await fn(traceId);
      span.setStatus({ code: SpanStatusCode.OK });
      await upsertLangfuseTrace({
        traceId,
        name,
        attributes,
        traceInput,
        traceOutput: traceSummary?.output?.(result),
      });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      await upsertLangfuseTrace({
        traceId,
        name,
        attributes,
        traceInput,
        traceOutput:
          traceSummary?.errorOutput?.(error) ??
          {
            中文说明: "业务链路执行失败。",
            状态: "失败",
            错误:
              error instanceof Error ? error.message : String(error ?? "unknown error"),
          },
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function withChildSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown error",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
