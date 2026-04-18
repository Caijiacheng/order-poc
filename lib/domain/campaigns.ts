import type { CampaignPromoType } from "@/lib/memory/types";

export const CAMPAIGN_PROMO_OPTIONS: Array<{
  value: CampaignPromoType;
  label: string;
  description: string;
}> = [
  {
    value: "threshold_rebate",
    label: "满额返利",
    description: "达到活动门槛后享受返利或返券。",
  },
  {
    value: "combo_discount",
    label: "组合搭售",
    description: "活动商品需要搭配带货，更适合整组推进。",
  },
  {
    value: "small_pack_push",
    label: "小规格加推",
    description: "主推小规格和高频补货商品。",
  },
];

export const CAMPAIGN_PROMO_LABELS: Record<CampaignPromoType, string> =
  CAMPAIGN_PROMO_OPTIONS.reduce(
    (map, option) => ({
      ...map,
      [option.value]: option.label,
    }),
    {} as Record<CampaignPromoType, string>,
  );

export function getCampaignPromoLabel(promoType: string) {
  return CAMPAIGN_PROMO_LABELS[promoType as CampaignPromoType] ?? "活动加推";
}
