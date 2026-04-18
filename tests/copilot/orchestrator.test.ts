import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyCopilotDraft, runCopilotAutofill } from "../../lib/copilot/service";
import {
  addCartItem,
  getCartBySession,
  setCartCustomer,
  submitCart,
} from "../../lib/cart/service";
import { setLlmFactory } from "../../lib/ai/model-factory";
import { getMemoryStore } from "../../lib/memory/store";
import { BusinessError } from "../../lib/domain/errors";
import {
  captureLlmEnv,
  resetRuntimeState,
  restoreLlmEnv,
  setMockLlmEnv,
} from "../helpers/runtime";

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

function createStructuredMockModel(
  resolvePayload: (prompt: string) => Record<string, unknown>,
): LanguageModel {
  return new MockLanguageModelV3({
    provider: "ai-sdk-test",
    modelId: "mock-copilot-review",
    doGenerate: async (options) => {
      const prompt = typeof options.prompt === "string" ? options.prompt : JSON.stringify(options.prompt);
      const payload = resolvePayload(prompt);
      const text = JSON.stringify(payload);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usageFromText(text),
        warnings: [],
      };
    },
  });
}

function setPromptRoutingFactory(resolvePayload: (prompt: string) => Record<string, unknown>) {
  const model = createStructuredMockModel(resolvePayload);
  setLlmFactory({
    providerName: "ai-sdk-test",
    modelName: "mock-copilot-review",
    isMockMode: false,
    isConfigured: true,
    getModel: () => model,
  });
}

describe("copilot orchestrator Stage 1", () => {
  let envSnapshot: ReturnType<typeof captureLlmEnv>;

  beforeEach(() => {
    envSnapshot = captureLlmEnv();
    setMockLlmEnv("mock-copilot-stage1");
    resetRuntimeState();
  });

  afterEach(() => {
    restoreLlmEnv(envSnapshot);
  });

  it("keeps autofill preview-first and only writes cart on apply", async () => {
    const sessionId = "sess_copilot_stage1_preview";
    const autofill = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
      user_message: "帮我按常购和活动做一单，保守一点",
      page_name: "/purchase",
    });

    expect(autofill.job.status).toBe("preview_ready");
    expect(autofill.draft.status).toBe("preview");
    expect(autofill.draft.items.length).toBeGreaterThan(0);

    const previewCart = getCartBySession(sessionId);
    expect(previewCart.items).toHaveLength(0);

    const applied = await applyCopilotDraft({
      draft_id: autofill.draft.draft_id,
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
    });
    expect(applied.draft.status).toBe("applied");
    expect(applied.cart.items.length).toBeGreaterThan(0);
    expect(applied.optimization.summary.recommendation_run_id).toMatch(/^reco_run_/);
    expect(applied.run.reached_checkout).toBe(false);
  });

  it("returns blocked draft when no legal candidate survives constraints", async () => {
    const result = await runCopilotAutofill({
      session_id: "sess_copilot_stage1_blocked",
      customer_id: "dealer_xm_sm",
      user_message: "不要厨邦，帮我做单",
      page_name: "/purchase",
    });

    expect(result.job.status).toBe("blocked");
    expect(result.run.status).toBe("blocked");
    expect(result.draft.status).toBe("blocked");
    expect(result.draft.items).toEqual([]);
  });

  it("preserves model-blocked decisions instead of silently falling back to a selected combo", async () => {
    setPromptRoutingFactory((prompt) => {
      if (prompt.includes("任务：提取采购意图")) {
        return {
          intent_type: "topup_campaign",
          budget_target: null,
          prefer_campaign: true,
          prefer_frequent_items: true,
          avoid_new_products: false,
          risk_mode: "balanced",
          must_have_keywords: [],
          exclude_keywords: [],
        };
      }
      if (prompt.includes("任务：只能从候选组合中选择最合适的一个。")) {
        return {
          status: "blocked",
          explanation: "当前需要人工确认，不应直接下发候选组合。",
          blocked_reason: "manual_review_required",
        };
      }
      return {
        summary: "当前没有可直接应用的安全组合，建议先确认预算或放宽限制后再试。",
        should_go_checkout: false,
        key_points: ["候选组合不足"],
      };
    });

    const result = await runCopilotAutofill({
      session_id: "sess_copilot_stage1_model_blocked",
      customer_id: "dealer_xm_sm",
      user_message: "帮我补齐活动，但如果不稳妥就先拦住",
      page_name: "/purchase",
    });

    expect(result.job.status).toBe("blocked");
    expect(result.run.status).toBe("blocked");
    expect(result.draft.status).toBe("blocked");
    expect(result.draft.blocked_reason).toBe("manual_review_required");
    expect(result.draft.items).toEqual([]);
  });

  it("rejects draft apply when session does not match preview session", async () => {
    const previewSessionId = "sess_copilot_stage1_session_truth_preview";
    const otherSessionId = "sess_copilot_stage1_session_truth_other";
    const autofill = await runCopilotAutofill({
      session_id: previewSessionId,
      customer_id: "dealer_xm_sm",
      user_message: "按活动做单",
      page_name: "/purchase",
    });

    await expect(
      applyCopilotDraft({
        draft_id: autofill.draft.draft_id,
        session_id: otherSessionId,
        customer_id: "dealer_xm_sm",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(getCartBySession(otherSessionId).items).toHaveLength(0);
    expect(getCartBySession(previewSessionId).items).toHaveLength(0);
  });

  it("rejects rebinding a non-empty session cart to another dealer", async () => {
    const sessionId = "sess_copilot_stage1_customer_guard";
    setCartCustomer(sessionId, "dealer_xm_sm");
    addCartItem({
      session_id: sessionId,
      sku_id: "cb_weijixian_500",
      qty: 2,
      source: "manual",
    });

    await expect(
      runCopilotAutofill({
        session_id: sessionId,
        customer_id: "dealer_cd_pf",
        user_message: "帮我做一单",
        page_name: "/purchase",
      }),
    ).rejects.toBeInstanceOf(BusinessError);

    const cart = getCartBySession(sessionId);
    expect(cart.customer_id).toBe("dealer_xm_sm");
    expect(cart.items).toHaveLength(1);
  });

  it("keeps projected campaign state internally consistent after successful topup preview", async () => {
    const sessionId = "sess_copilot_stage1_campaign_projection";
    addCartItem({
      session_id: sessionId,
      sku_id: "cb_chicken_essence_200",
      qty: 6,
      source: "manual",
    });

    const autofill = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_cd_pf",
      user_message: "活动",
      page_name: "/purchase",
    });

    expect(autofill.draft.status).toBe("preview");
    expect(autofill.draft.campaign_state.campaign_id).toBeTruthy();
    expect(autofill.draft.campaign_state.current_amount).toBeGreaterThanOrEqual(
      autofill.draft.campaign_state.promo_threshold,
    );
    expect(autofill.draft.campaign_state.gap_amount).toBe(0);
    expect(autofill.draft.campaign_state.is_hit).toBe(true);
  });

  it("keeps mixed combo preview items distinct when campaign and replenishment pools overlap", async () => {
    setPromptRoutingFactory((prompt) => {
      if (prompt.includes("任务：提取采购意图")) {
        return {
          intent_type: "topup_campaign",
          budget_target: null,
          prefer_campaign: true,
          prefer_frequent_items: true,
          avoid_new_products: false,
          risk_mode: "balanced",
          must_have_keywords: [],
          exclude_keywords: [],
        };
      }
      if (prompt.includes("任务：只能从候选组合中选择最合适的一个。")) {
        return {
          status: "selected",
          combo_id: "combo_mixed_campaign_replenish",
          explanation: "优先验证活动补齐与常购稳健组合。",
        };
      }
      return {
        summary: "已生成混合补齐草案。",
        should_go_checkout: false,
        key_points: ["混合补齐"],
      };
    });

    const result = await runCopilotAutofill({
      session_id: "sess_copilot_stage1_mixed_distinct",
      customer_id: "dealer_dg_sm",
      user_message: "帮我优先补齐活动门槛，兼顾常购补货",
      page_name: "/purchase",
    });

    expect(result.draft.status).toBe("preview");
    expect(result.draft.selected_combo_id).toBe("combo_mixed_campaign_replenish");
    expect(result.draft.items).toHaveLength(2);
    expect(new Set(result.draft.items.map((item) => item.sku_id)).size).toBe(2);
  });

  it("keeps user-expanded add_to_cart quantities when applying a stale preview", async () => {
    const sessionId = "sess_copilot_stage1_apply_additive_qty";
    const preview = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
      user_message: "帮我按常购做一单，保守一点",
      page_name: "/purchase",
    });

    const addToCartItem = preview.draft.items.find((item) => item.action_type === "add_to_cart");
    expect(addToCartItem).toBeTruthy();
    if (!addToCartItem) {
      throw new Error("缺少 add_to_cart 草稿条目");
    }

    addCartItem({
      session_id: sessionId,
      sku_id: addToCartItem.sku_id,
      qty: addToCartItem.suggested_qty + 3,
      source: "manual",
    });

    const applied = await applyCopilotDraft({
      draft_id: preview.draft.draft_id,
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
    });

    const appliedItem = applied.cart.items.find((item) => item.sku_id === addToCartItem.sku_id);
    expect(appliedItem?.qty).toBe(addToCartItem.suggested_qty + 3);
  });

  it("rejects a conflicted mixed draft atomically without partially mutating cart", async () => {
    const sessionId = "sess_copilot_stage1_apply_adjust_conflict";
    setPromptRoutingFactory((prompt) => {
      if (prompt.includes("任务：提取采购意图")) {
        return {
          intent_type: "topup_campaign",
          budget_target: null,
          prefer_campaign: true,
          prefer_frequent_items: true,
          avoid_new_products: false,
          risk_mode: "balanced",
          must_have_keywords: [],
          exclude_keywords: [],
        };
      }
      if (prompt.includes("任务：只能从候选组合中选择最合适的一个。")) {
        return {
          status: "selected",
          combo_id: "combo_mixed_campaign_replenish",
          explanation: "优先验证混合补齐草案。",
        };
      }
      return {
        summary: "已生成活动补齐草案。",
        should_go_checkout: false,
        key_points: ["活动补齐"],
      };
    });
    addCartItem({
      session_id: sessionId,
      sku_id: "cb_zeroadd_shengchou_500",
      qty: 2,
      source: "manual",
    });

    const preview = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
      user_message: "帮我补齐活动门槛",
      page_name: "/purchase",
    });

    const adjustItem = preview.draft.items.find((item) => item.action_type === "adjust_qty");
    const addItem = preview.draft.items.find((item) => item.action_type === "add_to_cart");
    expect(adjustItem).toBeTruthy();
    expect(addItem).toBeTruthy();
    if (!adjustItem) {
      throw new Error("缺少 adjust_qty 草稿条目");
    }
    if (!addItem) {
      throw new Error("缺少 add_to_cart 草稿条目");
    }

    addCartItem({
      session_id: sessionId,
      sku_id: adjustItem.sku_id,
      qty: adjustItem.suggested_qty + 2,
      source: "manual",
    });
    const cartBeforeApply = getCartBySession(sessionId);
    const itemCountBeforeApply = cartBeforeApply.items.length;
    const conflictingQty = cartBeforeApply.items.find((item) => item.sku_id === adjustItem.sku_id)?.qty;

    await expect(
      applyCopilotDraft({
        draft_id: preview.draft.draft_id,
        session_id: sessionId,
        customer_id: "dealer_xm_sm",
      }),
    ).rejects.toBeInstanceOf(BusinessError);

    const cartAfterFailedApply = getCartBySession(sessionId);
    expect(cartAfterFailedApply.items).toHaveLength(itemCountBeforeApply);
    expect(cartAfterFailedApply.items.find((item) => item.sku_id === addItem.sku_id)).toBeUndefined();
    expect(
      cartAfterFailedApply.items.find((item) => item.sku_id === adjustItem.sku_id)?.qty,
    ).toBe(conflictingQty);
  });

  it("rejects apply atomically when a draft add_to_cart sku becomes inactive before apply", async () => {
    const sessionId = "sess_copilot_stage1_apply_inactive_product";
    addCartItem({
      session_id: sessionId,
      sku_id: "cb_zeroadd_shengchou_500",
      qty: 2,
      source: "manual",
    });

    setPromptRoutingFactory((prompt) => {
      if (prompt.includes("任务：提取采购意图")) {
        return {
          intent_type: "topup_campaign",
          budget_target: null,
          prefer_campaign: true,
          prefer_frequent_items: true,
          avoid_new_products: false,
          risk_mode: "balanced",
          must_have_keywords: [],
          exclude_keywords: [],
        };
      }
      if (prompt.includes("任务：只能从候选组合中选择最合适的一个。")) {
        return {
          status: "selected",
          combo_id: "combo_mixed_campaign_replenish",
          explanation: "优先验证混合补齐草案。",
        };
      }
      return {
        summary: "已生成活动补齐草案。",
        should_go_checkout: false,
        key_points: ["活动补齐"],
      };
    });

    const preview = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
      user_message: "帮我补齐活动门槛",
      page_name: "/purchase",
    });

    const addItem = preview.draft.items.find((item) => item.action_type === "add_to_cart");
    expect(addItem).toBeTruthy();
    if (!addItem) {
      throw new Error("缺少 add_to_cart 草稿条目");
    }

    const store = getMemoryStore();
    const targetProduct = store.products.find((item) => item.sku_id === addItem.sku_id);
    expect(targetProduct).toBeTruthy();
    if (!targetProduct) {
      throw new Error("缺少待停用商品");
    }
    targetProduct.status = "inactive";

    const cartBeforeApply = getCartBySession(sessionId);
    const snapshotBeforeApply = cartBeforeApply.items.map((item) => ({
      sku_id: item.sku_id,
      qty: item.qty,
    }));

    await expect(
      applyCopilotDraft({
        draft_id: preview.draft.draft_id,
        session_id: sessionId,
        customer_id: "dealer_xm_sm",
      }),
    ).rejects.toBeInstanceOf(BusinessError);

    const cartAfterFailedApply = getCartBySession(sessionId);
    expect(
      cartAfterFailedApply.items.map((item) => ({
        sku_id: item.sku_id,
        qty: item.qty,
      })),
    ).toEqual(snapshotBeforeApply);
  });

  it("records checkout conversion and marks copilot run submitted after cart submit", async () => {
    const sessionId = "sess_copilot_stage3_checkout_conversion";
    const preview = await runCopilotAutofill({
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
      user_message: "继续安全补齐，保守一点",
      page_name: "/order-submit",
    });

    await applyCopilotDraft({
      draft_id: preview.draft.draft_id,
      session_id: sessionId,
      customer_id: "dealer_xm_sm",
    });

    const submitResult = await submitCart(sessionId);
    expect(submitResult.order.order_id).toMatch(/^order_/);

    const store = getMemoryStore();
    const run = store.copilotRuns.find((item) => item.run_id === preview.run.run_id);
    expect(run?.reached_checkout).toBe(true);
    expect(run?.order_submitted).toBe(true);

    const checkoutEvent = store.copilotMetricEvents.find(
      (event) =>
        event.event_type === "copilot_checkout_converted" &&
        event.run_id === preview.run.run_id,
    );
    expect(checkoutEvent).toBeTruthy();
    expect(store.copilotMetrics.copilot_checkout_conversion_rate).toBe(1);
  });
});
