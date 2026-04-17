import { generateText, Output } from "ai";
import { z } from "zod";

import { BusinessError } from "@/lib/domain/errors";
import { getLlmFactory } from "@/lib/ai/model-factory";
import {
  cartOptimizationSchema,
  explanationOutputSchema,
  recommendationItemSchema,
  type CartOptimizationOutput,
  type ExplanationOutput,
  type RecommendationItemOutput,
} from "@/lib/ai/schemas";
import { buildTelemetrySettings } from "@/lib/tracing/telemetry";

type GenerationMeta = {
  model_name: string;
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
};

type RecommendationGenerationResult = {
  items: RecommendationItemOutput[];
  meta: GenerationMeta;
};

type CartOptimizationGenerationResult = {
  output: CartOptimizationOutput;
  meta: GenerationMeta;
};

type ExplanationGenerationResult = {
  output: ExplanationOutput;
  meta: GenerationMeta;
};

type MockProviderOptions = {
  orderPocMock: {
    response_json: string;
  };
};

type RawProviderResponseBody = {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

function usageFromResult(result: { usage?: { inputTokens?: number; outputTokens?: number } }) {
  return {
    input_tokens: result.usage?.inputTokens,
    output_tokens: result.usage?.outputTokens,
  };
}

function usageFromRawResponseBody(body: RawProviderResponseBody | undefined) {
  return {
    input_tokens: body?.usage?.input_tokens,
    output_tokens: body?.usage?.output_tokens,
  };
}

function extractRawResponseBody(error: unknown): RawProviderResponseBody | undefined {
  const maybeBody = (error as { response?: { body?: RawProviderResponseBody } })?.response?.body;
  return maybeBody;
}

function extractOutputTextFromBody(body: RawProviderResponseBody | undefined) {
  if (!body?.output) {
    return "";
  }

  return body.output
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function stripMarkdownFences(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonPayload(text: string) {
  const cleaned = stripMarkdownFences(text);
  if (!cleaned) {
    return "";
  }

  if (
    (cleaned.startsWith("[") && cleaned.endsWith("]")) ||
    (cleaned.startsWith("{") && cleaned.endsWith("}"))
  ) {
    return cleaned;
  }

  const arrayStart = cleaned.indexOf("[");
  const objectStart = cleaned.indexOf("{");
  const hasArray = arrayStart >= 0;
  const hasObject = objectStart >= 0;

  if (!hasArray && !hasObject) {
    return cleaned;
  }

  const isArray = hasArray && (!hasObject || arrayStart < objectStart);
  const start = isArray ? arrayStart : objectStart;
  const end = isArray ? cleaned.lastIndexOf("]") : cleaned.lastIndexOf("}");
  if (end <= start) {
    return cleaned.slice(start).trim();
  }

  return cleaned.slice(start, end + 1).trim();
}

function coerceJsonScalars(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(coerceJsonScalars);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, coerceJsonScalars(nestedValue)]),
    );
  }

  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }

  return value;
}

function normalizeRecommendationPayload(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    const record = item as Record<string, unknown>;
    const actionSource = String(record.action_type ?? "add_to_cart").toLowerCase();
    let actionType: RecommendationItemOutput["action_type"] = "add_to_cart";
    if (
      actionSource.includes("replace") ||
      actionSource.includes("substitute") ||
      actionSource.includes("swap")
    ) {
      actionType = "replace_item";
    } else if (
      actionSource.includes("adjust") ||
      actionSource.includes("update") ||
      actionSource.includes("increase") ||
      actionSource.includes("decrease")
    ) {
      actionType = "adjust_qty";
    }

    const reasonTags = Array.isArray(record.reason_tags)
      ? record.reason_tags
      : typeof record.reason_tags === "string"
        ? record.reason_tags
            .split(/[，,、/]/)
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

    return {
      ...record,
      reason_tags: reasonTags,
      action_type: actionType,
    };
  });
}

function normalizeCartOptimizationPayload(value: unknown): unknown {
  const normalized = coerceJsonScalars(value);
  if (Array.isArray(normalized)) {
    return {
      decisions: normalized,
    };
  }

  if (!normalized || typeof normalized !== "object") {
    return normalized;
  }

  const record = normalized as Record<string, unknown>;
  const decisionBuckets: Array<{
    bar_type: "threshold" | "box_adjustment" | "pairing";
    combo_id: string;
    explanation: string;
  }> = [];

  if (Array.isArray(record.decisions)) {
    for (const item of record.decisions) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const barType = String(row.bar_type ?? "").trim();
      if (!["threshold", "box_adjustment", "pairing"].includes(barType)) {
        continue;
      }
      const comboId = String(row.combo_id ?? "").trim();
      if (!comboId) {
        continue;
      }
      const explanation = String(row.explanation ?? "按候选组合优先级推荐该方案。").trim();
      decisionBuckets.push({
        bar_type: barType as "threshold" | "box_adjustment" | "pairing",
        combo_id: comboId,
        explanation,
      });
    }
  }

  const aliasMappings: Array<{
    bar_type: "threshold" | "box_adjustment" | "pairing";
    combo_id?: string;
    explanation?: string;
  }> = [
    {
      bar_type: "threshold",
      combo_id: String(record.threshold_combo_id ?? ""),
      explanation: String(record.threshold_explanation ?? ""),
    },
    {
      bar_type: "box_adjustment",
      combo_id: String(record.box_adjustment_combo_id ?? ""),
      explanation: String(record.box_adjustment_explanation ?? ""),
    },
    {
      bar_type: "pairing",
      combo_id: String(record.pairing_combo_id ?? ""),
      explanation: String(record.pairing_explanation ?? ""),
    },
  ];

  for (const alias of aliasMappings) {
    const comboId = alias.combo_id?.trim() ?? "";
    if (!comboId) {
      continue;
    }
    decisionBuckets.push({
      bar_type: alias.bar_type,
      combo_id: comboId,
      explanation:
        alias.explanation?.trim() || "按候选组合优先级推荐该方案。",
    });
  }

  return {
    ...record,
    decisions: decisionBuckets,
  };
}

function normalizeExplanationPayload(value: unknown): unknown {
  const normalized = coerceJsonScalars(value);

  const normalizeItems = (items: unknown[]) => {
    return items
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const skuId = String(record.sku_id ?? record.skuId ?? record.id ?? "").trim();
        const explanation = String(
          record.explanation ??
            record.reason ??
            record.content ??
            record.description ??
            record.text ??
            "",
        ).trim();

        if (!skuId || !explanation) {
          return null;
        }

        return {
          sku_id: skuId,
          explanation,
        };
      })
      .filter((item): item is { sku_id: string; explanation: string } => Boolean(item));
  };

  if (Array.isArray(normalized)) {
    return {
      explanations: normalizeItems(normalized),
    };
  }

  if (!normalized || typeof normalized !== "object") {
    return normalized;
  }

  const record = normalized as Record<string, unknown>;
  const nestedArray =
    Array.isArray(record.explanations)
      ? record.explanations
      : Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.results)
          ? record.results
          : Array.isArray(record.data)
            ? record.data
            : null;

  if (!nestedArray) {
    return normalized;
  }

  return {
    ...record,
    explanations: normalizeItems(nestedArray),
  };
}

function salvageStructuredOutput<T>(input: {
  error: unknown;
  schema: z.ZodType<T>;
  normalizer?: (value: unknown) => unknown;
}): { output: T; usage: { input_tokens?: number; output_tokens?: number } } | null {
  const body = extractRawResponseBody(input.error);
  const rawText = extractOutputTextFromBody(body);
  if (!rawText) {
    return null;
  }

  try {
    const parsed = JSON.parse(extractJsonPayload(rawText));
    const normalized = input.normalizer ? input.normalizer(coerceJsonScalars(parsed)) : parsed;
    const validated = input.schema.safeParse(normalized);
    if (!validated.success) {
      return null;
    }

    return {
      output: validated.data,
      usage: usageFromRawResponseBody(body),
    };
  } catch {
    return null;
  }
}

function buildMockProviderOptions(payload: unknown): MockProviderOptions {
  return {
    orderPocMock: {
      response_json: JSON.stringify(payload ?? null),
    },
  };
}

function toGenerationMeta(
  modelName: string,
  startedAt: number,
  usage: { input_tokens?: number; output_tokens?: number },
): GenerationMeta {
  return {
    model_name: modelName,
    model_latency_ms: Date.now() - startedAt,
    ...usage,
  };
}

export async function generateRecommendationItems(input: {
  prompt: string;
  fallbackItems: RecommendationItemOutput[];
  functionId: string;
  telemetryMetadata: Record<string, string | number | boolean | undefined>;
}): Promise<RecommendationGenerationResult> {
  const factory = getLlmFactory();
  const startedAt = Date.now();

  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "LLM 未配置。请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }

  try {
    const result = await generateText({
      model: factory.getModel(),
      prompt: input.prompt,
      output: Output.array({
        element: recommendationItemSchema,
        name: "recommendation_items",
        description: "Structured recommendation items.",
      }),
      experimental_telemetry: buildTelemetrySettings(
        input.functionId,
        input.telemetryMetadata,
      ),
      providerOptions: factory.isMockMode
        ? buildMockProviderOptions(input.fallbackItems)
        : undefined,
      temperature: 0.2,
      maxOutputTokens: 1000,
    });

    return {
      items: result.output ?? [],
      meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
    };
  } catch (error) {
    const salvaged = salvageStructuredOutput({
      error,
      schema: z.array(recommendationItemSchema),
      normalizer: normalizeRecommendationPayload,
    });
    if (!salvaged) {
      throw error;
    }

    return {
      items: salvaged.output,
      meta: toGenerationMeta(factory.modelName, startedAt, salvaged.usage),
    };
  }
}

export async function generateCartOptimization(input: {
  prompt: string;
  fallbackOutput: CartOptimizationOutput;
  functionId: string;
  telemetryMetadata: Record<string, string | number | boolean | undefined>;
}): Promise<CartOptimizationGenerationResult> {
  const factory = getLlmFactory();
  const startedAt = Date.now();

  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "LLM 未配置。请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }

  try {
    const result = await generateText({
      model: factory.getModel(),
      prompt: input.prompt,
      output: Output.object({
        schema: cartOptimizationSchema,
        name: "cart_optimization",
        description: "Structured cart optimization output.",
      }),
      experimental_telemetry: buildTelemetrySettings(
        input.functionId,
        input.telemetryMetadata,
      ),
      providerOptions: factory.isMockMode
        ? buildMockProviderOptions(input.fallbackOutput)
        : undefined,
      temperature: 0.2,
      maxOutputTokens: 1000,
    });

    return {
      output: result.output ?? input.fallbackOutput,
      meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
    };
  } catch (error) {
    const salvaged = salvageStructuredOutput({
      error,
      schema: cartOptimizationSchema,
      normalizer: normalizeCartOptimizationPayload,
    });
    if (!salvaged) {
      throw error;
    }

    return {
      output: salvaged.output,
      meta: toGenerationMeta(factory.modelName, startedAt, salvaged.usage),
    };
  }
}

export async function generateExplanation(input: {
  prompt: string;
  fallbackOutput: ExplanationOutput;
  functionId: string;
  telemetryMetadata: Record<string, string | number | boolean | undefined>;
}): Promise<ExplanationGenerationResult> {
  const factory = getLlmFactory();
  const startedAt = Date.now();

  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "LLM 未配置。请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }

  try {
    const result = await generateText({
      model: factory.getModel(),
      prompt: input.prompt,
      output: Output.object({
        schema: explanationOutputSchema,
        name: "recommendation_explanations",
        description: "Explanations for recommendation items.",
      }),
      experimental_telemetry: buildTelemetrySettings(
        input.functionId,
        input.telemetryMetadata,
      ),
      providerOptions: factory.isMockMode
        ? buildMockProviderOptions(input.fallbackOutput)
        : undefined,
      temperature: 0.2,
      maxOutputTokens: 800,
    });

    return {
      output: result.output ?? input.fallbackOutput,
      meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
    };
  } catch (error) {
    const salvaged = salvageStructuredOutput({
      error,
      schema: explanationOutputSchema,
      normalizer: normalizeExplanationPayload,
    });
    if (!salvaged) {
      throw error;
    }

    return {
      output: salvaged.output,
      meta: toGenerationMeta(factory.modelName, startedAt, salvaged.usage),
    };
  }
}
