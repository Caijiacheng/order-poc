import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

import {
  assertLlmAvailable,
  createDefaultLlmFactory,
  setLlmFactory,
} from "../../lib/ai/model-factory";
import {
  generateCartOptimization,
  generateExplanation,
  generateRecommendationItems,
} from "../../lib/ai/service";
import { BusinessError } from "../../lib/domain/errors";
import {
  captureLlmEnv,
  restoreLlmEnv,
  setMockLlmEnv,
  setUnconfiguredRealLlmEnv,
} from "../helpers/runtime";

describe("AI SDK mock seam", () => {
  let envSnapshot: ReturnType<typeof captureLlmEnv>;

  beforeEach(() => {
    envSnapshot = captureLlmEnv();
  });

  afterEach(() => {
    restoreLlmEnv(envSnapshot);
  });

  it("uses ai/test MockLanguageModelV3 when LLM_MOCK_MODE=true", () => {
    setMockLlmEnv("mock-stage5-seam");

    const factory = createDefaultLlmFactory();
    const model = factory.getModel();

    expect(factory.providerName).toBe("ai-sdk-test");
    expect(factory.isMockMode).toBe(true);
    expect(factory.modelName).toBe("mock-stage5-seam");
    expect(model).toBeInstanceOf(MockLanguageModelV3);
  });

  it("returns structured fallback outputs through the mock seam", async () => {
    setMockLlmEnv("mock-stage5-fallback");
    setLlmFactory(createDefaultLlmFactory());

    const recommendation = await generateRecommendationItems({
      prompt: "stage5 recommendation",
      mockItems: [
        {
          sku_id: "cb_weijixian_500",
          suggested_qty: 2,
          reason: "fallback recommendation",
          reason_tags: ["stage5"],
          priority: 1,
          action_type: "add_to_cart",
        },
      ],
      functionId: "stage5.recommendation",
      telemetryMetadata: { scene: "daily_recommendation" },
    });
    expect(recommendation.items).toEqual([
      {
        sku_id: "cb_weijixian_500",
        suggested_qty: 2,
        reason: "fallback recommendation",
        reason_tags: ["stage5"],
        priority: 1,
        action_type: "add_to_cart",
      },
    ]);
    expect(recommendation.meta.model_name).toBe("mock-stage5-fallback");

    const optimization = await generateCartOptimization({
      prompt: "stage5 optimization",
      mockOutput: {
        decisions: [
          {
            bar_type: "threshold",
            combo_id: "threshold_combo_1",
            explanation: "fallback threshold",
          },
        ],
      },
      functionId: "stage5.cart",
      telemetryMetadata: { scene: "box_pair_optimization" },
    });
    expect(optimization.output.decisions[0]).toEqual({
      bar_type: "threshold",
      combo_id: "threshold_combo_1",
      explanation: "fallback threshold",
    });

    const explanation = await generateExplanation({
      prompt: "stage5 explanation",
      mockOutput: {
        explanations: [
          {
            sku_id: "cb_weijixian_500",
            explanation: "fallback explanation",
          },
        ],
      },
      functionId: "stage5.explain",
      telemetryMetadata: { scene: "daily_recommendation" },
    });
    expect(explanation.output.explanations[0].explanation).toBe("fallback explanation");
  });

  it("rejects unavailable non-mock configuration", () => {
    setUnconfiguredRealLlmEnv();
    expect(() => assertLlmAvailable()).toThrowError(BusinessError);
  });
});
