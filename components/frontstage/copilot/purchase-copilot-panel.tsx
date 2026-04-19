"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MessageCircle,
  ShoppingCart,
  Sparkles,
  X,
} from "lucide-react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyCopilotDraftToCart,
  fetchCopilotJobDetail,
  formatMoney,
  requestCopilotAutofill,
  type CopilotAutofillResponse,
  type CopilotJobDetailResponse,
} from "@/lib/frontstage/api";
import type {
  ActivityHighlight,
  CartSession,
  PublishedSuggestionsCartSummary,
} from "@/lib/memory/types";

type PurchaseCopilotPanelProps = {
  customerId: string;
  customerName?: string;
  cartSummary: CartSession["summary"] | PublishedSuggestionsCartSummary;
  activityHighlights: ActivityHighlight[];
  onCartReload: () => Promise<void>;
  onApplySuccess?: () => void;
};

const STEP_LABEL_MAP: Record<string, string> = {
  load_context: "读取订单上下文",
  parse_intent: "解析用户意图",
  detect_campaign_state: "识别活动状态",
  build_legal_candidates: "生成合法候选",
  select_best_combo: "选择最佳组合",
  apply_draft: "生成预览草稿",
  run_cart_optimization: "凑单优化",
  summarize_result: "生成结果摘要",
};

function resolveDraft(
  autofill: CopilotAutofillResponse | null,
  jobDetail: CopilotJobDetailResponse | null,
) {
  return jobDetail?.draft ?? autofill?.draft ?? null;
}

function resolveJob(
  autofill: CopilotAutofillResponse | null,
  jobDetail: CopilotJobDetailResponse | null,
) {
  return jobDetail?.job ?? autofill?.job ?? null;
}

function resolveSteps(
  autofill: CopilotAutofillResponse | null,
  jobDetail: CopilotJobDetailResponse | null,
) {
  return (jobDetail?.steps ?? autofill?.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order);
}

function toBlockedReasonText(reason?: string) {
  if (!reason) {
    return "当前约束下未找到可执行的安全补货组合。";
  }
  if (reason === "no_legal_combo") {
    return "未找到符合规则的候选组合，请放宽约束后重试。";
  }
  return `当前流程被阻塞：${reason}`;
}

function sendComposerText(
  runtime: ReturnType<typeof useChatRuntime>,
  message: string,
) {
  runtime.thread.composer.setText(message);
  window.requestAnimationFrame(() => {
    runtime.thread.composer.send();
  });
}

function StepStatusPill(input: { status: string }) {
  if (input.status === "completed") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">已完成</Badge>;
  }
  if (input.status === "blocked") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">需确认</Badge>;
  }
  if (input.status === "failed") {
    return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">失败</Badge>;
  }
  if (input.status === "running") {
    return (
      <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        进行中
      </Badge>
    );
  }
  if (input.status === "skipped") {
    return <Badge variant="outline">跳过</Badge>;
  }
  return <Badge variant="outline">等待中</Badge>;
}

export function PurchaseCopilotPanel(props: PurchaseCopilotPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [runningAction, setRunningAction] = useState<"autofill" | "topup" | null>(null);
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [autofillResult, setAutofillResult] = useState<CopilotAutofillResponse | null>(null);
  const [jobDetail, setJobDetail] = useState<CopilotJobDetailResponse | null>(null);
  const [panelError, setPanelError] = useState("");
  const [panelSuccess, setPanelSuccess] = useState("");
  const [appliedOrderCta, setAppliedOrderCta] = useState(false);

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/copilot/chat",
        prepareSendMessagesRequest: ({
          body,
          id,
          messages,
          messageId,
          requestMetadata,
          trigger,
          ...request
        }) => {
          return {
            ...request,
            body: {
              ...body,
              id,
              messages,
              trigger,
              messageId,
              metadata: requestMetadata,
              customerId: props.customerId,
              pageName: "/purchase",
            },
          };
        },
      }),
    [props.customerId],
  );

  const runtime = useChatRuntime({ transport });
  const hasCustomerContext = Boolean(props.customerId);

  const currentDraft = resolveDraft(autofillResult, jobDetail);
  const currentJob = resolveJob(autofillResult, jobDetail);
  const currentSteps = resolveSteps(autofillResult, jobDetail);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!currentJob || currentJob.status !== "running") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const detail = await fetchCopilotJobDetail(currentJob.job_id);
        setJobDetail(detail);
      } catch {
        // Keep current screen state when polling fails transiently.
      }
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentJob]);

  const runAutofill = async (mode: "autofill" | "topup") => {
    if (!hasCustomerContext) {
      setPanelError("请先选择经销商后再使用 Copilot。");
      return;
    }

    const composerText = runtime.thread.composer.getState().text.trim();
    if (!composerText) {
      setPanelError(
        mode === "topup"
          ? "请先输入补齐要求，再发起活动补齐。"
          : "请先输入这次做单要求，再发起一键做单。",
      );
      return;
    }

    setRunningAction(mode);
    setPanelError("");
    setPanelSuccess("");
    setAppliedOrderCta(false);
    try {
      const result = await requestCopilotAutofill({
        customerId: props.customerId,
        message: composerText,
        pageName: "/purchase",
      });
      setAutofillResult(result);
      setJobDetail(null);
      setPanelSuccess("已生成预览草稿，请确认后再写入采购清单。");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Copilot 预览生成失败");
    } finally {
      setRunningAction(null);
    }
  };

  const runExplain = () => {
    if (!hasCustomerContext) {
      setPanelError("请先选择经销商后再使用 Copilot。");
      return;
    }
    const composerText = runtime.thread.composer.getState().text.trim();
    if (!composerText) {
      setPanelError("请先输入要解释的具体问题。");
      return;
    }
    sendComposerText(runtime, composerText);
  };

  const applyDraft = async () => {
    if (!currentDraft || currentDraft.status !== "preview") {
      return;
    }
    setApplyingDraft(true);
    setPanelError("");
    setPanelSuccess("");
    try {
      const applied = await applyCopilotDraftToCart({
        draftId: currentDraft.draft_id,
        customerId: props.customerId || undefined,
      });
      setJobDetail({
        job: applied.job,
        run: applied.run,
        draft: applied.draft,
        steps: applied.steps,
      });
      await props.onCartReload();
      props.onApplySuccess?.();
      setAppliedOrderCta(true);
      setPanelSuccess("已写入采购清单并执行凑单优化，可继续前往结算。");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "应用草稿失败");
    } finally {
      setApplyingDraft(false);
    }
  };

  const campaignLine = props.activityHighlights[0]
    ? `活动档期 ${props.activityHighlights[0].week_id}，已识别 ${props.activityHighlights.length} 个活动区块`
    : "当前无活动档期，可先按常购起单";

  if (!mounted) {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        aria-label="打开 Copilot 助手"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-xl transition hover:scale-[1.02] hover:bg-slate-50"
      >
        <Bot className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/35"
            aria-label="关闭 Copilot 面板"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[420px] border-l border-slate-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Copilot 助手</p>
                <h2 className="mt-1 text-base font-semibold text-slate-900">
                  {props.customerName || "当前经销商"} · 采购辅助
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  订单金额 {formatMoney(props.cartSummary.total_amount)} · SKU {props.cartSummary.sku_count}
                </p>
                <p className="mt-1 text-xs text-slate-500">{campaignLine}</p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="关闭 Copilot 面板"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="h-[calc(100%-72px)] overflow-y-auto p-4">
              <div className="space-y-3">
                <Card className="border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm text-slate-900">快捷动作</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <Button
                      size="sm"
                      onClick={() => void runAutofill("autofill")}
                      disabled={!hasCustomerContext || runningAction !== null || applyingDraft}
                    >
                      {runningAction === "autofill" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      一键做单
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runAutofill("topup")}
                      disabled={!hasCustomerContext || runningAction !== null || applyingDraft}
                    >
                      {runningAction === "topup" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CircleDashed className="h-4 w-4" />
                      )}
                      活动补齐
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={runExplain}
                      disabled={!hasCustomerContext || runningAction !== null || applyingDraft}
                    >
                      <MessageCircle className="h-4 w-4" />
                      解释这单
                    </Button>
                  </CardContent>
                </Card>

                {panelError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {panelError}
                  </div>
                ) : null}

                {panelSuccess ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {panelSuccess}
                  </div>
                ) : null}

                {currentSteps.length > 0 ? (
                  <Card className="border-slate-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-slate-900">AutofillProgressCard</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {currentSteps.map((step) => (
                        <div
                          key={step.step_id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"
                        >
                          <p className="text-xs text-slate-700">
                            {STEP_LABEL_MAP[step.step_name] ?? step.step_name}
                          </p>
                          <StepStatusPill status={step.status} />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                {currentJob?.status === "blocked" || currentDraft?.status === "blocked" ? (
                  <Card className="border-amber-200 bg-amber-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
                        <AlertTriangle className="h-4 w-4" />
                        阻塞状态
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-amber-900">
                      <p>{toBlockedReasonText(currentDraft?.blocked_reason ?? currentJob?.blocked_reason)}</p>
                      <p className="text-xs text-amber-800">
                        可通过聊天补充约束（如预算、允许新品、活动优先级）后重试。
                      </p>
                    </CardContent>
                  </Card>
                ) : null}

                {currentDraft && currentDraft.status !== "blocked" ? (
                  <Card className="border-slate-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-slate-900">AutofillResultCard</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-slate-500">草稿状态</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {currentDraft.status === "preview" ? "预览中（未写车）" : "已应用"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-2">
                          <p className="text-slate-500">新增 SKU</p>
                          <p className="mt-1 font-medium text-slate-900">{currentDraft.items.length}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-2">
                          <p className="text-slate-500">预览金额</p>
                          <p className="mt-1 font-medium text-slate-900">
                            {formatMoney(currentDraft.cart_amount_after_preview)}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-slate-500">活动状态</p>
                        <p className="mt-1 text-slate-900">
                          {currentDraft.campaign_state.campaign_name
                            ? `${currentDraft.campaign_state.campaign_name} · ${
                                currentDraft.campaign_state.is_hit ? "已命中" : "未命中"
                              }`
                            : "当前无活动上下文"}
                        </p>
                        {currentDraft.campaign_state.campaign_name ? (
                          <p className="mt-1 text-xs text-slate-600">
                            当前 {formatMoney(currentDraft.campaign_state.current_amount)}，缺口{" "}
                            {formatMoney(currentDraft.campaign_state.gap_amount)}
                          </p>
                        ) : null}
                      </div>
                      {currentDraft.summary_text ? (
                        <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs leading-5 text-indigo-900">
                          {currentDraft.summary_text}
                        </p>
                      ) : null}
                      {currentDraft.status === "preview" ? (
                        <Button
                          className="w-full"
                          onClick={() => void applyDraft()}
                          disabled={applyingDraft || runningAction !== null}
                        >
                          {applyingDraft ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShoppingCart className="h-4 w-4" />
                          )}
                          确认应用到采购清单
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm text-emerald-900">
                          <CheckCircle2 className="h-4 w-4" />
                          草稿已应用到采购清单
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                {appliedOrderCta ? (
                  <Button asChild className="w-full">
                    <Link href="/order-submit">
                      去结算页继续提交
                    </Link>
                  </Button>
                ) : null}

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">解释与补充约束</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <AssistantRuntimeProvider runtime={runtime}>
                      <ThreadPrimitive.Root className="flex h-[280px] flex-col rounded-xl border border-slate-200 bg-slate-50">
                        <ThreadPrimitive.Viewport className="flex-1 space-y-2 overflow-y-auto p-2">
                          <ThreadPrimitive.Empty>
                            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs leading-5 text-slate-500">
                              先输入预算、是否优先活动、是否避免新品，再点击快捷动作或发送解释问题。
                            </div>
                          </ThreadPrimitive.Empty>
                          <ThreadPrimitive.Messages>
                            {({ message }) => (
                              <MessagePrimitive.Root
                                className={`flex ${
                                  message.role === "user" ? "justify-end" : "justify-start"
                                }`}
                              >
                                <div
                                  className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${
                                    message.role === "user"
                                      ? "bg-slate-900 text-white"
                                      : "border border-slate-200 bg-white text-slate-900"
                                  }`}
                                >
                                  <MessagePrimitive.Parts>
                                    {({ part }) => {
                                      if (part.type === "text") {
                                        return (
                                          <p className="whitespace-pre-wrap leading-6">
                                            <MessagePartPrimitive.Text />
                                          </p>
                                        );
                                      }
                                      return null;
                                    }}
                                  </MessagePrimitive.Parts>
                                </div>
                              </MessagePrimitive.Root>
                            )}
                          </ThreadPrimitive.Messages>
                        </ThreadPrimitive.Viewport>
                        <ComposerPrimitive.Root className="border-t border-slate-200 bg-white p-2">
                          <ComposerPrimitive.Input
                            rows={2}
                            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                            placeholder={
                              hasCustomerContext
                                ? "例如：预算 6000，优先活动，不要新品"
                                : "请先选择经销商后再输入约束"
                            }
                            disabled={!hasCustomerContext}
                            readOnly={!hasCustomerContext}
                          />
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <ComposerPrimitive.Cancel className="inline-flex h-8 items-center rounded-md border border-slate-200 px-3 text-xs text-slate-600 disabled:opacity-50">
                              停止
                            </ComposerPrimitive.Cancel>
                            <ComposerPrimitive.Send
                              disabled={!hasCustomerContext}
                              className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs text-white disabled:opacity-60"
                            >
                              发送
                            </ComposerPrimitive.Send>
                          </div>
                          {!hasCustomerContext ? (
                            <p className="mt-2 text-xs text-slate-500">
                              请选择经销商后再发送 Copilot 对话。
                            </p>
                          ) : null}
                        </ComposerPrimitive.Root>
                      </ThreadPrimitive.Root>
                    </AssistantRuntimeProvider>
                  </CardContent>
                </Card>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
