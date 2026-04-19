import { generateText, Output } from "ai";

import { getOcrLlmFactory } from "@/lib/ai/model-factory";
import {
  copilotImageExtractSchema,
  type CopilotImageExtractOutput,
} from "@/lib/copilot/schemas";
import type { CopilotImageInput } from "@/lib/copilot/types";
import { BusinessError } from "@/lib/domain/errors";
import { buildTelemetrySettings } from "@/lib/tracing/telemetry";

type OcrMeta = {
  model_name: string;
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
};

type OcrResult = {
  output: CopilotImageExtractOutput;
  meta: OcrMeta;
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

function buildMockOcrOutput(images: CopilotImageInput[]): CopilotImageExtractOutput {
  return {
    lines: images.map((image, index) => ({
      line_id: `line_${index + 1}`,
      original_text: image.fileName.replace(/\.[^.]+$/, "").slice(0, 50) || `图片条目 ${index + 1}`,
      qty_hint: null,
      confidence: "medium" as const,
    })),
  };
}

function buildImageExtractInstruction(imageCount: number) {
  return [
    "你是采购 OCR 条目提取器。你的任务是从图片中提取采购条目线索。",
    "仅返回结构化 JSON；不要输出解释文本。",
    "每一行至少包含 line_id、original_text、qty_hint、confidence。",
    "confidence 只能是 high | medium | low。",
    "无法识别数量时 qty_hint 返回 null。",
    `当前输入图片数量：${imageCount}。`,
  ].join("\n");
}

export async function extractCopilotImageLines(input: {
  images: CopilotImageInput[];
  customerId: string;
  traceId?: string;
}): Promise<OcrResult> {
  if (input.images.length === 0) {
    return {
      output: { lines: [] },
      meta: {
        model_name: "none",
        model_latency_ms: 0,
      },
    };
  }

  const factory = getOcrLlmFactory();
  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "OCR LLM 未配置。请设置 LLM_OCR_BASE_URL / LLM_OCR_API_KEY / LLM_OCR_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }

  const startedAt = Date.now();

  const result = await generateText({
    model: factory.getModel(),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildImageExtractInstruction(input.images.length),
          },
          ...input.images.map((image) => ({
            type: "image" as const,
            image: image.dataUrl,
            mediaType: image.mimeType,
          })),
        ],
      },
    ],
    output: Output.object({
      schema: copilotImageExtractSchema,
      name: "copilot_image_extract",
      description: "Extract purchasable line hints from uploaded images.",
    }),
    experimental_telemetry: buildTelemetrySettings("copilot.image-extract", {
      trace_id: input.traceId,
      customer_id: input.customerId,
      image_count: input.images.length,
    }),
    providerOptions: factory.isMockMode
      ? buildMockProviderOptions(buildMockOcrOutput(input.images))
      : undefined,
    temperature: 0,
    maxOutputTokens: 1200,
  });

  const parsed = copilotImageExtractSchema.safeParse(result.output);
  if (!parsed.success) {
    throw new BusinessError("LLM_INVALID_OUTPUT", "OCR 输出结构不合法。", 502, {
      payload: parsed.error.issues[0]?.message ?? "OCR 输出缺少有效条目结构",
    });
  }

  return {
    output: parsed.data,
    meta: {
      model_name: factory.modelName,
      model_latency_ms: Date.now() - startedAt,
      ...usageFromResult(result),
    },
  };
}
