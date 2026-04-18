import type {
  CampaignEntity,
  DealerEntity,
  DealerSegmentEntity,
  ProductEntity,
  RuleConfigEntity,
  SuggestionScene,
} from "@/lib/memory/types";

type CampaignMatchScope =
  | "target_dealer"
  | "target_segment"
  | "target_customer_type";

export type MatchedCampaign = {
  campaign: CampaignEntity;
  match_scope: CampaignMatchScope;
  match_priority: number;
  fit_score: number;
};

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
  if (
    product.is_weekly_focus &&
    (scene === "weekly_focus" || scene === "campaign_stockup")
  ) {
    score += 25;
  }
  if (
    scene === "hot_sale_restock" &&
    product.tags.some(
      (tag) =>
        tag.includes("高频") ||
        tag.includes("动销") ||
        tag.includes("热销") ||
        tag.includes("高客单"),
    )
  ) {
    score += 18;
  }
  if (scene === "stockout_restock" && dealer.frequent_items.includes(product.sku_id)) {
    score += 14;
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

function filterEligibleProducts(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { products, dealer, rules } = input;
  return products.filter((item) => {
    if (item.status !== "active") return false;
    if (!rules.allow_new_product_recommendation && item.is_new_product) return false;
    if (dealer.forbidden_items.includes(item.sku_id)) return false;
    return true;
  });
}

function dealerMatchesSegment(input: {
  dealer: DealerEntity;
  segment: DealerSegmentEntity;
}) {
  const { dealer, segment } = input;
  return (
    segment.dealer_ids.includes(dealer.customer_id) ||
    segment.customer_types.includes(dealer.customer_type) ||
    segment.channel_types.includes(dealer.channel_type) ||
    segment.city_list.includes(dealer.city)
  );
}

function resolveDealerSegmentIds(input: {
  dealer: DealerEntity;
  dealerSegments: DealerSegmentEntity[];
}) {
  const ids = new Set<string>();
  for (const segment of input.dealerSegments) {
    if (segment.status !== "active") continue;
    if (!dealerMatchesSegment({ dealer: input.dealer, segment })) continue;
    ids.add(segment.segment_id);
  }
  return ids;
}

function resolveMatchScope(input: {
  campaign: CampaignEntity;
  dealer: DealerEntity;
  dealerSegmentIds: Set<string>;
}): { scope: CampaignMatchScope; priority: number } | null {
  const { campaign, dealer, dealerSegmentIds } = input;
  if (
    campaign.target_dealer_ids &&
    campaign.target_dealer_ids.includes(dealer.customer_id)
  ) {
    return { scope: "target_dealer", priority: 0 };
  }
  if (
    campaign.target_segment_ids &&
    campaign.target_segment_ids.some((segmentId) => dealerSegmentIds.has(segmentId))
  ) {
    return { scope: "target_segment", priority: 1 };
  }
  if (campaign.target_customer_types.includes(dealer.customer_type)) {
    return { scope: "target_customer_type", priority: 2 };
  }
  return null;
}

function scoreCampaignFit(input: {
  campaign: CampaignEntity;
  dealer: DealerEntity;
  productMap: Map<string, ProductEntity>;
}) {
  const { campaign, dealer, productMap } = input;
  const focusProducts = campaign.weekly_focus_items
    .map((skuId) => productMap.get(skuId))
    .filter((item): item is ProductEntity => item?.status === "active");
  const focusCategories = new Set(focusProducts.map((item) => item.category));
  const frequentOverlap = focusProducts.filter((item) =>
    dealer.frequent_items.includes(item.sku_id),
  ).length;
  const preferredCategoryOverlap = Array.from(focusCategories).filter((category) =>
    dealer.preferred_categories.includes(category),
  ).length;
  const newProductCount = focusProducts.filter((item) => item.is_new_product).length;
  const hasSmallPack = focusProducts.some(
    (item) =>
      item.spec.includes("250") ||
      item.spec.includes("230") ||
      item.tags.some((tag) => tag.includes("小规格")),
  );
  const hasCombo = focusProducts.some(
    (item) =>
      item.spec.includes("组合") ||
      item.tags.some((tag) => tag.includes("组合")),
  );
  const hasLargePack = focusProducts.some(
    (item) =>
      item.spec.includes("1kg") ||
      item.spec.includes("1.75") ||
      item.spec.includes("2.27") ||
      item.tags.some((tag) => tag.includes("大包装")),
  );

  const campaignText = `${campaign.campaign_name} ${campaign.activity_notes.join(" ")}`;
  const traits = dealer.business_traits.join(" ");
  let traitScore = 0;
  if ((traits.includes("新品") || traits.includes("试销")) && newProductCount > 0) {
    traitScore += 12;
  }
  if ((traits.includes("促销") || traits.includes("活动")) && campaignText.includes("活动")) {
    traitScore += 8;
  }
  if ((traits.includes("周转") || traits.includes("动销")) && frequentOverlap > 0) {
    traitScore += 8;
  }
  if ((traits.includes("组合") || traits.includes("搭配")) && hasCombo) {
    traitScore += 8;
  }
  if ((traits.includes("大包装") || traits.includes("整箱")) && hasLargePack) {
    traitScore += 8;
  }

  let priceSensitivityScore = 0;
  if (dealer.price_sensitivity === "高") {
    if (campaign.promo_type === "small_pack_push" && hasSmallPack) priceSensitivityScore += 12;
    if (campaign.promo_type === "combo_discount" && hasCombo) priceSensitivityScore += 10;
    if (campaign.promo_type === "threshold_rebate") priceSensitivityScore += 6;
  } else if (dealer.price_sensitivity === "中") {
    if (campaign.promo_type === "combo_discount") priceSensitivityScore += 8;
    if (campaign.promo_type === "small_pack_push" && hasSmallPack) priceSensitivityScore += 8;
    if (campaign.promo_type === "threshold_rebate") priceSensitivityScore += 5;
  } else {
    if (campaign.promo_type === "threshold_rebate") priceSensitivityScore += 8;
    if (campaign.promo_type === "combo_discount") priceSensitivityScore += 4;
  }

  let newProductAcceptanceScore = 0;
  if (newProductCount > 0) {
    if (dealer.new_product_acceptance === "高") {
      newProductAcceptanceScore += 15;
    } else if (dealer.new_product_acceptance === "中") {
      newProductAcceptanceScore += 8;
    } else {
      newProductAcceptanceScore -= 12;
    }
  }

  let rhythmScore = 0;
  if (
    (dealer.order_frequency.includes("3-5") || dealer.order_frequency.includes("5-7")) &&
    (campaign.promo_type === "small_pack_push" || campaign.promo_type === "combo_discount")
  ) {
    rhythmScore += 8;
  }
  if (
    (dealer.order_frequency.includes("7-10") || dealer.last_order_days_ago >= 7) &&
    campaign.promo_type === "threshold_rebate"
  ) {
    rhythmScore += 8;
  }

  return (
    frequentOverlap * 20 +
    preferredCategoryOverlap * 14 +
    traitScore +
    priceSensitivityScore +
    newProductAcceptanceScore +
    rhythmScore +
    Math.min(focusProducts.length, 4) * 3
  );
}

export function matchCampaignsForDealer(input: {
  campaigns: CampaignEntity[];
  dealer: DealerEntity;
  dealerSegments: DealerSegmentEntity[];
  products: ProductEntity[];
}): MatchedCampaign[] {
  const dealerSegmentIds = resolveDealerSegmentIds({
    dealer: input.dealer,
    dealerSegments: input.dealerSegments,
  });
  const productMap = new Map(input.products.map((item) => [item.sku_id, item]));

  const matched = input.campaigns
    .filter((campaign) => campaign.status === "active")
    .map((campaign) => {
      const match = resolveMatchScope({
        campaign,
        dealer: input.dealer,
        dealerSegmentIds,
      });
      if (!match) {
        return null;
      }
      return {
        campaign,
        match_scope: match.scope,
        match_priority: match.priority,
        fit_score: scoreCampaignFit({
          campaign,
          dealer: input.dealer,
          productMap,
        }),
      } satisfies MatchedCampaign;
    })
    .filter((item): item is MatchedCampaign => Boolean(item));

  if (matched.length === 0) {
    return [];
  }

  const bestPriority = matched.reduce(
    (min, item) => Math.min(min, item.match_priority),
    Number.POSITIVE_INFINITY,
  );

  return matched
    .filter((item) => item.match_priority === bestPriority)
    .sort((left, right) => {
      if (left.fit_score !== right.fit_score) {
        return right.fit_score - left.fit_score;
      }
      return right.campaign.updated_at.localeCompare(left.campaign.updated_at);
    });
}

export function selectHotSaleRestockCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { dealer, rules } = input;
  const eligible = filterEligibleProducts(input);
  const filtered = eligible.filter(
    (item) =>
      dealer.frequent_items.includes(item.sku_id) ||
      dealer.preferred_categories.includes(item.category) ||
      item.tags.some(
        (tag) =>
          tag.includes("高频") ||
          tag.includes("动销") ||
          tag.includes("热销") ||
          tag.includes("高客单"),
      ),
  );
  const source = filtered.length > 0 ? filtered : eligible;
  return sortByScore(source, dealer, rules, "hot_sale_restock").slice(0, 12);
}

export function selectStockoutRestockCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { dealer, rules } = input;
  const eligible = filterEligibleProducts(input);
  const frequentFirst = eligible.filter((item) =>
    dealer.frequent_items.includes(item.sku_id),
  );
  const source = frequentFirst.length > 0 ? frequentFirst : eligible;
  return sortByScore(source, dealer, rules, "stockout_restock").slice(0, 12);
}

export function selectCampaignStockupCandidates(input: {
  products: ProductEntity[];
  campaign?: CampaignEntity;
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const { products, campaign, dealer, rules } = input;
  if (!campaign || campaign.status !== "active") {
    return [];
  }

  const focusSkuIds = new Set(campaign.weekly_focus_items);
  const eligible = filterEligibleProducts({ products, dealer, rules });
  const filtered = eligible.filter(
    (item) => focusSkuIds.has(item.sku_id),
  );
  return sortByScore(filtered, dealer, rules, "campaign_stockup").slice(0, 8);
}

export function selectDailyRecommendationCandidates(input: {
  products: ProductEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  return selectStockoutRestockCandidates(input);
}

export function selectWeeklyFocusCandidates(input: {
  products: ProductEntity[];
  campaigns: CampaignEntity[];
  dealer: DealerEntity;
  rules: RuleConfigEntity;
}) {
  const fallbackCampaign = input.campaigns.find(
    (campaign) =>
      campaign.status === "active" &&
      campaign.target_customer_types.includes(input.dealer.customer_type),
  );
  return selectCampaignStockupCandidates({
    products: input.products,
    campaign: fallbackCampaign,
    dealer: input.dealer,
    rules: input.rules,
  });
}
