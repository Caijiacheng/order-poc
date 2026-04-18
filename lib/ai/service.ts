import { generateText, Output } from "ai";

import { BusinessError } from "@/lib/domain/errors";
import { getLlmFactory } from "@/lib/ai/model-factory";
import {
  cartOptimizationSchema,
  explanationOutputSchema,
  recommendationItemsOutputSchema,
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

function usageFromResult(result: { usage?: { inputTokens?: number; outputTokens?: number } }) {
  return {
    input_tokens: result.usage?.inputTokens,
    output_tokens: result.usage?.outputTokens,
  };
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
  mockItems: RecommendationItemOutput[];
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

  const result = await generateText({
    model: factory.getModel(),
    prompt: input.prompt,
    output: Output.object({
      schema: recommendationItemsOutputSchema,
      name: "recommendation_items",
      description: "Structured recommendation items.",
    }),
    experimental_telemetry: buildTelemetrySettings(
      input.functionId,
      input.telemetryMetadata,
    ),
    providerOptions: factory.isMockMode
      ? buildMockProviderOptions({ elements: input.mockItems })
      : undefined,
    temperature: 0.2,
    maxOutputTokens: 1000,
  });

  return {
    items: result.output.elements,
    meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
  };
}

export async function generateCartOptimization(input: {
  prompt: string;
  mockOutput: CartOptimizationOutput;
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
      ? buildMockProviderOptions(input.mockOutput)
      : undefined,
    temperature: 0.2,
    maxOutputTokens: 1000,
  });

  return {
    output: result.output,
    meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
  };
}

export async function generateExplanation(input: {
  prompt: string;
  mockOutput: ExplanationOutput;
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
      ? buildMockProviderOptions(input.mockOutput)
      : undefined,
    temperature: 0.2,
    maxOutputTokens: 800,
  });

  return {
    output: result.output,
    meta: toGenerationMeta(factory.modelName, startedAt, usageFromResult(result)),
  };
}
