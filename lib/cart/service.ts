import { randomUUID } from "node:crypto";

import { recordCopilotMetricEvent } from "@/lib/copilot/metrics";
import { findBoxAdjustments, findPairSuggestions, findThresholdTopupCandidates, computeCartSummary } from "@/lib/domain/cart-rules";
import { BusinessError } from "@/lib/domain/errors";
import {
  markRecommendationItemApplied,
  markRecommendationItemDecision,
  markSubmittedItemsForSession,
} from "@/lib/domain/recommendation-lifecycle";
import { getMemoryStore, nowIso } from "@/lib/memory/store";
import type { CartItem, CartSession, DealerEntity } from "@/lib/memory/types";
import { withSpan } from "@/lib/tracing/telemetry";

function getProductBySku(skuId: string) {
  const store = getMemoryStore();
  return store.products.find((item) => item.sku_id === skuId) ?? null;
}

function getDealerById(customerId?: string): DealerEntity | null {
  if (!customerId) {
    return null;
  }
  const store = getMemoryStore();
  return store.dealers.find((item) => item.customer_id === customerId) ?? null;
}

function recalcCartSummary(cart: CartSession) {
  const store = getMemoryStore();
  cart.summary = computeCartSummary(cart.items, store.rules.threshold_amount);
  cart.updated_at = nowIso();
}

export function getOrCreateCartSession(sessionId: string): CartSession {
  const store = getMemoryStore();
  const existing = store.cartSessions[sessionId];
  if (existing) {
    recalcCartSummary(existing);
    return existing;
  }

  const timestamp = nowIso();
  const session: CartSession = {
    session_id: sessionId,
    customer_id: undefined,
    items: [],
    summary: computeCartSummary([], store.rules.threshold_amount),
    submitted_orders: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.cartSessions[sessionId] = session;
  return session;
}

export function setCartCustomer(sessionId: string, customerId: string) {
  const session = getOrCreateCartSession(sessionId);
  if (
    session.customer_id &&
    session.customer_id !== customerId &&
    session.items.length > 0
  ) {
    throw new BusinessError(
      "CONFLICT",
      "当前购物车已绑定其他经销商且存在商品，请先清空购物车后再切换客户。",
      409,
    );
  }
  session.customer_id = customerId;
  session.updated_at = nowIso();
  return session;
}

export function getCartBySession(sessionId: string) {
  return getOrCreateCartSession(sessionId);
}

function upsertCartItem(session: CartSession, item: CartItem) {
  const existingIndex = session.items.findIndex((record) => record.sku_id === item.sku_id);
  if (existingIndex >= 0) {
    session.items[existingIndex] = item;
  } else {
    session.items.push(item);
  }
}

export function addCartItem(input: {
  session_id: string;
  sku_id?: string;
  qty?: number;
  source?: "manual" | "recommendation";
  recommendation_item_id?: string;
  lifecycle_action?: "apply" | "ignore" | "reject";
  rejected_reason?: string;
}) {
  const session = getOrCreateCartSession(input.session_id);
  const before = session.summary.total_amount;

  if (
    input.recommendation_item_id &&
    (input.lifecycle_action === "ignore" || input.lifecycle_action === "reject")
  ) {
    const item = markRecommendationItemDecision({
      recommendation_item_id: input.recommendation_item_id,
      decision: input.lifecycle_action === "ignore" ? "ignored" : "rejected",
      rejected_reason: input.rejected_reason,
    });
    if (!item) {
      throw new BusinessError("NOT_FOUND", "推荐条目不存在", 404);
    }
    recalcCartSummary(session);
    return { cart: session, before_amount: before, after_amount: session.summary.total_amount, no_op: true };
  }

  if (input.recommendation_item_id) {
    const store = getMemoryStore();
    const record = store.recommendationItems.find(
      (item) => item.recommendation_item_id === input.recommendation_item_id,
    );
    if (!record) {
      throw new BusinessError("NOT_FOUND", "推荐条目不存在", 404);
    }

    const product = getProductBySku(record.sku_id);
    if (!product) {
      throw new BusinessError("VALIDATION_ERROR", `商品 ${record.sku_id} 不存在`, 400);
    }

    const current = session.items.find((item) => item.sku_id === record.sku_id);
    const nextQty =
      record.action_type === "add_to_cart"
        ? Math.max(current?.qty ?? 0, record.suggested_qty)
        : record.suggested_qty;

    const applied = markRecommendationItemApplied({
      recommendation_item_id: input.recommendation_item_id,
      applied_qty: nextQty,
      applied_by: "user",
    });

    if (applied.reason === "terminal_ignored_or_rejected") {
      throw new BusinessError(
        "CONFLICT",
        "该推荐条目已被忽略/拒绝，不能再次自动应用。",
        409,
      );
    }

    if (applied.reason === "already_applied" && current && current.qty === nextQty) {
      recalcCartSummary(session);
      return {
        cart: session,
        before_amount: before,
        after_amount: session.summary.total_amount,
        no_op: true,
      };
    }

    const timestamp = nowIso();
    const cartItem: CartItem = {
      sku_id: product.sku_id,
      sku_name: product.sku_name,
      qty: nextQty,
      price_per_case: product.price_per_case,
      box_multiple: product.box_multiple,
      source: "recommendation",
      recommendation_item_id: input.recommendation_item_id,
      added_at: current?.added_at ?? timestamp,
      updated_at: timestamp,
    };

    upsertCartItem(session, cartItem);
    recalcCartSummary(session);

    const storeMetrics = getMemoryStore().metrics;
    storeMetrics.addToCartFromSuggestion += 1;
    return {
      cart: session,
      before_amount: before,
      after_amount: session.summary.total_amount,
      no_op: false,
    };
  }

  if (!input.sku_id) {
    throw new BusinessError("VALIDATION_ERROR", "sku_id 不能为空", 400, {
      sku_id: "sku_id 不能为空",
    });
  }
  if (!input.qty || input.qty <= 0) {
    throw new BusinessError("VALIDATION_ERROR", "qty 必须大于 0", 400, {
      qty: "qty 必须大于 0",
    });
  }

  const product = getProductBySku(input.sku_id);
  if (!product || product.status !== "active") {
    throw new BusinessError("NOT_FOUND", `商品 ${input.sku_id} 不存在或不可用`, 404);
  }

  const timestamp = nowIso();
  const existing = session.items.find((item) => item.sku_id === input.sku_id);
  const cartItem: CartItem = {
    sku_id: product.sku_id,
    sku_name: product.sku_name,
    qty: input.qty,
    price_per_case: product.price_per_case,
    box_multiple: product.box_multiple,
    source: input.source ?? "manual",
    recommendation_item_id: input.recommendation_item_id,
    added_at: existing?.added_at ?? timestamp,
    updated_at: timestamp,
  };
  upsertCartItem(session, cartItem);
  recalcCartSummary(session);

  return {
    cart: session,
    before_amount: before,
    after_amount: session.summary.total_amount,
    no_op: false,
  };
}

export function patchCartItem(input: {
  session_id: string;
  sku_id: string;
  qty: number;
  recommendation_item_id?: string;
}) {
  const session = getOrCreateCartSession(input.session_id);
  const before = session.summary.total_amount;
  const index = session.items.findIndex((item) => item.sku_id === input.sku_id);
  if (index < 0) {
    throw new BusinessError("NOT_FOUND", "购物车商品不存在", 404);
  }

  if (input.qty <= 0) {
    session.items.splice(index, 1);
    recalcCartSummary(session);
    return { cart: session, before_amount: before, after_amount: session.summary.total_amount };
  }

  session.items[index].qty = input.qty;
  session.items[index].updated_at = nowIso();
  if (input.recommendation_item_id) {
    markRecommendationItemApplied({
      recommendation_item_id: input.recommendation_item_id,
      applied_qty: input.qty,
      applied_by: "user",
    });
    session.items[index].recommendation_item_id = input.recommendation_item_id;
    session.items[index].source = "recommendation";
  }
  recalcCartSummary(session);

  return { cart: session, before_amount: before, after_amount: session.summary.total_amount };
}

export function removeCartItem(input: { session_id: string; sku_id: string }) {
  const session = getOrCreateCartSession(input.session_id);
  const before = session.summary.total_amount;
  const index = session.items.findIndex((item) => item.sku_id === input.sku_id);
  if (index < 0) {
    throw new BusinessError("NOT_FOUND", "购物车商品不存在", 404);
  }
  session.items.splice(index, 1);
  recalcCartSummary(session);
  return { cart: session, before_amount: before, after_amount: session.summary.total_amount };
}

export function replaceCartItems(
  sessionId: string,
  items: Array<{ sku_id: string; qty: number }>,
) {
  const session = getOrCreateCartSession(sessionId);
  const nextItems: CartItem[] = [];
  for (const item of items) {
    const product = getProductBySku(item.sku_id);
    if (!product || product.status !== "active") {
      continue;
    }
    if (item.qty <= 0) {
      continue;
    }
    nextItems.push({
      sku_id: product.sku_id,
      sku_name: product.sku_name,
      qty: item.qty,
      price_per_case: product.price_per_case,
      box_multiple: product.box_multiple,
      source: "manual",
      added_at: nowIso(),
      updated_at: nowIso(),
    });
  }
  session.items = nextItems;
  recalcCartSummary(session);
  return session;
}

export function buildDeterministicCartInsights(sessionId: string, customerId?: string) {
  const store = getMemoryStore();
  const session = getOrCreateCartSession(sessionId);
  const dealer = getDealerById(customerId ?? session.customer_id ?? undefined);
  const activeDealer = dealer ?? store.dealers.find((item) => item.status === "active");
  if (!activeDealer) {
    throw new BusinessError("NOT_FOUND", "经销商不存在", 404);
  }

  const thresholdGap = Math.max(
    0,
    store.rules.cart_target_amount - session.summary.total_amount,
  );

  const thresholdCandidates = findThresholdTopupCandidates({
    products: store.products,
    dealer: activeDealer,
    rules: store.rules,
    gapToThreshold: thresholdGap,
  });
  const boxAdjustments = findBoxAdjustments({
    cartItems: session.items,
    rules: store.rules,
  });
  const pairSuggestions = findPairSuggestions({
    cartItems: session.items,
    products: store.products,
    dealer: activeDealer,
    rules: store.rules,
  });

  return {
    session,
    dealer: activeDealer,
    thresholdGap,
    thresholdCandidates,
    boxAdjustments,
    pairSuggestions,
  };
}

export async function submitCart(sessionId: string) {
  const session = getOrCreateCartSession(sessionId);
  const dealer = getDealerById(session.customer_id);
  const submittedItems = session.items.map((item) => ({
    商品: item.sku_name,
    箱数: item.qty,
    单价: item.price_per_case,
    行金额: item.qty * item.price_per_case,
  }));
  const submittedSummary = {
    SKU数: session.summary.sku_count,
    件数: session.summary.item_count,
    当前金额: session.summary.total_amount,
    起订金额: session.summary.threshold_amount,
    是否达到起订额: session.summary.threshold_reached,
  };

  return withSpan(
    "confirm.submit-order",
    {
      "session.id": sessionId,
      "customer.id": session.customer_id ?? "unknown",
    },
    async (traceId) => {
      const store = getMemoryStore();

      if (session.items.length === 0) {
        throw new BusinessError("CONFLICT", "购物车为空，无法提交", 409);
      }

      const submittedSkuIds = session.items.map((item) => item.sku_id);
      const order = {
        order_id: `order_${randomUUID().replace(/-/g, "")}`,
        submitted_at: nowIso(),
        total_amount: session.summary.total_amount,
        item_count: session.summary.item_count,
      };

      session.submitted_orders.unshift(order);
      markSubmittedItemsForSession({
        session_id: sessionId,
        submitted_sku_ids: submittedSkuIds,
      });

      const appliedDraft = [...store.copilotDrafts]
        .filter(
          (draft) =>
            draft.status === "applied" &&
            draft.session_id === sessionId &&
            draft.customer_id === session.customer_id,
        )
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
      if (appliedDraft) {
        const run = store.copilotRuns.find((item) => item.run_id === appliedDraft.run_id);
        if (run && !run.order_submitted) {
          run.reached_checkout = true;
          run.order_submitted = true;
          run.updated_at = nowIso();
          recordCopilotMetricEvent({
            run_id: run.run_id,
            job_id: run.job_id,
            customer_id: run.customer_id,
            event_type: "copilot_checkout_converted",
            payload: {
              session_id: sessionId,
              order_id: order.order_id,
            },
          });
        }
      }

      if (session.summary.threshold_reached) {
        store.metrics.thresholdReachedCount += 1;
      }
      store.metrics.totalCartAmountAfter += session.summary.total_amount;

      session.items = [];
      recalcCartSummary(session);
      return {
        order,
        cart: session,
        summary: {
          trace_id: traceId,
        },
      };
    },
    {
      input: {
        中文说明: "这是结算页提交订单请求，记录提交前购物车里的商品和金额。",
        会话ID: sessionId,
        经销商ID: dealer?.customer_id ?? session.customer_id ?? "unknown",
        经销商名称: dealer?.customer_name ?? "未绑定经销商",
        提交前购物车摘要: submittedSummary,
        提交商品: submittedItems,
      },
      output: (result) => ({
        中文说明: "订单已经提交成功。",
        经销商名称: dealer?.customer_name ?? "未绑定经销商",
        订单ID: result.order.order_id,
        提交时间: result.order.submitted_at,
        订单金额: result.order.total_amount,
        商品件数: result.order.item_count,
        提交后购物车摘要: {
          SKU数: result.cart.summary.sku_count,
          件数: result.cart.summary.item_count,
          当前金额: result.cart.summary.total_amount,
        },
      }),
    },
  );
}
