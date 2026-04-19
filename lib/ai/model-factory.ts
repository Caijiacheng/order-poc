import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { createAiSdkMockModel } from "@/lib/ai/mock-model";
import { BusinessError } from "@/lib/domain/errors";

export type LlmFactory = {
  providerName: string;
  modelName: string;
  isMockMode: boolean;
  isConfigured: boolean;
  getModel: () => LanguageModel;
};

declare global {
  var __ORDER_POC_LLM_FACTORY__: LlmFactory | undefined;
}

function getRuntimeConfig() {
  const isMockMode = String(process.env.LLM_MOCK_MODE ?? "false").toLowerCase() === "true";
  const baseURL = process.env.LLM_BASE_URL ?? "";
  const apiKey = process.env.LLM_API_KEY ?? "";
  const modelName = process.env.LLM_MODEL ?? "";
  const isConfigured = Boolean(baseURL && apiKey && modelName);

  return {
    isMockMode,
    baseURL,
    apiKey,
    modelName,
    isConfigured,
  };
}

function getOcrRuntimeConfig() {
  const isMockMode = String(process.env.LLM_MOCK_MODE ?? "false").toLowerCase() === "true";
  const baseURL = process.env.LLM_OCR_BASE_URL ?? "";
  const apiKey = process.env.LLM_OCR_API_KEY ?? "";
  const modelName = process.env.LLM_OCR_MODEL ?? "";
  const isConfigured = Boolean(baseURL && apiKey && modelName);

  return {
    isMockMode,
    baseURL,
    apiKey,
    modelName,
    isConfigured,
  };
}

export function createDefaultLlmFactory(): LlmFactory {
  const runtime = getRuntimeConfig();

  if (runtime.isMockMode) {
    const mockModelName = runtime.modelName || "mock-model";
    const mockModel = createAiSdkMockModel(mockModelName);
    return {
      providerName: "ai-sdk-test",
      modelName: mockModelName,
      isMockMode: true,
      isConfigured: true,
      getModel: () => mockModel,
    };
  }

  const provider = createOpenAI({
    baseURL: runtime.baseURL,
    apiKey: runtime.apiKey,
    name: "dashscope",
    ...({ compatibility: "compatible" } as unknown as Record<string, unknown>),
  });

  return {
    providerName: "dashscope",
    modelName: runtime.modelName,
    isMockMode: runtime.isMockMode,
    isConfigured: runtime.isConfigured,
    getModel: () => {
      if (!runtime.modelName) {
        throw new BusinessError(
          "LLM_UNAVAILABLE",
          "LLM_MODEL 未配置，无法选择模型。",
          503,
        );
      }
      return provider(runtime.modelName);
    },
  };
}

export function createDefaultOcrLlmFactory(): LlmFactory {
  const runtime = getOcrRuntimeConfig();

  if (runtime.isMockMode) {
    const mockModelName = runtime.modelName || process.env.LLM_MODEL || "mock-ocr-model";
    const mockModel = createAiSdkMockModel(mockModelName);
    return {
      providerName: "ai-sdk-test",
      modelName: mockModelName,
      isMockMode: true,
      isConfigured: true,
      getModel: () => mockModel,
    };
  }

  const provider = createOpenAI({
    baseURL: runtime.baseURL,
    apiKey: runtime.apiKey,
    name: "dashscope",
    ...({ compatibility: "compatible" } as unknown as Record<string, unknown>),
  });

  return {
    providerName: "dashscope",
    modelName: runtime.modelName,
    isMockMode: runtime.isMockMode,
    isConfigured: runtime.isConfigured,
    getModel: () => {
      if (!runtime.modelName) {
        throw new BusinessError(
          "LLM_UNAVAILABLE",
          "LLM_OCR_MODEL 未配置，无法选择 OCR 模型。",
          503,
        );
      }
      return provider(runtime.modelName);
    },
  };
}

export function getLlmFactory(): LlmFactory {
  if (!globalThis.__ORDER_POC_LLM_FACTORY__) {
    globalThis.__ORDER_POC_LLM_FACTORY__ = createDefaultLlmFactory();
  }
  return globalThis.__ORDER_POC_LLM_FACTORY__;
}

export function setLlmFactory(factory: LlmFactory) {
  globalThis.__ORDER_POC_LLM_FACTORY__ = factory;
}

export function getOcrLlmFactory(): LlmFactory {
  return createDefaultOcrLlmFactory();
}

export function assertLlmAvailable() {
  const factory = getLlmFactory();
  if (factory.isMockMode) {
    return;
  }
  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "LLM 未配置。请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }
}

export function assertOcrLlmAvailable() {
  const factory = getOcrLlmFactory();
  if (factory.isMockMode) {
    return;
  }
  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "OCR LLM 未配置。请设置 LLM_OCR_BASE_URL / LLM_OCR_API_KEY / LLM_OCR_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }
}
