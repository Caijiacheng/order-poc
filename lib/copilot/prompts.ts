import type {
  CopilotCampaignState,
  CopilotIntent,
  CopilotLegalCombo,
} from "@/lib/copilot/types";
import type { DealerEntity } from "@/lib/memory/types";

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const SYSTEM_CONSTRAINTS = [
  "你是采购页内嵌式 AI 下单助手，不是通用聊天机器人。",
  "订单真值以系统提供的当前 cart 为准，不能以聊天历史替代。",
  "不能自行计算门槛、箱规、活动差额、价格。",
  "只能在系统提供的候选组合中选择，不得新增 SKU 和组合。",
  "输出必须严格遵循结构化 JSON，不要输出额外文本。",
].join("\n");

export function buildParseIntentPrompt(input: {
  userMessage: string;
  dealer: DealerEntity;
}) {
  return [
    SYSTEM_CONSTRAINTS,
    "任务：提取采购意图，不要生成订单。",
    "经销商信息：",
    stringify({
      customer_id: input.dealer.customer_id,
      customer_name: input.dealer.customer_name,
      customer_type: input.dealer.customer_type,
      price_sensitivity: input.dealer.price_sensitivity,
      new_product_acceptance: input.dealer.new_product_acceptance,
      frequent_items: input.dealer.frequent_items,
      forbidden_items: input.dealer.forbidden_items,
    }),
    `用户输入：${input.userMessage}`,
    "输出字段：intent_type, budget_target, prefer_campaign, prefer_frequent_items, avoid_new_products, risk_mode, must_have_keywords, exclude_keywords。",
  ].join("\n\n");
}

export function buildSelectBestComboPrompt(input: {
  dealer: DealerEntity;
  intent: CopilotIntent;
  campaignState: CopilotCampaignState;
  combos: CopilotLegalCombo[];
}) {
  return [
    SYSTEM_CONSTRAINTS,
    "任务：只能从候选组合中选择最合适的一个。",
    "如果没有安全组合，请返回 blocked 并填写 blocked_reason。",
    "选择优先级：偏好匹配 > 活动补齐 > 常购稳健 > 控制风险。",
    "经销商信息：",
    stringify({
      customer_id: input.dealer.customer_id,
      frequent_items: input.dealer.frequent_items,
      forbidden_items: input.dealer.forbidden_items,
      new_product_acceptance: input.dealer.new_product_acceptance,
    }),
    "结构化意图：",
    stringify(input.intent),
    "活动状态：",
    stringify(input.campaignState),
    "合法候选组合：",
    stringify(
      input.combos.map((combo) => ({
        combo_id: combo.combo_id,
        combo_type: combo.combo_type,
        deterministic_score: combo.deterministic_score,
        estimated_additional_amount: combo.estimated_additional_amount,
        projected_cart_total: combo.projected_cart_total,
        projected_campaign_gap: combo.projected_campaign_gap,
        items: combo.items.map((item) => ({
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          suggested_qty: item.suggested_qty,
          action_type: item.action_type,
        })),
        rationale: combo.rationale,
      })),
    ),
    "输出字段：status, combo_id, explanation, blocked_reason。",
  ].join("\n\n");
}

export function buildSummarizeResultPrompt(input: {
  userMessage: string;
  intent: CopilotIntent;
  campaignState: CopilotCampaignState;
  selectedCombo?: CopilotLegalCombo;
  blockedReason?: string;
}) {
  return [
    SYSTEM_CONSTRAINTS,
    "任务：输出采购员可读的结果摘要，不要暴露技术字段。",
    `原始用户输入：${input.userMessage}`,
    "结构化意图：",
    stringify(input.intent),
    "活动状态：",
    stringify(input.campaignState),
    "已选组合：",
    stringify(
      input.selectedCombo
        ? {
            combo_id: input.selectedCombo.combo_id,
            combo_type: input.selectedCombo.combo_type,
            projected_cart_total: input.selectedCombo.projected_cart_total,
            projected_campaign_gap: input.selectedCombo.projected_campaign_gap,
            items: input.selectedCombo.items.map((item) => ({
              sku_name: item.sku_name,
              suggested_qty: item.suggested_qty,
            })),
          }
        : null,
    ),
    `阻塞原因：${input.blockedReason ?? ""}`,
    "输出字段：summary, should_go_checkout, key_points。",
  ].join("\n\n");
}
