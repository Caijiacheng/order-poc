"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Loader2, ShoppingCart, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addCartItem,
  fetchActiveDealers,
  fetchActiveProducts,
  fetchCart,
  fetchPublishedSuggestions,
  formatMoney,
  refineBundleTemplate,
} from "@/lib/frontstage/api";
import { getCampaignPromoLabel } from "@/lib/domain/campaigns";
import type {
  ActivityHighlight,
  BundleTemplate,
  BundleTemplateItem,
  CartSession,
  DealerEntity,
  ProductEntity,
  PublishedSuggestionsCartSummary,
} from "@/lib/memory/types";

type PublishedSuggestionsState = Awaited<ReturnType<typeof fetchPublishedSuggestions>>;
type ProcurementView = "all" | "frequent" | "replenishment" | "campaign" | "new";
type ReasonDrawerState =
  | { type: "bundle"; template: BundleTemplate }
  | { type: "activity"; activity: ActivityHighlight }
  | null;

const VIEW_OPTIONS: Array<{ key: ProcurementView; label: string }> = [
  { key: "all", label: "全部商品" },
  { key: "frequent", label: "常购" },
  { key: "replenishment", label: "待补货" },
  { key: "campaign", label: "活动" },
  { key: "new", label: "新品" },
];

const BUNDLE_NEED_SUGGESTIONS = [
  "这次多带点小包装",
  "给烧烤档口备货",
  "优先带活动货",
] as const;

const EMPTY_SUMMARY: PublishedSuggestionsCartSummary = {
  source: "template_projection",
  sku_count: 0,
  item_count: 0,
  total_amount: 0,
  threshold_amount: 0,
  gap_to_threshold: 0,
  threshold_reached: false,
};

type EvidenceLine = {
  label: string;
  value: string;
};

type BundleDraftState = {
  userNeed: string;
  summary: string;
  items: BundleTemplateItem[];
};

function mergeItems(items: BundleTemplateItem[]) {
  const map = new Map<string, BundleTemplateItem>();
  for (const item of items) {
    const existing = map.get(item.sku_id);
    if (!existing || item.suggested_qty > existing.suggested_qty) {
      map.set(item.sku_id, item);
    }
  }
  return Array.from(map.values());
}

function toBundleCardSummary(template: BundleTemplate, dealer: DealerEntity | null) {
  const frequentCount = dealer
    ? template.items.filter((item) => dealer.frequent_items.includes(item.sku_id)).length
    : 0;

  if (template.template_type === "hot_sale_restock") {
    return frequentCount > 0
      ? `这组先补你门店走得快的常带货，优先稳住这一轮周转。`
      : "这组先补高动销基础货，优先稳住这一轮周转。";
  }
  if (template.template_type === "stockout_restock") {
    return frequentCount > 0
      ? `这组先补门店常带的基础货，把容易断的日常缺口先补上。`
      : "这组先补基础货缺口，把容易断的日常货先补上。";
  }
  return "这组围绕本周活动提前备货，方便一次把活动货带齐。";
}

function toDealerCadence(dealer: DealerEntity) {
  return `平时约 ${dealer.order_frequency} 下一次单，当前距上次进货 ${dealer.last_order_days_ago} 天。`;
}

function toBundleSourceLabel(template: BundleTemplate) {
  return template.source === "published_recommendation" ? "本周优先" : "门店常带";
}

function toBundleItemPreview(template: BundleTemplate) {
  const preview = template.items
    .slice(0, 2)
    .map((item) => `${item.sku_name} ${item.suggested_qty}箱`)
    .join("、");
  if (!preview) {
    return "当前暂无建议商品。";
  }
  if (template.items.length <= 2) {
    return preview;
  }
  return `${preview} 等 ${template.items.length} 个商品`;
}

function toBundlePriorityLabel(input: {
  template: BundleTemplate;
  userNeed?: string;
}) {
  const userNeed = input.userNeed?.trim();
  if (userNeed) {
    return `这次优先照着“${userNeed}”来组货。`;
  }
  if (input.template.template_type === "hot_sale_restock") {
    return "先补卖得快、周转快的基础货，减少临时断货。";
  }
  if (input.template.template_type === "stockout_restock") {
    return "先把门店常带的基础货补齐，保证日常出货不断档。";
  }
  return "围绕本周活动商品提前备货，避免活动临近再补货。";
}

function buildBundleEvidence(input: {
  template: BundleTemplate;
  dealer: DealerEntity | null;
  items: BundleTemplateItem[];
  userNeed?: string;
}): EvidenceLine[] {
  const { template, dealer, items, userNeed } = input;
  const lines: EvidenceLine[] = [];
  if (dealer) {
    const frequentMatches = items
      .filter((item) => dealer.frequent_items.includes(item.sku_id))
      .map((item) => item.sku_name);
    if (frequentMatches.length > 0) {
      lines.push({
        label: "门店常买",
        value: frequentMatches.slice(0, 3).join("、"),
      });
    }
    lines.push({
      label: "进货节奏",
      value: toDealerCadence(dealer),
    });
  }

  if (userNeed?.trim()) {
    lines.push({
      label: "这次需求",
      value: `这次优先按“${userNeed.trim()}”来整理这组补货。`,
    });
  }

  if (template.template_type === "campaign_stockup") {
    lines.push({
      label: "对应活动",
      value: "优先覆盖当前活动和周推相关商品，方便一次带齐。",
    });
  }

  lines.push({
    label: "这组重点",
    value: toBundlePriorityLabel({ template, userNeed }),
  });

  return lines;
}

function toBundleRationale(input: {
  template: BundleTemplate;
  dealer: DealerEntity | null;
  items: BundleTemplateItem[];
  userNeed?: string;
}) {
  const { template, dealer, items, userNeed } = input;
  const frequentMatches = dealer
    ? items
        .filter((item) => dealer.frequent_items.includes(item.sku_id))
        .map((item) => item.sku_name)
    : [];

  if (userNeed?.trim()) {
    return `这组已经按“${userNeed.trim()}”重新组过货，会优先带更贴近这次需求的商品。`;
  }
  if (template.template_type === "campaign_stockup") {
    return "这组主要围绕本周活动商品整理，方便你这次一次把活动货备齐。";
  }
  if (frequentMatches.length > 0) {
    return `这组里有你门店常买的 ${frequentMatches.slice(0, 2).join("、")}，结合当前进货节奏，建议这次优先补上。`;
  }
  if (dealer) {
    return `结合你门店 ${dealer.order_frequency} 的进货节奏和当前这单的备货方向，整理出这组更适合先带上的商品。`;
  }
  return "这组建议主要围绕当前门店的进货节奏和备货方向整理。";
}

function toActivityPromoLabel(promoType: string) {
  return getCampaignPromoLabel(promoType);
}

function toActivityPromoExplanation(activity: ActivityHighlight) {
  if (activity.promo_type === "threshold_rebate") {
    return `这次是满额返利活动，单次带货达到 ${formatMoney(activity.promo_threshold)} 就能参与。`;
  }
  if (activity.promo_type === "combo_discount") {
    return "这次是组合搭售活动，建议把活动商品一次带齐，方便连带出货。";
  }
  if (activity.promo_type === "small_pack_push") {
    return "这次主推小规格商品，更适合高频补货和便利陈列。";
  }
  return `这次活动达到 ${formatMoney(activity.promo_threshold)} 即可参与。`;
}

function toActivityValueSummary(activity: ActivityHighlight) {
  return `围绕「${activity.activity_name}」活动要求组织备货，包含 ${activity.items.length} 款活动商品。`;
}

function buildActivityEvidence(
  activity: ActivityHighlight,
  dealer: DealerEntity | null,
): EvidenceLine[] {
  const lines: EvidenceLine[] = [
    {
      label: "对应活动",
      value: `${activity.activity_name} · ${toActivityPromoLabel(activity.promo_type)}`,
    },
    {
      label: "活动玩法",
      value: toActivityPromoExplanation(activity),
    },
    {
      label: "建议带上",
      value: activity.items
        .slice(0, 3)
        .map((item) => item.sku_name)
        .join("、"),
    },
  ];

  if (activity.activity_notes.length > 0) {
    lines.push({
      label: "活动重点",
      value: activity.activity_notes.join("；"),
    });
  }

  if (dealer) {
    lines.push({
      label: "适用门店",
      value: `${dealer.city} · ${dealer.customer_type}`,
    });
  }

  return lines;
}

export default function PurchasePage() {
  const router = useRouter();
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [cart, setCart] = useState<CartSession | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [suggestions, setSuggestions] = useState<PublishedSuggestionsState | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewFilter, setViewFilter] = useState<ProcurementView>("all");
  const [qtyDraftBySku, setQtyDraftBySku] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [reasonDrawer, setReasonDrawer] = useState<ReasonDrawerState>(null);
  const [bundleNeed, setBundleNeed] = useState("");
  const [bundleDraft, setBundleDraft] = useState<BundleDraftState | null>(null);
  const [refiningBundle, setRefiningBundle] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      setLoadingPage(true);
      try {
        const [dealerList, productList, cartSession] = await Promise.all([
          fetchActiveDealers(),
          fetchActiveProducts(),
          fetchCart(),
        ]);
        setDealers(dealerList);
        setProducts(productList);
        setCart(cartSession);
        setDealerId(
          (prev) => prev || cartSession.customer_id || dealerList[0]?.customer_id || "",
        );
      } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载选货页面失败");
      } finally {
        setLoadingPage(false);
      }
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    const loadSuggestions = async () => {
      if (!dealerId) {
        return;
      }
      setLoadingSuggestions(true);
      setErrorMessage("");
      try {
        const result = await fetchPublishedSuggestions(dealerId);
        setSuggestions(result);
        setSuccessMessage(
          result.summary.published
            ? "已加载本周进货建议，可从当前页面直接组货下单。"
            : "当前先按门店常带商品展示，可直接组货下单。",
        );
      } catch (error) {
        setSuggestions(null);
        setErrorMessage(error instanceof Error ? error.message : "加载进货建议失败");
      } finally {
        setLoadingSuggestions(false);
      }
    };

    void loadSuggestions();
  }, [dealerId]);

  useEffect(() => {
    setBundleNeed("");
    setBundleDraft(null);
  }, [reasonDrawer]);

  const currentDealer = useMemo(
    () => dealers.find((item) => item.customer_id === dealerId) ?? null,
    [dealerId, dealers],
  );

  const categories = useMemo(
    () => Array.from(new Set(products.map((item) => item.category))),
    [products],
  );

  const frequentSkuSet = useMemo(
    () => new Set(currentDealer?.frequent_items ?? []),
    [currentDealer],
  );

  const bundleTemplates = useMemo(() => suggestions?.bundleTemplates ?? [], [suggestions]);
  const activityHighlights = useMemo(() => suggestions?.activityHighlights ?? [], [suggestions]);

  const replenishmentSkuSet = useMemo(() => {
    const stockout = bundleTemplates.find(
      (template) => template.template_type === "stockout_restock",
    );
    return new Set((stockout?.items ?? []).map((item) => item.sku_id));
  }, [bundleTemplates]);

  const campaignSkuSet = useMemo(() => {
    const set = new Set<string>();
    for (const activity of activityHighlights) {
      for (const skuId of activity.sku_ids) {
        set.add(skuId);
      }
    }
    return set;
  }, [activityHighlights]);

  const recommendedSkuSet = useMemo(() => {
    const set = new Set<string>();
    for (const template of bundleTemplates) {
      for (const item of template.items) {
        set.add(item.sku_id);
      }
    }
    return set;
  }, [bundleTemplates]);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const q = searchText.trim().toLowerCase();
        const matchQ =
          q.length === 0 ||
          product.sku_name.toLowerCase().includes(q) ||
          product.sku_id.toLowerCase().includes(q) ||
          product.tags.join(" ").toLowerCase().includes(q);
        const matchCategory =
          categoryFilter === "all" || product.category === categoryFilter;

        let matchView = true;
        if (viewFilter === "frequent") {
          matchView = frequentSkuSet.has(product.sku_id);
        } else if (viewFilter === "replenishment") {
          matchView = replenishmentSkuSet.has(product.sku_id);
        } else if (viewFilter === "campaign") {
          matchView = campaignSkuSet.has(product.sku_id) || product.is_weekly_focus;
        } else if (viewFilter === "new") {
          matchView = product.is_new_product;
        }

        return matchQ && matchCategory && matchView;
      }),
    [
      campaignSkuSet,
      categoryFilter,
      frequentSkuSet,
      products,
      replenishmentSkuSet,
      searchText,
      viewFilter,
    ],
  );

  const displaySummary = cart?.summary ?? suggestions?.cartSummary ?? EMPTY_SUMMARY;
  const recommendationDigest = useMemo(() => {
    const skuSet = new Set<string>();
    for (const template of bundleTemplates) {
      for (const item of template.items) {
        skuSet.add(item.sku_id);
      }
    }
    return {
      templateCount: bundleTemplates.length,
      activityCount: activityHighlights.length,
      skuCount: skuSet.size,
    };
  }, [activityHighlights.length, bundleTemplates]);

  const activeBundleItems =
    reasonDrawer?.type === "bundle"
      ? bundleDraft?.items ?? reasonDrawer.template.items
      : [];
  const activeBundleAmount = activeBundleItems.reduce((sum, item) => sum + item.line_amount, 0);
  const activeBundleSummary =
    reasonDrawer?.type === "bundle"
      ? bundleDraft?.summary ??
        toBundleRationale({
          template: reasonDrawer.template,
          dealer: currentDealer,
          items: activeBundleItems,
        })
      : "";
  const activeBundleRationale =
    reasonDrawer?.type === "bundle"
      ? toBundleRationale({
          template: reasonDrawer.template,
          dealer: currentDealer,
          items: activeBundleItems,
          userNeed: bundleDraft?.userNeed,
        })
      : "";
  const activeBundleEvidence =
    reasonDrawer?.type === "bundle"
      ? buildBundleEvidence({
          template: reasonDrawer.template,
          dealer: currentDealer,
          items: activeBundleItems,
          userNeed: bundleDraft?.userNeed,
        })
      : [];

  const reloadCart = async () => {
    const latest = await fetchCart();
    setCart(latest);
  };

  const handleAddProduct = async (product: ProductEntity, qty: number) => {
    const actionKey = `sku:${product.sku_id}`;
    setBusyKey(actionKey);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await addCartItem({
        customerId: dealerId || undefined,
        sku_id: product.sku_id,
        qty: Math.max(1, qty),
        source: "manual",
      });
      await reloadCart();
      setSuccessMessage(`已加入采购清单：${product.sku_name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加入采购清单失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleQuickOrder = async (input: {
    key: string;
    items: BundleTemplateItem[];
    successLabel: string;
    navigate: boolean;
  }) => {
    const merged = mergeItems(input.items);
    if (!dealerId || merged.length === 0) {
      if (input.navigate) {
        router.push("/order-submit");
      }
      return;
    }
    setBusyKey(input.key);
    setErrorMessage("");
    setSuccessMessage("");
    let count = 0;
    try {
      for (const item of merged) {
        await addCartItem({
          customerId: dealerId,
          sku_id: item.sku_id,
          qty: Math.max(1, item.suggested_qty),
          source: "manual",
        });
        count += 1;
      }
      await reloadCart();
      setSuccessMessage(`已加入 ${count} 款商品：${input.successLabel}`);
      if (input.navigate) {
        router.push("/order-submit");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "快速下单失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleBundleNeedRefresh = async () => {
    if (reasonDrawer?.type !== "bundle") {
      return;
    }
    const trimmedNeed = bundleNeed.trim();
    if (!trimmedNeed || !dealerId) {
      setErrorMessage("请先补一句这次需求，再让 AI 帮你组货。");
      return;
    }
    setRefiningBundle(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await refineBundleTemplate({
        customerId: dealerId,
        templateType: reasonDrawer.template.template_type,
        currentItems: activeBundleItems,
        userNeed: trimmedNeed,
      });
      setBundleDraft({
        userNeed: trimmedNeed,
        summary: result.summary,
        items: result.items,
      });
      setSuccessMessage("AI 已按这次需求重新组货。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 组货失败");
    } finally {
      setRefiningBundle(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="purchase-workbench">
      <Card className="border-slate-200 bg-white/95">
        <CardHeader className="space-y-3">
          <Badge className="w-fit rounded-full px-3 py-1">开始选货</Badge>
          <CardTitle className="text-3xl leading-tight text-slate-950">
            本周进货建议 + 活动专区 + 商品选购
          </CardTitle>
          <p className="text-sm leading-6 text-slate-600">
            点击卡片上的“快速下单”会先把建议商品加入采购清单，再进入结算页，不会直接提交订单。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">切换门店</p>
            <div className="mt-2">
              <Select value={dealerId} onValueChange={setDealerId} disabled={loadingPage}>
                <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                  <SelectValue placeholder="选择经销商" />
                </SelectTrigger>
                <SelectContent>
                  {dealers.map((dealer) => (
                    <SelectItem key={dealer.customer_id} value={dealer.customer_id}>
                      {dealer.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {currentDealer ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-medium text-slate-900">{currentDealer.customer_name}</p>
              <p className="mt-1 text-slate-600">
                {currentDealer.city} · {currentDealer.customer_type} · 下单频次{" "}
                {currentDealer.order_frequency}
              </p>
            </div>
          ) : null}

          {loadingSuggestions ? (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              正在同步本周进货建议...
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}
          {successMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {successMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm">
            <p className="font-medium text-slate-900">本页建议摘要</p>
            <p className="mt-1 text-slate-700">
              已为当前门店整理 {recommendationDigest.templateCount} 组进货建议，覆盖{" "}
              {recommendationDigest.skuCount} 个推荐商品；
              {recommendationDigest.activityCount > 0
                ? `另有 ${recommendationDigest.activityCount} 个活动可直接带走。`
                : "当前暂无额外活动档期。"}
            </p>
          </div>

          <section className="grid gap-4 lg:grid-cols-3" data-testid="purchase-bundle-templates">
            {bundleTemplates.map((template) => (
              <BundleTemplateCard
                key={template.template_id}
                template={template}
                dealer={currentDealer}
                busyKey={busyKey}
                onAdd={() =>
                  void handleQuickOrder({
                    key: `bundle:add:${template.template_id}`,
                    items: template.items,
                    successLabel: template.template_name,
                    navigate: false,
                  })
                }
                onQuickOrder={() =>
                  void handleQuickOrder({
                    key: `bundle:quick:${template.template_id}`,
                    items: template.items,
                    successLabel: `${template.template_name}（快速下单）`,
                    navigate: true,
                  })
                }
                onViewReason={() => setReasonDrawer({ type: "bundle", template })}
              />
            ))}
          </section>

          <section data-testid="purchase-activity-zone">
            <Card className="border-slate-200 bg-white/92">
              <CardHeader>
                <CardTitle className="text-xl text-slate-900">活动专区</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {activityHighlights.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    当前经销商暂无可用活动，仍可使用上方三组进货建议与商品选购继续下单。
                  </div>
                ) : (
                  activityHighlights.map((activity) => (
                    <ActivityCard
                      key={activity.activity_id}
                      activity={activity}
                      busy={busyKey === `activity:quick:${activity.activity_id}`}
                      onQuickOrder={() =>
                        void handleQuickOrder({
                          key: `activity:quick:${activity.activity_id}`,
                          items: activity.items,
                          successLabel: `${activity.activity_name}（活动快速下单）`,
                          navigate: true,
                        })
                      }
                      onViewReason={() => setReasonDrawer({ type: "activity", activity })}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          <section data-testid="purchase-catalog-zone">
            <Card className="border-slate-200 bg-white/92">
              <CardHeader className="space-y-3">
                <CardTitle className="text-xl text-slate-900">商品选购区</CardTitle>
                <div className="grid gap-2 md:grid-cols-3">
                  <Input
                    placeholder="搜索商品名称 / 规格 / 标签"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                      <SelectValue placeholder="分类筛选" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部分类</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={viewFilter}
                    onValueChange={(next) => setViewFilter(next as ProcurementView)}
                  >
                    <SelectTrigger className="h-9 w-full rounded-xl bg-white">
                      <SelectValue placeholder="选购视图" />
                    </SelectTrigger>
                    <SelectContent>
                      {VIEW_OPTIONS.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingPage ? (
                  <div className="py-10 text-center text-sm text-slate-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    商品加载中...
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    当前筛选条件下暂无商品。
                  </div>
                ) : (
                  filteredProducts.slice(0, 20).map((product) => (
                    <div
                      key={product.sku_id}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-900">{product.sku_name}</p>
                          <p className="text-xs text-slate-500">
                            {product.brand} · {product.spec}
                          </p>
                        </div>
                        <Badge variant="outline">{formatMoney(product.price_per_case)}/箱</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="secondary">{product.category}</Badge>
                        <Badge variant="outline">箱规 {product.box_multiple}</Badge>
                        {recommendedSkuSet.has(product.sku_id) ? (
                          <Badge variant="outline">本页建议</Badge>
                        ) : null}
                        {product.is_weekly_focus ? <Badge variant="outline">活动</Badge> : null}
                        {product.is_new_product ? <Badge variant="outline">新品</Badge> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          className="h-9 w-20 rounded-xl"
                          value={
                            qtyDraftBySku[product.sku_id] ??
                            String(Math.max(1, product.box_multiple))
                          }
                          onChange={(event) =>
                            setQtyDraftBySku((prev) => ({
                              ...prev,
                              [product.sku_id]: event.target.value,
                            }))
                          }
                          aria-label={`${product.sku_name} 采购数量`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full px-4"
                          onClick={() =>
                            void handleAddProduct(
                              product,
                              Number.parseInt(
                                qtyDraftBySku[product.sku_id] ??
                                  String(Math.max(1, product.box_multiple)),
                                10,
                              ) || Math.max(1, product.box_multiple),
                            )
                          }
                          disabled={busyKey === `sku:${product.sku_id}`}
                        >
                          {busyKey === `sku:${product.sku_id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShoppingCart className="h-4 w-4" />
                          )}
                          加入采购清单
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        <aside data-testid="purchase-procurement-summary">
          <Card className="h-fit max-w-[300px] border-slate-200 bg-gradient-to-b from-slate-50 to-white xl:sticky xl:top-24 xl:ml-auto">
            <CardHeader className="space-y-1 pb-2">
              <CardTitle className="text-lg text-slate-900">采购摘要</CardTitle>
              <p className="text-xs text-slate-500">随时看本单金额和起订差额。</p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-slate-500">商品款数 / 总箱数</p>
                  <p className="kpi-value text-base text-slate-900">
                    {displaySummary.sku_count} / {displaySummary.item_count}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-slate-500">本单金额 / 起订额</p>
                    <p className="kpi-value mt-1 text-base text-slate-900">
                      {formatMoney(displaySummary.total_amount)} /{" "}
                      {formatMoney(displaySummary.threshold_amount)}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {displaySummary.threshold_reached
                    ? "已满足起订额，可以去确认下单。"
                    : `还差 ${formatMoney(displaySummary.gap_to_threshold)} 就到起订额`}
                </p>
              </div>
              <div className="grid gap-2">
                <Button className="w-full" onClick={() => router.push("/order-submit")}>
                  去结算
                </Button>
                <p className="text-xs text-slate-500">
                  不会直接提交订单，仍会在结算页再次确认商品和金额。
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </section>

      <ReasonDrawer
        open={Boolean(reasonDrawer)}
        onClose={() => setReasonDrawer(null)}
        title={
          reasonDrawer?.type === "bundle"
            ? `${reasonDrawer.template.template_name} · 进货依据`
            : reasonDrawer?.type === "activity"
              ? `${reasonDrawer.activity.activity_name} · 进货依据`
              : "进货依据"
        }
      >
        {reasonDrawer?.type === "bundle" ? (
          <div className="space-y-4" data-testid="purchase-reason-drawer">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">{activeBundleSummary}</p>
              <p className="mt-1 text-xs text-slate-600">
                预计金额 {formatMoney(activeBundleAmount || reasonDrawer.template.estimated_amount)} · 共{" "}
                {activeBundleItems.length} 款商品
              </p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">建议商品</p>
              <div className="space-y-2">
                {activeBundleItems.map((item) => (
                  <div
                    key={item.sku_id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <Badge variant="secondary">{item.suggested_qty} 箱</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">
                这组为什么值得先带
              </p>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {activeBundleRationale}
              </p>
              <div className="mt-3 space-y-2">
                {activeBundleEvidence.map((line) => (
                  <div
                    key={`${line.label}:${line.value}`}
                    className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2"
                  >
                    <p className="text-xs text-indigo-500">{line.label}</p>
                    <p className="mt-1 text-sm text-indigo-950">{line.value}</p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                补一句这次需求
              </p>
              <p className="mt-2 text-sm text-slate-600">
                点一下就能快速填入，也可以自己改一句，再让 AI 帮你快速组货。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {BUNDLE_NEED_SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant={bundleNeed.trim() === suggestion ? "default" : "outline"}
                    onClick={() => setBundleNeed(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
              <Textarea
                className="mt-3"
                rows={3}
                value={bundleNeed}
                onChange={(event) => setBundleNeed(event.target.value)}
                placeholder="比如：这次优先小包装，给烧烤档口补货"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleBundleNeedRefresh()}
                  disabled={refiningBundle}
                >
                  {refiningBundle ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  AI 快速组货
                </Button>
                {bundleDraft ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBundleNeed("");
                      setBundleDraft(null);
                    }}
                    disabled={refiningBundle}
                  >
                    恢复系统原建议
                  </Button>
                ) : null}
              </div>
            </section>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                disabled={activeBundleItems.length === 0}
                onClick={() =>
                  void handleQuickOrder({
                    key: `bundle:drawer:add:${reasonDrawer.template.template_id}`,
                    items: activeBundleItems,
                    successLabel: bundleDraft?.userNeed
                      ? `${reasonDrawer.template.template_name}（按需求重排）`
                      : `${reasonDrawer.template.template_name}（详情加入）`,
                    navigate: false,
                  })
                }
              >
                <ShoppingCart className="h-4 w-4" />
                加入采购清单
              </Button>
              <Button
                disabled={activeBundleItems.length === 0}
                onClick={() =>
                  void handleQuickOrder({
                    key: `bundle:drawer:quick:${reasonDrawer.template.template_id}`,
                    items: activeBundleItems,
                    successLabel: bundleDraft?.userNeed
                      ? `${reasonDrawer.template.template_name}（按需求快速下单）`
                      : `${reasonDrawer.template.template_name}（详情快速下单）`,
                    navigate: true,
                  })
                }
              >
                <ShoppingCart className="h-4 w-4" />
                快速下单
              </Button>
            </div>
          </div>
        ) : null}

        {reasonDrawer?.type === "activity" ? (
          <div className="space-y-4" data-testid="purchase-reason-drawer">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">
                {toActivityValueSummary(reasonDrawer.activity)}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                活动预计金额 {formatMoney(reasonDrawer.activity.estimated_amount)}
              </p>
            </div>
            <section className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">建议商品</p>
              <div className="space-y-2">
                {reasonDrawer.activity.items.map((item) => (
                  <div
                    key={item.sku_id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.sku_name}</p>
                      <Badge variant="secondary">{item.suggested_qty} 箱</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-600">
                这次活动备货主要依据
              </p>
              <p className="mt-2 text-sm leading-6 text-indigo-900">
                {toActivityPromoExplanation(reasonDrawer.activity)}
              </p>
              <div className="mt-3 space-y-2">
                {buildActivityEvidence(reasonDrawer.activity, currentDealer).map((line) => (
                  <div
                    key={`${line.label}:${line.value}`}
                    className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2"
                  >
                    <p className="text-xs text-indigo-500">{line.label}</p>
                    <p className="mt-1 text-sm text-indigo-950">{line.value}</p>
                  </div>
                ))}
              </div>
            </section>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                disabled={reasonDrawer.activity.items.length === 0}
                onClick={() =>
                  void handleQuickOrder({
                    key: `activity:drawer:add:${reasonDrawer.activity.activity_id}`,
                    items: reasonDrawer.activity.items,
                    successLabel: `${reasonDrawer.activity.activity_name}（详情加入）`,
                    navigate: false,
                  })
                }
              >
                <ShoppingCart className="h-4 w-4" />
                加入采购清单
              </Button>
              <Button
                disabled={reasonDrawer.activity.items.length === 0}
                onClick={() =>
                  void handleQuickOrder({
                    key: `activity:drawer:quick:${reasonDrawer.activity.activity_id}`,
                    items: reasonDrawer.activity.items,
                    successLabel: `${reasonDrawer.activity.activity_name}（详情快速下单）`,
                    navigate: true,
                  })
                }
              >
                <ShoppingCart className="h-4 w-4" />
                快速下单
              </Button>
            </div>
          </div>
        ) : null}
      </ReasonDrawer>
    </div>
  );
}

function BundleTemplateCard(input: {
  template: BundleTemplate;
  dealer: DealerEntity | null;
  busyKey: string;
  onAdd: () => void;
  onQuickOrder: () => void;
  onViewReason: () => void;
}) {
  const addBusy = input.busyKey === `bundle:add:${input.template.template_id}`;
  const quickBusy = input.busyKey === `bundle:quick:${input.template.template_id}`;

  return (
    <Card className="flex h-full flex-col border-slate-200 bg-white/92">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg text-slate-900">{input.template.template_name}</CardTitle>
          <Badge variant="outline">{toBundleSourceLabel(input.template)}</Badge>
        </div>
        <p className="text-sm text-slate-600">{input.template.template_subtitle}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-500">建议金额</p>
          <p className="mt-1 font-semibold text-slate-900">
            {formatMoney(input.template.estimated_amount)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <p className="text-slate-500">先带理由</p>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {toBundleCardSummary(input.template, input.dealer)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-slate-500">本次建议</p>
          <p className="mt-1 font-medium text-slate-900">
            {toBundleItemPreview(input.template)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            共 {input.template.items.length} 款商品，可直接加入采购清单或快速下单。
          </p>
        </div>
        <div className="mt-auto grid gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={addBusy || quickBusy || input.template.items.length === 0}
            onClick={input.onAdd}
          >
            {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            加入采购清单
          </Button>
          <Button
            size="sm"
            disabled={addBusy || quickBusy || input.template.items.length === 0}
            onClick={input.onQuickOrder}
          >
            {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            快速下单
          </Button>
          <Button size="sm" variant="ghost" onClick={input.onViewReason}>
            查看详情
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard(input: {
  activity: ActivityHighlight;
  busy: boolean;
  onQuickOrder: () => void;
  onViewReason: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{input.activity.activity_name}</p>
          <p className="text-xs text-slate-500">
            {input.activity.week_id} · 活动起订额 {formatMoney(input.activity.promo_threshold)}
          </p>
        </div>
        <Badge variant="outline">{toActivityPromoLabel(input.activity.promo_type)}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-700">
        围绕本周活动要求，建议这次一起带上 {input.activity.items.length} 款活动商品。
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {toActivityPromoExplanation(input.activity)}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm text-slate-700">活动预计金额：{formatMoney(input.activity.estimated_amount)}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={input.onViewReason}>
            查看详情
          </Button>
          <Button size="sm" onClick={input.onQuickOrder} disabled={input.busy || input.activity.items.length === 0}>
            {input.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            快速下单
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReasonDrawer(input: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!input.open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [input.open]);

  if (!input.open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="关闭详情抽屉"
        onClick={input.onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{input.title}</h2>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={input.onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto p-5">{input.children}</div>
      </aside>
    </div>,
    document.body,
  );
}
