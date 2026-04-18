import type { CartItem, CartSummary, DealerEntity, ProductEntity, RuleConfigEntity } from "@/lib/memory/types";

export function computeCartSummary(
  items: CartItem[],
  thresholdAmount: number,
): CartSummary {
  const totalAmount = items.reduce(
    (sum, item) => sum + item.qty * item.price_per_case,
    0,
  );
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
  const gap = Math.max(0, thresholdAmount - totalAmount);

  return {
    item_count: itemCount,
    sku_count: items.length,
    total_amount: totalAmount,
    threshold_amount: thresholdAmount,
    gap_to_threshold: gap,
    threshold_reached: gap === 0,
  };
}

export function findThresholdTopupCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
  gapToThreshold: number;
}) {
  const { products, dealer, rules, gapToThreshold } = input;
  if (gapToThreshold <= 0) {
    return [];
  }
  if (
    rules.cart_gap_trigger_amount > 0 &&
    gapToThreshold > rules.cart_gap_trigger_amount
  ) {
    return [];
  }

  const activeProducts = products.filter((item) => {
    if (item.status !== "active") return false;
    if (dealer.forbidden_items.includes(item.sku_id)) return false;
    if (!rules.allow_new_product_recommendation && item.is_new_product) return false;
    return true;
  });

  const sorted = [...activeProducts].sort((left, right) => {
    const leftScore =
      (rules.prefer_frequent_items && dealer.frequent_items.includes(left.sku_id) ? 10 : 0) +
      left.price_per_case;
    const rightScore =
      (rules.prefer_frequent_items && dealer.frequent_items.includes(right.sku_id) ? 10 : 0) +
      right.price_per_case;
    return rightScore - leftScore;
  });

  return sorted.slice(0, 3).map((item) => ({
    sku_id: item.sku_id,
    sku_name: item.sku_name,
    suggested_qty: Math.max(1, Math.ceil(gapToThreshold / item.price_per_case)),
    reason: `当前还差 ¥${gapToThreshold} 可补齐本次凑单目标，推荐补充 ${item.sku_name}。`,
    effect: "贴近凑单目标",
  }));
}

export function findBoxAdjustments(input: {
  cartItems: CartItem[];
  rules: RuleConfigEntity;
}) {
  const { cartItems, rules } = input;
  if (!rules.box_adjust_if_close) {
    return [];
  }

  const adjustments: Array<{
    sku_id: string;
    from_qty: number;
    to_qty: number;
    reason: string;
  }> = [];

  for (const item of cartItems) {
    const remainder = item.qty % item.box_multiple;
    if (remainder === 0) {
      continue;
    }
    const add = item.box_multiple - remainder;
    if (add > rules.box_adjust_distance_limit) {
      continue;
    }
    adjustments.push({
      sku_id: item.sku_id,
      from_qty: item.qty,
      to_qty: item.qty + add,
      reason: `距离整箱倍数仅差 ${add}，建议补齐到 ${item.qty + add}。`,
    });
  }

  return adjustments;
}

export function findPairSuggestions(input: {
  cartItems: CartItem[];
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { cartItems, products, dealer, rules } = input;
  if (!rules.prefer_pair_items) {
    return [];
  }
  const inCart = new Set(cartItems.map((item) => item.sku_id));
  const productMap = new Map(products.map((item) => [item.sku_id, item]));
  const suggestions: Array<{ sku_id: string; sku_name: string; suggested_qty: number; reason: string }> = [];

  for (const cartItem of cartItems) {
    const product = productMap.get(cartItem.sku_id);
    if (!product) continue;

    for (const pairSku of product.pair_items) {
      if (inCart.has(pairSku)) continue;
      if (dealer.forbidden_items.includes(pairSku)) continue;
      const pairProduct = productMap.get(pairSku);
      if (!pairProduct || pairProduct.status !== "active") continue;
      if (!rules.allow_new_product_recommendation && pairProduct.is_new_product) continue;

      inCart.add(pairSku);
      suggestions.push({
        sku_id: pairSku,
        sku_name: pairProduct.sku_name,
        suggested_qty: 1,
        reason: `${product.sku_name} 常与 ${pairProduct.sku_name} 搭配采购。`,
      });
    }
  }

  return suggestions.slice(0, 5);
}
