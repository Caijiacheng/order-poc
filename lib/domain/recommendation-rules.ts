import type {
  CampaignEntity,
  DealerEntity,
  ProductEntity,
  RuleConfigEntity,
  SuggestionScene,
} from "@/lib/memory/types";

function scoreProduct(
  product: ProductEntity,
  dealer: DealerEntity,
  rules: RuleConfigEntity,
  scene: SuggestionScene,
) {
  let score = 0;
  if (dealer.frequent_items.includes(product.sku_id)) {
    score += rules.prefer_frequent_items ? 40 : 20;
  }
  if (dealer.preferred_categories.includes(product.category)) {
    score += 12;
  }
  if (product.is_weekly_focus && scene === "weekly_focus") {
    score += 25;
  }
  if (product.is_new_product && rules.allow_new_product_recommendation) {
    score += 8;
  }
  if (dealer.forbidden_items.includes(product.sku_id)) {
    score -= 1000;
  }
  return score;
}

function sortByScore(
  products: ProductEntity[],
  dealer: DealerEntity,
  rules: RuleConfigEntity,
  scene: SuggestionScene,
) {
  return [...products].sort((left, right) => {
    const scoreDiff =
      scoreProduct(right, dealer, rules, scene) - scoreProduct(left, dealer, rules, scene);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.display_order - right.display_order;
  });
}

export function selectDailyRecommendationCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { products, dealer, rules } = input;
  const filtered = products.filter((item) => {
    if (item.status !== "active") return false;
    if (!rules.allow_new_product_recommendation && item.is_new_product) return false;
    if (dealer.forbidden_items.includes(item.sku_id)) return false;
    return true;
  });

  return sortByScore(filtered, dealer, rules, "daily_recommendation").slice(0, 12);
}

export function selectWeeklyFocusCandidates(input: {
  products: ProductEntity[];
  campaigns: CampaignEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { products, campaigns, dealer, rules } = input;
  const focusSkuIds = new Set<string>();
  for (const campaign of campaigns) {
    if (campaign.status !== "active") continue;
    for (const skuId of campaign.weekly_focus_items) {
      focusSkuIds.add(skuId);
    }
  }

  const filtered = products.filter((item) => {
    if (item.status !== "active") return false;
    if (dealer.forbidden_items.includes(item.sku_id)) return false;
    if (!rules.allow_new_product_recommendation && item.is_new_product) return false;
    return item.is_weekly_focus || focusSkuIds.has(item.sku_id);
  });

  const source = filtered.length > 0 ? filtered : selectDailyRecommendationCandidates(input);
  return sortByScore(source, dealer, rules, "weekly_focus").slice(0, 8);
}
