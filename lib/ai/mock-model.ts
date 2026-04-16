import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as JsonRecord;
}

function extractResponseJson(providerOptions: unknown): string {
  const providerOptionsRecord = asRecord(providerOptions);
  const mockOptions = asRecord(providerOptionsRecord?.orderPocMock);
  const responseJson = mockOptions?.response_json;
  return typeof responseJson === "string" ? responseJson : "null";
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isArrayOutputSchema(responseFormat: unknown): boolean {
  const responseFormatRecord = asRecord(responseFormat);
  if (responseFormatRecord?.type !== "json") {
    return false;
  }
  const schemaRecord = asRecord(responseFormatRecord.schema);
  const propertiesRecord = asRecord(schemaRecord?.properties);
  const elementsRecord = asRecord(propertiesRecord?.elements);
  return elementsRecord?.type === "array";
}

function normalizePayloadForOutput(payload: unknown, responseFormat: unknown): unknown {
  if (!isArrayOutputSchema(responseFormat)) {
    return payload;
  }
  if (Array.isArray(payload)) {
    return { elements: payload };
  }
  const payloadRecord = asRecord(payload);
  if (payloadRecord && Array.isArray(payloadRecord.elements)) {
    return payloadRecord;
  }
  return { elements: [] };
}

function usageFromText(text: string) {
  const outputTokens = Math.max(1, Math.ceil(text.length / 4));
  return {
    inputTokens: {
      total: 32,
      noCache: 32,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: 0,
    },
  };
}

export function createAiSdkMockModel(modelId = "mock-model"): LanguageModel {
  return new MockLanguageModelV3({
    provider: "ai-sdk-test",
    modelId,
    doGenerate: async (options) => {
      const responseJson = extractResponseJson(options.providerOptions);
      const normalizedPayload = normalizePayloadForOutput(
        safeParseJson(responseJson),
        options.responseFormat,
      );
      const outputText = JSON.stringify(normalizedPayload ?? null);
      return {
        content: [{ type: "text", text: outputText }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usageFromText(outputText),
        warnings: [],
      };
    },
  });
}
