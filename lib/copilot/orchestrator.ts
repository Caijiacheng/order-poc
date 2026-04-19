import { randomUUID } from "node:crypto";
import { generateText, Output } from "ai";

import { extractCopilotImageLines } from "@/lib/ai/ocr-service";
import { getLlmFactory } from "@/lib/ai/model-factory";
import { addCartItem, getCartBySession, patchCartItem, setCartCustomer } from "@/lib/cart/service";
import {
  buildParseIntentPrompt,
  buildSelectBestComboPrompt,
  buildSummarizeResultPrompt,
} from "@/lib/copilot/prompts";
import { excludeProductsByKeywords, matchProductsByKeywords } from "@/lib/copilot/product-matcher";
import {
  copilotIntentSchema,
  copilotSelectBestComboSchema,
  type CopilotImageExtractOutput,
  type CopilotSummarizeResultOutput,
  copilotSummarizeResultSchema,
} from "@/lib/copilot/schemas";
import { recordCopilotMetricEvent } from "@/lib/copilot/metrics";
import type {
  CopilotCampaignState,
  CopilotDraft,
  CopilotDraftItem,
  CopilotImageExtractLine,
  CopilotImageExtractSummary,
  CopilotImageInput,
  CopilotInputMode,
  CopilotIntent,
  CopilotJob,
  CopilotLegalCombo,
  CopilotRun,
  CopilotStep,
  CopilotStepName,
} from "@/lib/copilot/types";
import { generateCartOptimizationForSession } from "@/lib/domain/business-service";
import { BusinessError } from "@/lib/domain/errors";
import { selectDailyRecommendationCandidates } from "@/lib/domain/recommendation-rules";
import { getMemoryStore, nowIso } from "@/lib/memory/store";
import type { CampaignEntity, DealerEntity, ProductEntity } from "@/lib/memory/types";
import {
  buildTelemetrySettings,
  recordLangfuseGenerationDiagnostic,
  withChildSpan,
  withSpan,
} from "@/lib/tracing/telemetry";

type AutofillInput = {
  session_id: string;
  customer_id: string;
  user_message: string;
  images?: CopilotImageInput[];
  page_name?: "/purchase" | "/order-submit";
};

type ChatInput = AutofillInput;

function usageFromResult(result: { usage?: { inputTokens?: number; outputTokens?: number } }) {
  return {
    input_tokens: result.usage?.inputTokens,
    output_tokens: result.usage?.outputTokens,
  };
}

function ensureCopilotLlmConfigured() {
  const factory = getLlmFactory();
  if (!factory.isConfigured) {
    throw new BusinessError(
      "LLM_UNAVAILABLE",
      "LLM 未配置。请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或启用 LLM_MOCK_MODE=true。",
      503,
    );
  }
  return factory;
}

function buildMockIntentOutput(message: string) {
  return extractHeuristicIntent(message);
}

function buildMockComboSelection(input: { combos: CopilotLegalCombo[] }) {
  return {
    status: "selected" as const,
    combo_id: input.combos[0]?.combo_id ?? "",
    explanation: "Mock 模式下返回确定性评分最高的候选组合作为预览。",
  };
}

function buildMockSummaryOutput(input: {
  blockedReason?: string;
  selectedCombo?: CopilotLegalCombo;
  campaignState: CopilotCampaignState;
}): CopilotSummarizeResultOutput {
  if (input.blockedReason || !input.selectedCombo) {
    return {
      summary: "当前没有可直接应用的安全组合，请调整约束后重试。",
      should_go_checkout: false,
      key_points: ["候选组合不足", "需要人工确认约束"],
    };
  }

  return {
    summary: `已生成预览草案，共 ${input.selectedCombo.items.length} 个 SKU，可先查看后再应用到购物车。`,
    should_go_checkout:
      input.campaignState.gap_amount === 0 || input.selectedCombo.projected_campaign_gap === 0,
    key_points: [
      `预计新增金额 ¥${Math.round(input.selectedCombo.estimated_additional_amount)}`,
      `活动差额预计 ${Math.max(0, Math.round(input.selectedCombo.projected_campaign_gap))}`,
    ],
  };
}

function extractLlmFailureDiagnostic(error: unknown) {
  const record = error as Record<string, unknown>;
  const cause =
    record.cause && typeof record.cause === "object"
      ? (record.cause as Record<string, unknown>)
      : undefined;
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : undefined;
  const responseBody = response?.body;

  return {
    error_name: typeof record.name === "string" ? record.name : "UnknownError",
    error_message:
      typeof record.message === "string" ? record.message : String(error ?? "unknown error"),
    error_code: typeof record.code === "string" ? record.code : undefined,
    finish_reason:
      typeof record.finishReason === "string" ? record.finishReason : undefined,
    cause_name: typeof cause?.name === "string" ? cause.name : undefined,
    cause_message: typeof cause?.message === "string" ? cause.message : undefined,
    raw_text: typeof record.text === "string" ? record.text : undefined,
    parsed_value: cause?.value,
    response_body: responseBody,
  };
}

async function recordCopilotModelFailureDiagnostic(input: {
  traceId?: string;
  functionId: string;
  modelName: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  error: unknown;
}) {
  await recordLangfuseGenerationDiagnostic({
    traceId: input.traceId,
    name: `${input.functionId}.failure-diagnostic`,
    model: input.modelName,
    input: {
      prompt: input.prompt,
    },
    output: extractLlmFailureDiagnostic(input.error),
    metadata: input.metadata,
    statusMessage:
      input.error instanceof Error ? input.error.message : "unknown generation error",
    level: "ERROR",
  });
}

function createRun(input: {
  run_id?: string;
  run_type: CopilotRun["run_type"];
  top_level_trace_name: CopilotRun["top_level_trace_name"];
  trace_id?: string;
  session_id: string;
  customer_id: string;
  page_name: CopilotRun["page_name"];
  user_message: string;
  input_mode: CopilotInputMode;
  image_count: number;
}) {
  const timestamp = nowIso();
  const run: CopilotRun = {
    run_id: input.run_id ?? `copilot_run_${randomUUID().replace(/-/g, "")}`,
    run_type: input.run_type,
    top_level_trace_name: input.top_level_trace_name,
    trace_id: input.trace_id,
    session_id: input.session_id,
    customer_id: input.customer_id,
    page_name: input.page_name,
    user_message: input.user_message,
    input_mode: input.input_mode,
    image_count: input.image_count,
    image_parsed_line_count: 0,
    image_matched_line_count: 0,
    image_pending_confirm_line_count: 0,
    image_unmatched_line_count: 0,
    image_low_confidence_line_count: 0,
    status: "running",
    cart_write_succeeded: false,
    reached_checkout: false,
    order_submitted: false,
    created_at: timestamp,
    updated_at: timestamp,
  };
  getMemoryStore().copilotRuns.unshift(run);
  return run;
}

function createJob(input: { run_id: string; trace_id?: string }) {
  const timestamp = nowIso();
  const job: CopilotJob = {
    job_id: `copilot_job_${randomUUID().replace(/-/g, "")}`,
    run_id: input.run_id,
    trace_id: input.trace_id,
    status: "running",
    started_at: timestamp,
    updated_at: timestamp,
  };
  getMemoryStore().copilotJobs.unshift(job);
  return job;
}

function listStepsForRun(runId: string) {
  return getMemoryStore().copilotSteps
    .filter((step) => step.run_id === runId)
    .sort((left, right) => left.step_order - right.step_order);
}

function updateRun(
  runId: string,
  updater: (run: CopilotRun) => void,
) {
  const run = getMemoryStore().copilotRuns.find((item) => item.run_id === runId);
  if (!run) {
    return null;
  }
  updater(run);
  run.updated_at = nowIso();
  return run;
}

function updateJob(
  jobId: string,
  updater: (job: CopilotJob) => void,
) {
  const job = getMemoryStore().copilotJobs.find((item) => item.job_id === jobId);
  if (!job) {
    return null;
  }
  updater(job);
  job.updated_at = nowIso();
  return job;
}

function createDraft(input: {
  run_id: string;
  job_id: string;
  trace_id?: string;
  session_id: string;
  customer_id: string;
  status: CopilotDraft["status"];
  selected_combo_id?: string;
  selected_explanation?: string;
  blocked_reason?: string;
  items: CopilotDraftItem[];
  campaign_state: CopilotCampaignState;
  cart_amount_before: number;
  cart_amount_after_preview: number;
  should_go_checkout: boolean;
  summary_text: string;
}) {
  const timestamp = nowIso();
  const draft: CopilotDraft = {
    draft_id: `copilot_draft_${randomUUID().replace(/-/g, "")}`,
    run_id: input.run_id,
    job_id: input.job_id,
    trace_id: input.trace_id,
    session_id: input.session_id,
    customer_id: input.customer_id,
    status: input.status,
    selected_combo_id: input.selected_combo_id,
    selected_explanation: input.selected_explanation,
    blocked_reason: input.blocked_reason,
    items: input.items,
    campaign_state: input.campaign_state,
    cart_amount_before: input.cart_amount_before,
    cart_amount_after_preview: input.cart_amount_after_preview,
    should_go_checkout: input.should_go_checkout,
    summary_text: input.summary_text,
    created_at: timestamp,
    updated_at: timestamp,
  };
  getMemoryStore().copilotDrafts.unshift(draft);
  return draft;
}

function appendStep(step: CopilotStep) {
  getMemoryStore().copilotSteps.unshift(step);
}

function getDealerOrThrow(customerId: string) {
  const dealer = getMemoryStore().dealers.find((item) => item.customer_id === customerId);
  if (!dealer) {
    throw new BusinessError("NOT_FOUND", "经销商不存在", 404);
  }
  if (dealer.status !== "active") {
    throw new BusinessError("CONFLICT", "经销商已停用", 409);
  }
  return dealer;
}

function getApplicableCampaigns(dealer: DealerEntity) {
  const store = getMemoryStore();
  return store.campaigns.filter((campaign) => {
    if (campaign.status !== "active") {
      return false;
    }
    const matchDealer = campaign.target_dealer_ids?.includes(dealer.customer_id) ?? false;
    const matchType = campaign.target_customer_types.includes(dealer.customer_type);
    return matchDealer || matchType;
  });
}

function pickPrimaryCampaign(campaigns: CampaignEntity[]) {
  return campaigns.sort((left, right) => right.promo_threshold - left.promo_threshold)[0] ?? null;
}

function buildProductMap(products: ProductEntity[]) {
  return new Map(products.map((item) => [item.sku_id, item]));
}

function resolveInputMode(input: { message: string; images: CopilotImageInput[] }): CopilotInputMode {
  const hasText = input.message.trim().length > 0;
  const hasImages = input.images.length > 0;
  if (hasText && hasImages) {
    return "mixed";
  }
  if (hasImages) {
    return "image";
  }
  return "text";
}

function normalizeSearchToken(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function getProductMatchTokens(product: ProductEntity) {
  const values = [
    product.sku_name,
    product.sku_id,
    ...(product.alias_names ?? []),
    ...(product.search_terms ?? []),
  ];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeSearchToken(value))
        .filter((value) => value.length >= 2),
    ),
  );
}

function matchOcrLineToProduct(lineText: string, products: ProductEntity[]) {
  const normalizedLine = normalizeSearchToken(lineText);
  if (!normalizedLine) {
    return {
      status: "unmatched" as const,
      reason: "line_text_empty",
    };
  }

  let bestScore = 0;
  let bestCandidates: ProductEntity[] = [];

  for (const product of products) {
    const tokens = getProductMatchTokens(product);
    let productScore = 0;
    for (const token of tokens) {
      if (normalizedLine.includes(token) || token.includes(normalizedLine)) {
        productScore = Math.max(productScore, Math.min(token.length, normalizedLine.length));
      }
    }

    if (productScore <= 0) {
      continue;
    }
    if (productScore > bestScore) {
      bestScore = productScore;
      bestCandidates = [product];
      continue;
    }
    if (productScore === bestScore) {
      bestCandidates.push(product);
    }
  }

  if (bestCandidates.length === 0) {
    return {
      status: "unmatched" as const,
      reason: "sku_not_found",
    };
  }

  if (bestCandidates.length > 1) {
    return {
      status: "pending_confirm" as const,
      reason: "sku_ambiguous",
    };
  }

  return {
    status: "matched" as const,
    product: bestCandidates[0],
  };
}

function summarizeImageExtract(input: {
  raw: CopilotImageExtractOutput;
  products: ProductEntity[];
}): { lines: CopilotImageExtractLine[]; summary: CopilotImageExtractSummary } {
  const normalizedLines: CopilotImageExtractLine[] = input.raw.lines.map((line, index) => {
    const confidence = line.confidence;
    const match = matchOcrLineToProduct(line.original_text, input.products);

    if (confidence === "low") {
      return {
        line_id: line.line_id || `line_${index + 1}`,
        original_text: line.original_text,
        qty_hint: line.qty_hint,
        confidence,
        match_status: "pending_confirm",
        pending_reason: "low_confidence",
      };
    }

    if (match.status === "matched") {
      return {
        line_id: line.line_id || `line_${index + 1}`,
        original_text: line.original_text,
        qty_hint: line.qty_hint,
        confidence,
        match_status: "matched",
        matched_sku_id: match.product.sku_id,
        matched_sku_name: match.product.sku_name,
      };
    }

    if (match.status === "pending_confirm") {
      return {
        line_id: line.line_id || `line_${index + 1}`,
        original_text: line.original_text,
        qty_hint: line.qty_hint,
        confidence,
        match_status: "pending_confirm",
        pending_reason: match.reason,
      };
    }

    return {
      line_id: line.line_id || `line_${index + 1}`,
      original_text: line.original_text,
      qty_hint: line.qty_hint,
      confidence,
      match_status: "unmatched",
      pending_reason: match.reason,
    };
  });

  const parsedLineCount = normalizedLines.length;
  const matchedLineCount = normalizedLines.filter((line) => line.match_status === "matched").length;
  const pendingConfirmLineCount = normalizedLines.filter(
    (line) => line.match_status === "pending_confirm",
  ).length;
  const unmatchedLineCount = normalizedLines.filter((line) => line.match_status === "unmatched").length;
  const lowConfidenceLineCount = normalizedLines.filter((line) => line.confidence === "low").length;

  let blockedReason: string | undefined;
  if (parsedLineCount === 0) {
    blockedReason = "image_extract_empty";
  } else if (lowConfidenceLineCount > 0) {
    blockedReason = "image_low_confidence";
  } else if (unmatchedLineCount > 0 || matchedLineCount === 0) {
    blockedReason = "image_unmatched_items";
  } else if (pendingConfirmLineCount > 0) {
    blockedReason = "image_pending_confirmation";
  }

  const summaryText =
    parsedLineCount === 0
      ? "未从图片识别到可用采购条目，请补充更清晰图片或改用文字输入。"
      : [
          `已识别 ${parsedLineCount} 行条目`,
          `匹配 ${matchedLineCount} 行`,
          `待确认 ${pendingConfirmLineCount} 行`,
          `未匹配 ${unmatchedLineCount} 行`,
        ].join("，");

  return {
    lines: normalizedLines,
    summary: {
      parsed_line_count: parsedLineCount,
      matched_line_count: matchedLineCount,
      pending_confirm_line_count: pendingConfirmLineCount,
      unmatched_line_count: unmatchedLineCount,
      low_confidence_line_count: lowConfidenceLineCount,
      summary_text: summaryText,
      blocked_reason: blockedReason,
    },
  };
}

async function extractImageWithFallback(input: {
  images: CopilotImageInput[];
  customerId: string;
  traceId?: string;
}) {
  try {
    const result = await extractCopilotImageLines(input);
    return {
      ...result,
      blocked_reason: undefined as string | undefined,
      blocked_summary: undefined as string | undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "图片识别失败，请稍后重试或改用文字输入。";
    return {
      output: { lines: [] },
      meta: {
        model_name: "ocr-unavailable",
        model_latency_ms: 0,
      },
      blocked_reason: "image_extract_failed",
      blocked_summary: `图片识别失败：${message}`,
    };
  }
}

function buildIntentMessage(input: {
  userMessage: string;
  imageSummary?: CopilotImageExtractSummary;
  imageLines?: CopilotImageExtractLine[];
}) {
  const text = input.userMessage.trim();
  const summary = input.imageSummary?.summary_text;
  const matchedLines = (input.imageLines ?? [])
    .filter((line) => line.match_status === "matched")
    .slice(0, 8)
    .map((line) =>
      `${line.matched_sku_name ?? line.original_text}${line.qty_hint ? ` x${line.qty_hint}` : ""}`,
    );

  const sections = [text];
  if (summary) {
    sections.push(`图片识别摘要：${summary}`);
  }
  if (matchedLines.length > 0) {
    sections.push(`图片匹配条目：${matchedLines.join("；")}`);
  }

  return sections.filter((value) => value.trim().length > 0).join("\n");
}

function detectCampaignState(input: {
  campaign: CampaignEntity | null;
  cartItems: Array<{ sku_id: string; qty: number }>;
  productMap: Map<string, ProductEntity>;
}): CopilotCampaignState {
  if (!input.campaign) {
    return {
      campaign_id: null,
      campaign_name: null,
      promo_threshold: 0,
      current_amount: 0,
      gap_amount: 0,
      is_hit: false,
    };
  }

  const focusSet = new Set(input.campaign.weekly_focus_items);
  const currentAmount = input.cartItems.reduce((sum, item) => {
    if (!focusSet.has(item.sku_id)) {
      return sum;
    }
    const product = input.productMap.get(item.sku_id);
    if (!product) {
      return sum;
    }
    return sum + product.price_per_case * item.qty;
  }, 0);

  const gap = Math.max(0, input.campaign.promo_threshold - currentAmount);
  return {
    campaign_id: input.campaign.campaign_id,
    campaign_name: input.campaign.campaign_name,
    promo_threshold: input.campaign.promo_threshold,
    current_amount: currentAmount,
    gap_amount: gap,
    is_hit: gap === 0 && input.campaign.promo_threshold > 0,
  };
}

function projectCampaignStateForPreview(input: {
  base: CopilotCampaignState;
  campaign: CampaignEntity | null;
  selectedCombo?: CopilotLegalCombo;
}) {
  if (!input.selectedCombo) {
    return input.base;
  }

  if (!input.campaign || !input.base.campaign_id) {
    return {
      ...input.base,
      is_hit: false,
    };
  }

  const campaignSkuSet = new Set(input.campaign.weekly_focus_items);
  const campaignAddedAmount = input.selectedCombo.items.reduce((sum, item) => {
    if (!campaignSkuSet.has(item.sku_id)) {
      return sum;
    }
    return sum + item.line_amount;
  }, 0);

  const projectedCurrentAmount = input.base.current_amount + campaignAddedAmount;
  const projectedGap = Math.max(0, input.base.promo_threshold - projectedCurrentAmount);
  return {
    ...input.base,
    current_amount: projectedCurrentAmount,
    gap_amount: projectedGap,
    is_hit: input.base.promo_threshold > 0 ? projectedGap === 0 : false,
  };
}

function extractHeuristicIntent(message: string): CopilotIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const explainSignal = /解释|为什么|说明|原因|依据/.test(text);
  const campaignSignal = /活动|门槛|补齐|凑满/.test(text);
  const adjustSignal = /调整|改一下|优化/.test(text);
  const orderSignal = /做单|下单|补货|进货|来一单|配一单/.test(text);

  let intentType: CopilotIntent["intent_type"] = "start_order";
  if (
    (orderSignal && (campaignSignal || adjustSignal)) ||
    (campaignSignal && adjustSignal)
  ) {
    intentType = "mixed";
  } else if (explainSignal) {
    intentType = "explain_order";
  } else if (campaignSignal) {
    intentType = "topup_campaign";
  } else if (adjustSignal) {
    intentType = "adjust_order";
  }

  const budgetMatch = text.match(/(\d{3,6})(?:\s*(元|块|¥))?/);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;

  const preferCampaign =
    /活动|门槛|冲活动|补齐/.test(text) ? true : /不走活动|不参加活动/.test(text) ? false : null;
  const preferFrequent =
    /常购|高频|常卖/.test(text) ? true : /不要常购/.test(text) ? false : null;
  const avoidNew = /不要新品|不带新品|别上新品/.test(text) ? true : null;

  const riskMode: CopilotIntent["risk_mode"] = /保守|稳妥|稳健/.test(text)
    ? "conservative"
    : /激进|冲量|多上/.test(text)
      ? "aggressive"
      : lower.length > 0
        ? "balanced"
        : null;

  const mustHaveKeywords = text
    .split(/[\s，。！？、,.;；]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 10)
    .slice(0, 5);

  const excludeKeywords: string[] = [];
  for (const match of text.matchAll(/(?:不要|排除|不含|别加)([\u4e00-\u9fa5a-zA-Z0-9]{2,10})/g)) {
    const value = match[1]?.trim();
    if (value) {
      excludeKeywords.push(value);
    }
  }

  return {
    intent_type: intentType,
    budget_target: budget,
    prefer_campaign: preferCampaign,
    prefer_frequent_items: preferFrequent,
    avoid_new_products: avoidNew,
    risk_mode: riskMode,
    must_have_keywords: Array.from(new Set(mustHaveKeywords)),
    exclude_keywords: Array.from(new Set(excludeKeywords)),
  };
}

async function parseIntentWithModel(input: {
  message: string;
  dealer: DealerEntity;
  traceId?: string;
}) {
  const factory = ensureCopilotLlmConfigured();
  const mockOutput = buildMockIntentOutput(input.message);

  const prompt = buildParseIntentPrompt({
    userMessage: input.message,
    dealer: input.dealer,
  });
  const startedAt = Date.now();
  let result;
  try {
    result = await generateText({
      model: factory.getModel(),
      prompt,
      output: Output.object({
        schema: copilotIntentSchema,
        name: "copilot_intent",
        description: "Structured copilot intent.",
      }),
      experimental_telemetry: buildTelemetrySettings("copilot.parse-intent", {
        trace_id: input.traceId,
        customer_id: input.dealer.customer_id,
      }),
      providerOptions: factory.isMockMode
        ? {
            orderPocMock: {
              response_json: JSON.stringify(mockOutput),
            },
          }
        : undefined,
      temperature: 0.1,
      maxOutputTokens: 500,
    });
  } catch (error) {
    await recordCopilotModelFailureDiagnostic({
      traceId: input.traceId,
      functionId: "copilot.parse-intent",
      modelName: factory.modelName,
      prompt,
      metadata: {
        customer_id: input.dealer.customer_id,
      },
      error,
    });
    throw error;
  }

  const parsedIntent = copilotIntentSchema.safeParse(result.output);
  if (!parsedIntent.success) {
    throw new BusinessError("LLM_INVALID_OUTPUT", "Copilot 意图解析输出不合法。", 502, {
      payload: parsedIntent.error.issues[0]?.message ?? "模型输出缺少有效意图结构",
    });
  }

  return {
    intent: parsedIntent.data,
    meta: {
      model_name: factory.modelName,
      model_latency_ms: Date.now() - startedAt,
      ...usageFromResult(result),
    },
  };
}

function buildDraftItem(input: {
  product: ProductEntity;
  currentQty: number;
  targetQty: number;
  reason: string;
}) {
  const additionalQty = Math.max(0, input.targetQty - input.currentQty);
  return {
    sku_id: input.product.sku_id,
    sku_name: input.product.sku_name,
    action_type: input.currentQty > 0 ? ("adjust_qty" as const) : ("add_to_cart" as const),
    suggested_qty: input.targetQty,
    from_qty: input.currentQty > 0 ? input.currentQty : undefined,
    reason: input.reason,
    line_amount: additionalQty * input.product.price_per_case,
  };
}

function buildLegalCombos(input: {
  dealer: DealerEntity;
  cartItems: Array<{ sku_id: string; qty: number }>;
  cartAmount: number;
  campaign: CampaignEntity | null;
  campaignState: CopilotCampaignState;
  intent: CopilotIntent;
  products: ProductEntity[];
}): CopilotLegalCombo[] {
  const store = getMemoryStore();
  const productMap = buildProductMap(input.products);
  const currentQtyMap = new Map(input.cartItems.map((item) => [item.sku_id, item.qty]));

  let candidates = selectDailyRecommendationCandidates({
    products: input.products,
    dealer: input.dealer,
    rules: store.rules,
  });

  if (input.intent.avoid_new_products) {
    candidates = candidates.filter((item) => !item.is_new_product);
  }

  if (input.intent.must_have_keywords.length > 0) {
    const matched = matchProductsByKeywords({
      products: candidates,
      keywords: input.intent.must_have_keywords,
      mode: "all",
      onlyActive: true,
      limit: 12,
    });
    if (matched.length > 0) {
      candidates = matched;
    }
  }

  candidates = excludeProductsByKeywords({
    products: candidates,
    excludeKeywords: input.intent.exclude_keywords,
  });

  if (input.intent.prefer_frequent_items === true) {
    candidates = [...candidates].sort((left, right) => {
      const leftFrequent = input.dealer.frequent_items.includes(left.sku_id) ? 1 : 0;
      const rightFrequent = input.dealer.frequent_items.includes(right.sku_id) ? 1 : 0;
      if (leftFrequent !== rightFrequent) {
        return rightFrequent - leftFrequent;
      }
      return left.display_order - right.display_order;
    });
  }

  const combos: CopilotLegalCombo[] = [];
  const riskScale =
    input.intent.risk_mode === "conservative"
      ? 0.6
      : input.intent.risk_mode === "aggressive"
        ? 1.25
        : 1;

  const topReplenishment = candidates.slice(0, 3);
  if (topReplenishment.length > 0) {
    const items = topReplenishment.map((product) => {
      const currentQty = currentQtyMap.get(product.sku_id) ?? 0;
      const suggestedAddQty = Math.max(1, Math.round(product.box_multiple * 0.4 * riskScale));
      const targetQty = currentQty + suggestedAddQty;
      return buildDraftItem({
        product,
        currentQty,
        targetQty,
        reason: "基于常购与动销节奏，建议优先补货。",
      });
    });
    const addedAmount = items.reduce((sum, item) => sum + item.line_amount, 0);
    combos.push({
      combo_id: "combo_replenishment_core",
      combo_type: "replenishment",
      deterministic_score: 650 + (input.intent.prefer_frequent_items ? 80 : 0),
      estimated_additional_amount: addedAmount,
      projected_cart_total: input.cartAmount + addedAmount,
      projected_campaign_gap: input.campaignState.gap_amount,
      items,
      rationale: ["常购优先", "控制扩单风险"],
    });
  }

  if (input.campaign && input.campaignState.gap_amount > 0) {
    const focusProducts = input.campaign.weekly_focus_items
      .map((skuId) => productMap.get(skuId))
      .filter((item): item is ProductEntity => Boolean(item))
      .filter((item) => item.status === "active")
      .filter((item) => !input.dealer.forbidden_items.includes(item.sku_id))
      .filter((item) => !(input.intent.avoid_new_products && item.is_new_product));
    const filteredFocusProducts = excludeProductsByKeywords({
      products: focusProducts,
      excludeKeywords: input.intent.exclude_keywords,
    });
    const focusProductsForCombos =
      input.intent.must_have_keywords.length > 0
        ? matchProductsByKeywords({
            products: filteredFocusProducts,
            keywords: input.intent.must_have_keywords,
            mode: "all",
            onlyActive: true,
          })
        : filteredFocusProducts;

    for (const [index, product] of focusProductsForCombos.slice(0, 2).entries()) {
      const currentQty = currentQtyMap.get(product.sku_id) ?? 0;
      const minQty = Math.max(1, Math.ceil(input.campaignState.gap_amount / product.price_per_case));
      const adjustedQty = Math.max(1, Math.round(minQty * riskScale));
      const targetQty = currentQty + adjustedQty;
      const item = buildDraftItem({
        product,
        currentQty,
        targetQty,
        reason: "优先补活动核心品，贴近活动门槛。",
      });
      const projectedGap = Math.max(0, input.campaignState.gap_amount - item.line_amount);
      combos.push({
        combo_id: `combo_campaign_topup_${index + 1}`,
        combo_type: "campaign_topup",
        deterministic_score: 720 - projectedGap * 0.05,
        estimated_additional_amount: item.line_amount,
        projected_cart_total: input.cartAmount + item.line_amount,
        projected_campaign_gap: projectedGap,
        items: [item],
        rationale: ["活动补齐优先", "尽量缩小活动差额"],
      });
    }

    if (focusProductsForCombos.length > 0 && topReplenishment.length > 0) {
      const campaignProduct = focusProductsForCombos[0];
      const replenishmentProduct =
        topReplenishment.find((product) => product.sku_id !== campaignProduct.sku_id) ?? null;
      if (replenishmentProduct) {
        const campaignCurrentQty = currentQtyMap.get(campaignProduct.sku_id) ?? 0;
        const replenishmentCurrentQty = currentQtyMap.get(replenishmentProduct.sku_id) ?? 0;
        const campaignTargetQty =
          campaignCurrentQty +
          Math.max(1, Math.ceil((input.campaignState.gap_amount * 0.65) / campaignProduct.price_per_case));
        const replenishmentTargetQty =
          replenishmentCurrentQty + Math.max(1, Math.round(replenishmentProduct.box_multiple * 0.3));
        const items = [
          buildDraftItem({
            product: campaignProduct,
            currentQty: campaignCurrentQty,
            targetQty: campaignTargetQty,
            reason: "先补活动核心品，优先缩小门槛差额。",
          }),
          buildDraftItem({
            product: replenishmentProduct,
            currentQty: replenishmentCurrentQty,
            targetQty: replenishmentTargetQty,
            reason: "同时补充常购高频品，兼顾稳健补货。",
          }),
        ];
        const addedAmount = items.reduce((sum, item) => sum + item.line_amount, 0);
        const campaignAdded = items
          .filter((item) => input.campaign?.weekly_focus_items.includes(item.sku_id))
          .reduce((sum, item) => sum + item.line_amount, 0);
        combos.push({
          combo_id: "combo_mixed_campaign_replenish",
          combo_type: "mixed",
          deterministic_score: 740 - Math.max(0, input.campaignState.gap_amount - campaignAdded) * 0.08,
          estimated_additional_amount: addedAmount,
          projected_cart_total: input.cartAmount + addedAmount,
          projected_campaign_gap: Math.max(0, input.campaignState.gap_amount - campaignAdded),
          items,
          rationale: ["活动补齐 + 常购稳健组合"],
        });
      }
    }
  }

  const byComboId = new Map<string, CopilotLegalCombo>();
  for (const combo of combos) {
    if (combo.items.length === 0) {
      continue;
    }
    if (combo.items.some((item) => item.suggested_qty <= 0)) {
      continue;
    }
    byComboId.set(combo.combo_id, combo);
  }

  return Array.from(byComboId.values())
    .sort((left, right) => right.deterministic_score - left.deterministic_score)
    .slice(0, 6);
}

async function selectBestComboWithModel(input: {
  dealer: DealerEntity;
  intent: CopilotIntent;
  campaignState: CopilotCampaignState;
  combos: CopilotLegalCombo[];
  traceId?: string;
}) {
  if (input.combos.length === 0) {
    return {
      output: {
        status: "blocked" as const,
        explanation: "当前没有满足约束的安全候选组合。",
        blocked_reason: "no_legal_combo",
      },
      meta: {
        model_name: "deterministic-rule",
        model_latency_ms: 0,
      },
    };
  }

  const factory = ensureCopilotLlmConfigured();
  const mockOutput = buildMockComboSelection({ combos: input.combos });

  const prompt = buildSelectBestComboPrompt({
    dealer: input.dealer,
    intent: input.intent,
    campaignState: input.campaignState,
    combos: input.combos,
  });
  const startedAt = Date.now();
  let result;
  try {
    result = await generateText({
      model: factory.getModel(),
      prompt,
      output: Output.object({
        schema: copilotSelectBestComboSchema,
        name: "copilot_select_best_combo",
        description: "Pick one combo from legal candidates or block.",
      }),
      experimental_telemetry: buildTelemetrySettings("copilot.select-best-combo", {
        trace_id: input.traceId,
        combo_count: input.combos.length,
      }),
      providerOptions: factory.isMockMode
        ? {
            orderPocMock: {
              response_json: JSON.stringify(mockOutput),
            },
          }
        : undefined,
      temperature: 0.2,
      maxOutputTokens: 500,
    });
  } catch (error) {
    await recordCopilotModelFailureDiagnostic({
      traceId: input.traceId,
      functionId: "copilot.select-best-combo",
      modelName: factory.modelName,
      prompt,
      metadata: {
        combo_count: input.combos.length,
      },
      error,
    });
    throw error;
  }

  const parsed = copilotSelectBestComboSchema.safeParse(result.output);
  if (!parsed.success) {
    throw new BusinessError("LLM_INVALID_OUTPUT", "Copilot 组合选择输出不合法。", 502, {
      payload: parsed.error.issues[0]?.message ?? "模型未返回有效的组合选择结构",
    });
  }

  if (
    parsed.data.status === "selected" &&
    !input.combos.some((combo) => combo.combo_id === parsed.data.combo_id)
  ) {
    throw new BusinessError("LLM_INVALID_OUTPUT", "Copilot 选择了不存在的候选组合。", 502, {
      combo_id: parsed.data.combo_id ?? "missing",
    });
  }

  const normalizedOutput =
    parsed.data.status === "blocked"
      ? {
          status: "blocked" as const,
          explanation: parsed.data.explanation,
          blocked_reason: parsed.data.blocked_reason ?? "model_blocked",
        }
      : parsed.data;

  return {
    output: normalizedOutput,
    meta: {
      model_name: factory.modelName,
      model_latency_ms: Date.now() - startedAt,
      ...usageFromResult(result),
    },
  };
}

async function summarizeResultWithModel(input: {
  userMessage: string;
  intent: CopilotIntent;
  campaignState: CopilotCampaignState;
  selectedCombo?: CopilotLegalCombo;
  blockedReason?: string;
  traceId?: string;
}) {
  const mockOutput = buildMockSummaryOutput(input);
  const factory = ensureCopilotLlmConfigured();

  const prompt = buildSummarizeResultPrompt({
    userMessage: input.userMessage,
    intent: input.intent,
    campaignState: input.campaignState,
    selectedCombo: input.selectedCombo,
    blockedReason: input.blockedReason,
  });
  const startedAt = Date.now();
  let result;
  try {
    result = await generateText({
      model: factory.getModel(),
      prompt,
      output: Output.object({
        schema: copilotSummarizeResultSchema,
        name: "copilot_summarize_result",
        description: "Summarize copilot execution result in business language.",
      }),
      experimental_telemetry: buildTelemetrySettings("copilot.summarize-result", {
        trace_id: input.traceId,
      }),
      providerOptions: factory.isMockMode
        ? {
            orderPocMock: {
              response_json: JSON.stringify(mockOutput),
            },
          }
        : undefined,
      temperature: 0.2,
      maxOutputTokens: 400,
    });
  } catch (error) {
    await recordCopilotModelFailureDiagnostic({
      traceId: input.traceId,
      functionId: "copilot.summarize-result",
      modelName: factory.modelName,
      prompt,
      error,
    });
    throw error;
  }

  const output = copilotSummarizeResultSchema.safeParse(result.output);
  if (!output.success) {
    throw new BusinessError("LLM_INVALID_OUTPUT", "Copilot 结果摘要输出不合法。", 502, {
      payload: output.error.issues[0]?.message ?? "模型未返回有效的摘要结构",
    });
  }

  return {
    output: output.data,
    meta: {
      model_name: factory.modelName,
      model_latency_ms: Date.now() - startedAt,
      ...usageFromResult(result),
    },
  };
}

async function runCopilotStep<T>(input: {
  run_id: string;
  job_id?: string;
  trace_id?: string;
  step_name: CopilotStepName;
  step_order: number;
  action: () => Promise<T>;
  onSuccessPayload?: (result: T) => Record<string, unknown> | undefined;
  resolveStatus?: (result: T) => CopilotStep["status"];
}) {
  const timestamp = nowIso();
  const step: CopilotStep = {
    step_id: `copilot_step_${randomUUID().replace(/-/g, "")}`,
    run_id: input.run_id,
    job_id: input.job_id,
    trace_id: input.trace_id,
    step_name: input.step_name,
    step_order: input.step_order,
    status: "running",
    started_at: timestamp,
  };
  appendStep(step);
  const started = Date.now();

  try {
    const result = await withChildSpan(
      input.step_name,
      {
        "copilot.run_id": input.run_id,
        "copilot.job_id": input.job_id ?? "",
      },
      input.action,
    );
    step.status = input.resolveStatus?.(result) ?? "completed";
    step.finished_at = nowIso();
    step.latency_ms = Date.now() - started;
    step.payload = input.onSuccessPayload?.(result);
    return result;
  } catch (error) {
    step.status = "failed";
    step.finished_at = nowIso();
    step.latency_ms = Date.now() - started;
    step.error_message = error instanceof Error ? error.message : "unknown error";
    throw error;
  }
}

export async function runCopilotAutofill(input: AutofillInput) {
  const startedAt = Date.now();
  const images = input.images ?? [];
  const inputMode = resolveInputMode({
    message: input.user_message,
    images,
  });
  const run = createRun({
    run_type: "autofill_order",
    top_level_trace_name: "copilot.autofill-order",
    session_id: input.session_id,
    customer_id: input.customer_id,
    page_name: input.page_name ?? "/purchase",
    user_message: input.user_message,
    input_mode: inputMode,
    image_count: images.length,
  });
  const job = createJob({ run_id: run.run_id });
  updateRun(run.run_id, (item) => {
    item.job_id = job.job_id;
  });
  recordCopilotMetricEvent({
    run_id: run.run_id,
    job_id: job.job_id,
    customer_id: input.customer_id,
    event_type: "copilot_usage",
  });
  recordCopilotMetricEvent({
    run_id: run.run_id,
    job_id: job.job_id,
    customer_id: input.customer_id,
    event_type: "copilot_autofill_started",
  });

  return withSpan(
    "copilot.autofill-order",
    {
      "customer.id": input.customer_id,
      "session.id": input.session_id,
      "copilot.run_id": run.run_id,
      "copilot.job_id": job.job_id,
      "copilot.input_mode": inputMode,
      "copilot.image_count": images.length,
    },
    async (traceId) => {
      updateRun(run.run_id, (item) => {
        item.trace_id = traceId;
      });
      updateJob(job.job_id, (item) => {
        item.trace_id = traceId;
      });

      let stepOrder = 0;
      let totalModelLatency = 0;
      let currentIntent: CopilotIntent = extractHeuristicIntent(input.user_message);
      let intentMessage = input.user_message;
      let campaignState: CopilotCampaignState = {
        campaign_id: null,
        campaign_name: null,
        promo_threshold: 0,
        current_amount: 0,
        gap_amount: 0,
        is_hit: false,
      };
      let imageExtractSummary: CopilotImageExtractSummary | undefined;
      let imageExtractLines: CopilotImageExtractLine[] = [];
      let selectedCombo: CopilotLegalCombo | undefined;
      let draft: CopilotDraft | undefined;

      try {
        const context = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "load_context",
          step_order: ++stepOrder,
          action: async () => {
            const store = getMemoryStore();
            const dealer = getDealerOrThrow(input.customer_id);
            setCartCustomer(input.session_id, dealer.customer_id);
            const cart = getCartBySession(input.session_id);
            const campaigns = getApplicableCampaigns(dealer);
            const campaign = pickPrimaryCampaign(campaigns);
            return {
              dealer,
              cart,
              campaign,
              products: store.products.filter((item) => item.status === "active"),
            };
          },
          onSuccessPayload: (result) => ({
            customer_id: result.dealer.customer_id,
            cart_amount: result.cart.summary.total_amount,
            campaign_id: result.campaign?.campaign_id ?? null,
          }),
        });

        if (images.length > 0) {
          const imageExtract = await runCopilotStep({
            run_id: run.run_id,
            job_id: job.job_id,
            trace_id: traceId,
            step_name: "image_extract",
            step_order: ++stepOrder,
            action: async () =>
              extractImageWithFallback({
                images,
                customerId: input.customer_id,
                traceId,
              }),
            onSuccessPayload: (result) => ({
              model_name: result.meta.model_name,
              line_count: result.output.lines.length,
              blocked_reason: result.blocked_reason ?? null,
            }),
            resolveStatus: (result) => (result.blocked_reason ? "blocked" : "completed"),
          });
          totalModelLatency += imageExtract.meta.model_latency_ms;
          const imageExtractResult = summarizeImageExtract({
            raw: imageExtract.output,
            products: context.products,
          });
          if (imageExtract.blocked_reason) {
            imageExtractResult.summary.blocked_reason = imageExtract.blocked_reason;
            imageExtractResult.summary.summary_text =
              imageExtract.blocked_summary ?? imageExtractResult.summary.summary_text;
          }
          imageExtractLines = imageExtractResult.lines;
          imageExtractSummary = imageExtractResult.summary;

          run.image_parsed_line_count = imageExtractSummary.parsed_line_count;
          run.image_matched_line_count = imageExtractSummary.matched_line_count;
          run.image_pending_confirm_line_count = imageExtractSummary.pending_confirm_line_count;
          run.image_unmatched_line_count = imageExtractSummary.unmatched_line_count;
          run.image_low_confidence_line_count = imageExtractSummary.low_confidence_line_count;
          run.image_extract_summary_text = imageExtractSummary.summary_text;
          run.image_extract_blocked_reason = imageExtractSummary.blocked_reason;
          run.image_extract_lines = imageExtractLines;
        }

        campaignState = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "detect_campaign_state",
          step_order: ++stepOrder,
          action: async () =>
            detectCampaignState({
              campaign: context.campaign,
              cartItems: context.cart.items.map((item) => ({
                sku_id: item.sku_id,
                qty: item.qty,
              })),
              productMap: buildProductMap(context.products),
            }),
          onSuccessPayload: (result) => ({
            campaign_id: result.campaign_id,
            gap_amount: result.gap_amount,
            is_hit: result.is_hit,
          }),
        });

        if (imageExtractSummary?.blocked_reason) {
          const blockedImageSummary = imageExtractSummary;
          draft = await runCopilotStep({
            run_id: run.run_id,
            job_id: job.job_id,
            trace_id: traceId,
            step_name: "apply_draft",
            step_order: ++stepOrder,
            action: async () =>
              createDraft({
                run_id: run.run_id,
                job_id: job.job_id,
                trace_id: traceId,
                session_id: input.session_id,
                customer_id: input.customer_id,
                status: "blocked",
                blocked_reason: blockedImageSummary.blocked_reason ?? "image_extract_blocked",
                items: [],
                campaign_state: campaignState,
                cart_amount_before: context.cart.summary.total_amount,
                cart_amount_after_preview: context.cart.summary.total_amount,
                should_go_checkout: false,
                summary_text: blockedImageSummary.summary_text,
              }),
            onSuccessPayload: (result) => ({
              draft_id: result.draft_id,
              status: result.status,
            }),
            resolveStatus: () => "blocked",
          });

          if (!draft) {
            throw new BusinessError("INTERNAL_ERROR", "Copilot 草案创建失败", 500);
          }

          job.draft_id = draft.draft_id;
          job.status = "blocked";
          job.blocked_reason = draft.blocked_reason;
          job.finished_at = nowIso();
          job.updated_at = nowIso();

          run.status = "blocked";
          run.intent = currentIntent;
          run.campaign_hit = campaignState.is_hit;
          run.campaign_gap_amount = campaignState.gap_amount;
          run.model_name = getLlmFactory().modelName;
          run.model_latency_ms = totalModelLatency;
          run.total_latency_ms = Date.now() - startedAt;
          run.blocked_reason = draft.blocked_reason;
          run.finished_at = nowIso();
          run.updated_at = nowIso();

          recordCopilotMetricEvent({
            run_id: run.run_id,
            job_id: job.job_id,
            customer_id: input.customer_id,
            event_type: "copilot_run_completed",
            latency_ms: run.total_latency_ms,
            payload: { status: run.status },
          });

          return {
            run,
            job,
            draft,
            steps: listStepsForRun(run.run_id),
            summary: {
              summary: blockedImageSummary.summary_text,
              should_go_checkout: false,
              key_points: [
                "图片识别存在阻塞项，需人工确认后再做单。",
                `阻塞原因：${blockedImageSummary.blocked_reason}`,
              ],
            },
          };
        }

        intentMessage = buildIntentMessage({
          userMessage: input.user_message,
          imageSummary: imageExtractSummary,
          imageLines: imageExtractLines,
        });

        const parsedIntent = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "parse_intent",
          step_order: ++stepOrder,
          action: async () =>
            parseIntentWithModel({
              message: intentMessage,
              dealer: context.dealer,
              traceId,
            }),
          onSuccessPayload: (result) => ({
            intent_type: result.intent.intent_type,
            risk_mode: result.intent.risk_mode,
          }),
        });
        currentIntent = parsedIntent.intent;
        totalModelLatency += parsedIntent.meta.model_latency_ms;

        if (campaignState.gap_amount > 0) {
          recordCopilotMetricEvent({
            run_id: run.run_id,
            job_id: job.job_id,
            customer_id: input.customer_id,
            event_type: "copilot_campaign_topup_attempted",
            payload: {
              campaign_id: campaignState.campaign_id,
              gap_amount: campaignState.gap_amount,
            },
          });
        }

        const combos = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "build_legal_candidates",
          step_order: ++stepOrder,
          action: async () =>
            buildLegalCombos({
              dealer: context.dealer,
              cartItems: context.cart.items.map((item) => ({
                sku_id: item.sku_id,
                qty: item.qty,
              })),
              cartAmount: context.cart.summary.total_amount,
              campaign: context.campaign,
              campaignState,
              intent: currentIntent,
              products: context.products,
            }),
          onSuccessPayload: (result) => ({
            combo_count: result.length,
          }),
        });

        const selected = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "select_best_combo",
          step_order: ++stepOrder,
          action: async () =>
            selectBestComboWithModel({
              dealer: context.dealer,
              intent: currentIntent,
              campaignState,
              combos,
              traceId,
            }),
          onSuccessPayload: (result) => ({
            status: result.output.status,
            combo_id: result.output.status === "selected" ? result.output.combo_id : null,
          }),
          resolveStatus: (result) =>
            result.output.status === "blocked" ? "blocked" : "completed",
        });
        totalModelLatency += selected.meta.model_latency_ms;
        const selectedComboId =
          selected.output.status === "selected" ? selected.output.combo_id : undefined;
        selectedCombo = selectedComboId
          ? combos.find((combo) => combo.combo_id === selectedComboId)
          : undefined;

        draft = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "apply_draft",
          step_order: ++stepOrder,
          action: async () =>
            createDraft({
              run_id: run.run_id,
              job_id: job.job_id,
              trace_id: traceId,
              session_id: input.session_id,
              customer_id: input.customer_id,
              status:
                selected.output.status === "selected" && selectedCombo
                  ? "preview"
                  : "blocked",
              selected_combo_id: selectedCombo?.combo_id,
              selected_explanation: selected.output.explanation,
              blocked_reason:
                selected.output.status === "blocked"
                  ? selected.output.blocked_reason ?? "no_legal_combo"
                  : undefined,
              items: selectedCombo?.items ?? [],
              campaign_state: projectCampaignStateForPreview({
                base: campaignState,
                campaign: context.campaign,
                selectedCombo,
              }),
              cart_amount_before: context.cart.summary.total_amount,
              cart_amount_after_preview:
                context.cart.summary.total_amount +
                (selectedCombo?.estimated_additional_amount ?? 0),
              should_go_checkout: false,
              summary_text: "预览已生成",
            }),
          onSuccessPayload: (result) => ({
            draft_id: result.draft_id,
            status: result.status,
            item_count: result.items.length,
          }),
          resolveStatus: (result) => (result.status === "blocked" ? "blocked" : "completed"),
        });
        if (!draft) {
          throw new BusinessError("INTERNAL_ERROR", "Copilot 草案创建失败", 500);
        }
        const activeDraft = draft;

        await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "run_cart_optimization",
          step_order: ++stepOrder,
          action: async () => ({
            mode: "preview_skip",
            reason: "preview-first flow does not write cart during autofill",
          }),
          onSuccessPayload: (result) => result,
          resolveStatus: () => "skipped",
        });

        const summarized = await runCopilotStep({
          run_id: run.run_id,
          job_id: job.job_id,
          trace_id: traceId,
          step_name: "summarize_result",
          step_order: ++stepOrder,
          action: async () =>
            summarizeResultWithModel({
              userMessage: intentMessage,
              intent: currentIntent,
              campaignState: activeDraft.campaign_state,
              selectedCombo,
              blockedReason: activeDraft.blocked_reason,
              traceId,
            }),
          onSuccessPayload: (result) => ({
            should_go_checkout: result.output.should_go_checkout,
          }),
        });
        totalModelLatency += summarized.meta.model_latency_ms;

        activeDraft.summary_text = summarized.output.summary;
        activeDraft.should_go_checkout = summarized.output.should_go_checkout;
        activeDraft.updated_at = nowIso();
        job.draft_id = activeDraft.draft_id;
        job.status = activeDraft.status === "blocked" ? "blocked" : "preview_ready";
        job.blocked_reason = activeDraft.blocked_reason;
        job.finished_at = nowIso();
        job.updated_at = nowIso();

        run.status = activeDraft.status === "blocked" ? "blocked" : "succeeded";
        run.intent = currentIntent;
        run.selected_combo_id = activeDraft.selected_combo_id;
        run.campaign_hit = activeDraft.campaign_state.is_hit;
        run.campaign_gap_amount = activeDraft.campaign_state.gap_amount;
        run.model_name = getLlmFactory().modelName;
        run.model_latency_ms = totalModelLatency;
        run.total_latency_ms = Date.now() - startedAt;
        run.blocked_reason = activeDraft.blocked_reason;
        run.finished_at = nowIso();
        run.updated_at = nowIso();

        recordCopilotMetricEvent({
          run_id: run.run_id,
          job_id: job.job_id,
          customer_id: input.customer_id,
          event_type: "copilot_run_completed",
          latency_ms: run.total_latency_ms,
          payload: { status: run.status },
        });
        if (activeDraft.status !== "blocked") {
          recordCopilotMetricEvent({
            run_id: run.run_id,
            job_id: job.job_id,
            customer_id: input.customer_id,
            event_type: "copilot_preview_succeeded",
          });
          if (campaignState.gap_amount > 0 && activeDraft.campaign_state.gap_amount === 0) {
            recordCopilotMetricEvent({
              run_id: run.run_id,
              job_id: job.job_id,
              customer_id: input.customer_id,
              event_type: "copilot_campaign_topup_succeeded",
              payload: {
                campaign_id: campaignState.campaign_id,
              },
            });
          }
        }

        return {
          run,
          job,
          draft: activeDraft,
          steps: listStepsForRun(run.run_id),
          summary: summarized.output,
        };
      } catch (error) {
        const failedAt = nowIso();
        run.status = "failed";
        run.total_latency_ms = Date.now() - startedAt;
        run.finished_at = failedAt;
        run.updated_at = failedAt;
        run.model_name = getLlmFactory().modelName;
        run.model_latency_ms = totalModelLatency;

        job.status = "failed";
        job.finished_at = failedAt;
        job.updated_at = failedAt;

        recordCopilotMetricEvent({
          run_id: run.run_id,
          job_id: job.job_id,
          customer_id: input.customer_id,
          event_type: "copilot_run_completed",
          latency_ms: run.total_latency_ms,
          payload: { status: "failed" },
        });
        throw error;
      }
    },
  );
}

export async function runCopilotChat(input: ChatInput) {
  const startedAt = Date.now();
  const images = input.images ?? [];
  const inputMode = resolveInputMode({
    message: input.user_message,
    images,
  });
  const run = createRun({
    run_type: "explain_order",
    top_level_trace_name: "copilot.explain-order",
    session_id: input.session_id,
    customer_id: input.customer_id,
    page_name: input.page_name ?? "/purchase",
    user_message: input.user_message,
    input_mode: inputMode,
    image_count: images.length,
  });

  recordCopilotMetricEvent({
    run_id: run.run_id,
    customer_id: input.customer_id,
    event_type: "copilot_usage",
  });

  return withSpan(
    "copilot.explain-order",
    {
      "customer.id": input.customer_id,
      "session.id": input.session_id,
      "copilot.run_id": run.run_id,
      "copilot.input_mode": inputMode,
      "copilot.image_count": images.length,
    },
    async (traceId) => {
      run.trace_id = traceId;
      let stepOrder = 0;
      let totalModelLatency = 0;
      let intentMessage = input.user_message;
      let imageExtractSummary: CopilotImageExtractSummary | undefined;
      let imageExtractLines: CopilotImageExtractLine[] = [];

      try {
        const context = await runCopilotStep({
          run_id: run.run_id,
          trace_id: traceId,
          step_name: "load_context",
          step_order: ++stepOrder,
          action: async () => {
            const dealer = getDealerOrThrow(input.customer_id);
            setCartCustomer(input.session_id, dealer.customer_id);
            const cart = getCartBySession(input.session_id);
            const campaigns = getApplicableCampaigns(dealer);
            const campaign = pickPrimaryCampaign(campaigns);
            return {
              dealer,
              cart,
              campaign,
              products: getMemoryStore().products.filter((item) => item.status === "active"),
            };
          },
        });

        if (images.length > 0) {
          const imageExtract = await runCopilotStep({
            run_id: run.run_id,
            trace_id: traceId,
            step_name: "image_extract",
            step_order: ++stepOrder,
            action: async () =>
              extractImageWithFallback({
                images,
                customerId: input.customer_id,
                traceId,
              }),
            onSuccessPayload: (result) => ({
              model_name: result.meta.model_name,
              line_count: result.output.lines.length,
              blocked_reason: result.blocked_reason ?? null,
            }),
            resolveStatus: (result) => (result.blocked_reason ? "blocked" : "completed"),
          });
          totalModelLatency += imageExtract.meta.model_latency_ms;
          const imageExtractResult = summarizeImageExtract({
            raw: imageExtract.output,
            products: context.products,
          });
          if (imageExtract.blocked_reason) {
            imageExtractResult.summary.blocked_reason = imageExtract.blocked_reason;
            imageExtractResult.summary.summary_text =
              imageExtract.blocked_summary ?? imageExtractResult.summary.summary_text;
          }
          imageExtractLines = imageExtractResult.lines;
          imageExtractSummary = imageExtractResult.summary;

          run.image_parsed_line_count = imageExtractSummary.parsed_line_count;
          run.image_matched_line_count = imageExtractSummary.matched_line_count;
          run.image_pending_confirm_line_count = imageExtractSummary.pending_confirm_line_count;
          run.image_unmatched_line_count = imageExtractSummary.unmatched_line_count;
          run.image_low_confidence_line_count = imageExtractSummary.low_confidence_line_count;
          run.image_extract_summary_text = imageExtractSummary.summary_text;
          run.image_extract_blocked_reason = imageExtractSummary.blocked_reason;
          run.image_extract_lines = imageExtractLines;
        }

        const campaignState = await runCopilotStep({
          run_id: run.run_id,
          trace_id: traceId,
          step_name: "detect_campaign_state",
          step_order: ++stepOrder,
          action: async () =>
            detectCampaignState({
              campaign: context.campaign,
              cartItems: context.cart.items.map((item) => ({
                sku_id: item.sku_id,
                qty: item.qty,
              })),
              productMap: buildProductMap(context.products),
            }),
        });

        if (imageExtractSummary?.blocked_reason) {
          const blockedIntent = extractHeuristicIntent(input.user_message);
          run.status = "blocked";
          run.intent = blockedIntent;
          run.campaign_hit = campaignState.is_hit;
          run.campaign_gap_amount = campaignState.gap_amount;
          run.model_name = getLlmFactory().modelName;
          run.model_latency_ms = totalModelLatency;
          run.total_latency_ms = Date.now() - startedAt;
          run.blocked_reason = imageExtractSummary.blocked_reason;
          run.finished_at = nowIso();
          run.updated_at = nowIso();

          recordCopilotMetricEvent({
            run_id: run.run_id,
            customer_id: input.customer_id,
            event_type: "copilot_run_completed",
            latency_ms: run.total_latency_ms,
            payload: { status: "blocked" },
          });

          const blockedSummary = {
            summary: imageExtractSummary.summary_text,
            should_go_checkout: false,
            key_points: [
              "图片识别存在阻塞项，需人工确认后再继续。",
              `阻塞原因：${imageExtractSummary.blocked_reason}`,
            ],
          };

          return {
            run,
            reply: blockedSummary.summary,
            summary: blockedSummary,
            steps: listStepsForRun(run.run_id),
          };
        }

        intentMessage = buildIntentMessage({
          userMessage: input.user_message,
          imageSummary: imageExtractSummary,
          imageLines: imageExtractLines,
        });

        const parsedIntent = await runCopilotStep({
          run_id: run.run_id,
          trace_id: traceId,
          step_name: "parse_intent",
          step_order: ++stepOrder,
          action: async () =>
            parseIntentWithModel({
              message: intentMessage,
              dealer: context.dealer,
              traceId,
            }),
        });
        totalModelLatency += parsedIntent.meta.model_latency_ms;

        const summary = await runCopilotStep({
          run_id: run.run_id,
          trace_id: traceId,
          step_name: "summarize_result",
          step_order: ++stepOrder,
          action: async () =>
            summarizeResultWithModel({
              userMessage: intentMessage,
              intent: parsedIntent.intent,
              campaignState,
              traceId,
            }),
        });
        totalModelLatency += summary.meta.model_latency_ms;

        run.status = "succeeded";
        run.intent = parsedIntent.intent;
        run.campaign_hit = campaignState.is_hit;
        run.campaign_gap_amount = campaignState.gap_amount;
        run.model_name = getLlmFactory().modelName;
        run.model_latency_ms = totalModelLatency;
        run.total_latency_ms = Date.now() - startedAt;
        run.finished_at = nowIso();
        run.updated_at = nowIso();

        recordCopilotMetricEvent({
          run_id: run.run_id,
          customer_id: input.customer_id,
          event_type: "copilot_run_completed",
          latency_ms: run.total_latency_ms,
          payload: { status: "succeeded" },
        });

        return {
          run,
          reply: summary.output.summary,
          summary: summary.output,
          steps: listStepsForRun(run.run_id),
        };
      } catch (error) {
        run.status = "failed";
        run.total_latency_ms = Date.now() - startedAt;
        run.finished_at = nowIso();
        run.updated_at = nowIso();
        run.model_name = getLlmFactory().modelName;
        run.model_latency_ms = totalModelLatency;

        recordCopilotMetricEvent({
          run_id: run.run_id,
          customer_id: input.customer_id,
          event_type: "copilot_run_completed",
          latency_ms: run.total_latency_ms,
          payload: { status: "failed" },
        });
        throw error;
      }
    },
  );
}

export function getCopilotJobDetail(jobId: string) {
  const store = getMemoryStore();
  const job = store.copilotJobs.find((item) => item.job_id === jobId);
  if (!job) {
    return null;
  }
  const run = store.copilotRuns.find((item) => item.run_id === job.run_id);
  const draft = job.draft_id
    ? store.copilotDrafts.find((item) => item.draft_id === job.draft_id) ?? null
    : null;

  return {
    job,
    run: run ?? null,
    draft,
    steps: listStepsForRun(job.run_id),
  };
}

export async function applyCopilotDraft(input: {
  draft_id: string;
  session_id: string;
  customer_id?: string;
}) {
  const store = getMemoryStore();
  const draft = store.copilotDrafts.find((item) => item.draft_id === input.draft_id);
  if (!draft) {
    throw new BusinessError("NOT_FOUND", "Copilot 草案不存在", 404);
  }
  if (draft.status !== "preview") {
    throw new BusinessError("CONFLICT", "该草案不可应用", 409);
  }
  if (input.customer_id && input.customer_id !== draft.customer_id) {
    throw new BusinessError("CONFLICT", "customerId 与草案不一致", 409);
  }
  if (input.session_id !== draft.session_id) {
    throw new BusinessError("CONFLICT", "sessionId 与草案不一致", 409);
  }

  const run = store.copilotRuns.find((item) => item.run_id === draft.run_id);
  const job = store.copilotJobs.find((item) => item.job_id === draft.job_id);
  if (!run || !job) {
    throw new BusinessError("NOT_FOUND", "Copilot 运行记录缺失", 404);
  }

  const baseOrder = listStepsForRun(run.run_id).at(-1)?.step_order ?? 0;
  let stepOrder = baseOrder;

  recordCopilotMetricEvent({
    run_id: run.run_id,
    job_id: job.job_id,
    customer_id: draft.customer_id,
    event_type: "copilot_apply_attempted",
    payload: { draft_id: draft.draft_id },
  });

  await runCopilotStep({
    run_id: run.run_id,
    job_id: job.job_id,
    trace_id: run.trace_id,
    step_name: "apply_draft",
    step_order: ++stepOrder,
    action: async () => {
      setCartCustomer(input.session_id, draft.customer_id);
      const cart = getCartBySession(input.session_id);
      const store = getMemoryStore();
      const operations = draft.items.map((item) => {
        const current = cart.items.find((cartItem) => cartItem.sku_id === item.sku_id);
        if (item.action_type === "adjust_qty") {
          if ((current?.qty ?? undefined) !== item.from_qty) {
            throw new BusinessError(
              "CONFLICT",
              `商品 ${item.sku_name} 的数量已变化，请重新生成 Copilot 预览后再应用。`,
              409,
            );
          }
          return {
            kind: "patch" as const,
            sku_id: item.sku_id,
            qty: item.suggested_qty,
          };
        }

        const product = store.products.find((productItem) => productItem.sku_id === item.sku_id);
        if (!product || product.status !== "active") {
          throw new BusinessError(
            "CONFLICT",
            `商品 ${item.sku_name} 当前已不可用，请重新生成 Copilot 预览后再应用。`,
            409,
          );
        }

        return {
          kind: "add" as const,
          sku_id: item.sku_id,
          qty: Math.max(current?.qty ?? 0, item.suggested_qty),
        };
      });

      for (const operation of operations) {
        if (operation.kind === "patch") {
          patchCartItem({
            session_id: input.session_id,
            sku_id: operation.sku_id,
            qty: operation.qty,
          });
          continue;
        }
        addCartItem({
          session_id: input.session_id,
          sku_id: operation.sku_id,
          qty: operation.qty,
          source: "recommendation",
        });
      }
      return { applied_item_count: draft.items.length };
    },
    onSuccessPayload: (result) => result,
  });

  const optimization = await runCopilotStep({
    run_id: run.run_id,
    job_id: job.job_id,
    trace_id: run.trace_id,
    step_name: "run_cart_optimization",
    step_order: ++stepOrder,
    action: async () =>
      generateCartOptimizationForSession({
        session_id: input.session_id,
        customer_id: draft.customer_id,
      }),
    onSuccessPayload: (result) => ({
      recommendation_bar_count: result.recommendationBars.length,
      recommendation_run_id: result.summary.recommendation_run_id,
    }),
  });

  draft.status = "applied";
  draft.updated_at = nowIso();

  job.status = "applied";
  job.updated_at = nowIso();
  job.finished_at = nowIso();

  run.status = "succeeded";
  run.cart_write_succeeded = true;
  run.updated_at = nowIso();
  run.finished_at = nowIso();

  recordCopilotMetricEvent({
    run_id: run.run_id,
    job_id: job.job_id,
    customer_id: draft.customer_id,
    event_type: "copilot_apply_succeeded",
    payload: {
      draft_id: draft.draft_id,
      recommendation_run_id: optimization.summary.recommendation_run_id,
    },
  });

  return {
    run,
    job,
    draft,
    cart: getCartBySession(input.session_id),
    optimization,
    steps: listStepsForRun(run.run_id),
  };
}
