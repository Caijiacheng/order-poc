"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Loader2,
  MessageCircle,
  Paperclip,
  ShoppingCart,
  Sparkles,
  X,
  ZoomIn,
} from "lucide-react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
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
  CopilotImageExtractLine,
  CopilotImageInput,
} from "@/lib/copilot/types";
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
  templateCount: number;
  onCartReload: () => Promise<void>;
  onApplySuccess?: () => void;
};

const MAX_IMAGES = 3;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const QUICK_PREFERENCES = ["预算 6000 左右", "优先活动", "不要新品", "只补常购", "保守一点"] as const;

const STEP_LABEL_MAP: Record<string, string> = {
  load_context: "读取当前采购上下文",
  image_extract: "识别图片内容",
  parse_intent: "整理本次要求",
  detect_campaign_state: "识别活动状态",
  build_legal_candidates: "计算可执行组合",
  select_best_combo: "挑选采购组合",
  apply_draft: "生成采购预览",
  run_cart_optimization: "同步凑单优化",
  summarize_result: "整理结果说明",
};

function resolveDraft(
  autofill: CopilotAutofillResponse | null,
  jobDetail: CopilotJobDetailResponse | null,
) {
  return jobDetail?.draft ?? autofill?.draft ?? null;
}

function resolveRun(
  autofill: CopilotAutofillResponse | null,
  jobDetail: CopilotJobDetailResponse | null,
) {
  return jobDetail?.run ?? autofill?.run ?? null;
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

function sendComposerText(
  runtime: ReturnType<typeof useChatRuntime>,
  message: string,
) {
  runtime.thread.composer.setText(message);
  window.requestAnimationFrame(() => {
    runtime.thread.composer.send();
  });
}

function toBlockedReasonText(reason?: string) {
  if (!reason) {
    return "当前条件下未生成可执行方案，可补充偏好后重试。";
  }
  if (reason === "no_legal_combo") {
    return "未找到符合规则的候选组合，可放宽约束后重试。";
  }
  if (reason.startsWith("image_")) {
    return "图片识别存在待确认项，请检查识别内容后再继续。";
  }
  return `当前流程被阻塞：${reason}`;
}

function StepStatusPill(input: { status: string }) {
  if (input.status === "completed") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">已完成</Badge>;
  }
  if (input.status === "blocked") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">待确认</Badge>;
  }
  if (input.status === "failed") {
    return <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">失败</Badge>;
  }
  if (input.status === "running") {
    return (
      <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        处理中
      </Badge>
    );
  }
  if (input.status === "skipped") {
    return <Badge variant="outline">跳过</Badge>;
  }
  return <Badge variant="outline">等待中</Badge>;
}

function isSupportedImageFile(file: File) {
  return ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number]);
}

function readFileAsDataUrl(file: File) {
  return new Promise<CopilotImageInput>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:")) {
        reject(new Error(`图片 ${file.name} 读取失败`));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        mimeType: file.type,
        fileName: file.name,
        dataUrl: result,
      });
    };
    reader.onerror = () => reject(new Error(`图片 ${file.name} 读取失败`));
    reader.readAsDataURL(file);
  });
}

function getThresholdHint(cartSummary: PurchaseCopilotPanelProps["cartSummary"]) {
  if (cartSummary.threshold_reached) {
    return "已达到起订额，可继续去结算";
  }
  return `还差 ${formatMoney(cartSummary.gap_to_threshold)} 达到起订额`;
}

function getActivityStatus(activityHighlights: ActivityHighlight[]) {
  if (activityHighlights.length === 0) {
    return "本周暂无可参与活动";
  }
  return `本周可参与活动 ${activityHighlights.length} 个`;
}

function appendPreferenceText(currentText: string, chip: string) {
  const trimmed = currentText.trim();
  if (!trimmed) {
    return chip;
  }
  if (trimmed.includes(chip)) {
    return trimmed;
  }
  const suffix = /[，。,.]$/.test(trimmed) ? "" : "，";
  return `${trimmed}${suffix}${chip}`;
}

function getLineStatusLabel(line: CopilotImageExtractLine) {
  if (line.match_status === "matched") {
    return "已匹配";
  }
  if (line.match_status === "pending_confirm") {
    return "待确认";
  }
  return "未匹配";
}

function getLineStatusClassName(line: CopilotImageExtractLine) {
  if (line.match_status === "matched") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (line.match_status === "pending_confirm") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-slate-200 text-slate-700";
}

function ImagePreviewModal(input: {
  images: CopilotImageInput[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const current = input.images[input.index];
  if (!current) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/72"
        aria-label="关闭图片预览"
        onClick={input.onClose}
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">图片预览</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {current.fileName} · {input.index + 1}/{input.images.length}
              </p>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="关闭图片预览"
              onClick={input.onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative flex items-center justify-center bg-slate-100 p-4">
            {input.images.length > 1 ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                className="absolute left-4 top-1/2 -translate-y-1/2"
                aria-label="上一张图片"
                onClick={input.onPrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <img
              src={current.dataUrl}
              alt={current.fileName}
              className="max-h-[70vh] w-auto rounded-2xl object-contain"
            />
            {input.images.length > 1 ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                className="absolute right-4 top-1/2 -translate-y-1/2"
                aria-label="下一张图片"
                onClick={input.onNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageExtractDetailModal(input: {
  lines: CopilotImageExtractLine[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[65]">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45"
        aria-label="关闭识别内容"
        onClick={input.onClose}
      />
      <div className="absolute inset-y-0 right-0 w-full max-w-xl border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">识别内容</p>
            <p className="mt-1 text-sm font-medium text-slate-900">用于校验本次图片输入</p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="关闭识别内容"
            onClick={input.onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="h-[calc(100%-73px)] space-y-3 overflow-y-auto p-4">
          {input.lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              当前没有可展示的识别明细。
            </div>
          ) : (
            input.lines.map((line) => (
              <div
                key={line.line_id}
                className="rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{line.original_text}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      置信度 {line.confidence}
                      {line.qty_hint ? ` · 数量线索 ${line.qty_hint}` : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getLineStatusClassName(line)}`}
                  >
                    {getLineStatusLabel(line)}
                  </span>
                </div>
                {line.matched_sku_name ? (
                  <p className="mt-2 text-sm text-slate-700">匹配商品：{line.matched_sku_name}</p>
                ) : null}
                {line.pending_reason ? (
                  <p className="mt-2 text-xs text-slate-500">说明：{line.pending_reason}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function PurchaseCopilotPanel(props: PurchaseCopilotPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [runningAction, setRunningAction] = useState<"autofill" | "topup" | null>(null);
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [autofillResult, setAutofillResult] = useState<CopilotAutofillResponse | null>(null);
  const [jobDetail, setJobDetail] = useState<CopilotJobDetailResponse | null>(null);
  const [panelError, setPanelError] = useState("");
  const [panelSuccess, setPanelSuccess] = useState("");
  const [appliedOrderCta, setAppliedOrderCta] = useState(false);
  const [images, setImages] = useState<CopilotImageInput[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [extractDetailOpen, setExtractDetailOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
              images,
            },
          };
        },
      }),
    [images, props.customerId],
  );

  const runtime = useChatRuntime({ transport });
  const hasCustomerContext = Boolean(props.customerId);
  const currentDraft = resolveDraft(autofillResult, jobDetail);
  const currentRun = resolveRun(autofillResult, jobDetail);
  const currentJob = resolveJob(autofillResult, jobDetail);
  const currentSteps = resolveSteps(autofillResult, jobDetail);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (previewIndex !== null) {
          setPreviewIndex(null);
          return;
        }
        if (extractDetailOpen) {
          setExtractDetailOpen(false);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [extractDetailOpen, open, previewIndex]);

  useEffect(() => {
    if (!currentJob || currentJob.status !== "running") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const detail = await fetchCopilotJobDetail(currentJob.job_id);
        setJobDetail(detail);
      } catch {
        // Keep current state when polling fails transiently.
      }
    }, 1200);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentJob]);

  const addImages = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const supported = files.filter(isSupportedImageFile);
    if (supported.length === 0) {
      setPanelError("仅支持 JPG、PNG、WEBP 图片。");
      return;
    }

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      setPanelError(`最多上传 ${MAX_IMAGES} 张图片。`);
      return;
    }

    const nextFiles = supported.slice(0, remainingSlots);
    if (files.length > nextFiles.length) {
      setPanelError(`最多保留 ${MAX_IMAGES} 张图片，超出部分未加入。`);
    } else {
      setPanelError("");
    }

    try {
      const nextImages = await Promise.all(nextFiles.map(readFileAsDataUrl));
      setImages((prev) => [...prev, ...nextImages]);
      setPanelSuccess(`已附 ${Math.min(MAX_IMAGES, images.length + nextImages.length)} 张图片，可用于本次做单。`);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "图片读取失败");
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    await addImages(nextFiles);
    event.target.value = "";
  };

  const handlePasteImages = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    await addImages(pastedFiles);
  };

  const runAutofill = async (mode: "autofill" | "topup") => {
    if (!hasCustomerContext) {
      setPanelError("请先选择经销商后再使用 AI 下单助手。");
      return;
    }

    setRunningAction(mode);
    setPanelError("");
    setPanelSuccess("");
    setAppliedOrderCta(false);

    try {
      const result = await requestCopilotAutofill({
        customerId: props.customerId,
        message: draftText.trim(),
        images,
        pageName: "/purchase",
      });
      setAutofillResult(result);
      setJobDetail(null);
      setPanelSuccess("已生成采购预览，可确认后加入采购清单。");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "采购预览生成失败");
    } finally {
      setRunningAction(null);
    }
  };

  const runExplain = () => {
    if (!hasCustomerContext) {
      setPanelError("请先选择经销商后再使用 AI 下单助手。");
      return;
    }

    const effectiveMessage =
      draftText.trim() || (images.length > 0 ? "请结合已上传图片解释当前输入内容。" : "");

    if (!effectiveMessage) {
      setPanelError("请先输入问题或上传图片。");
      return;
    }

    setPanelError("");
    sendComposerText(runtime, effectiveMessage);
    setDraftText("");
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
      setPanelSuccess("已加入采购清单，可继续调整或去结算。");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "应用草稿失败");
    } finally {
      setApplyingDraft(false);
    }
  };

  const scrollToSection = (testId: string) => {
    setOpen(false);
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  const handleQuickPreference = (chip: string) => {
    setDraftText((prev) => appendPreferenceText(prev, chip));
    composerRef.current?.focus();
  };

  const recognitionSummary =
    currentRun?.image_extract_summary_text ||
    (images.length > 0 ? `已附 ${images.length} 张图片，可用于本次做单。` : "");

  const recognitionLines = currentRun?.image_extract_lines ?? [];

  if (!mounted) {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        aria-label="打开 AI 下单助手"
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
            aria-label="关闭 AI 下单助手"
            onClick={() => setOpen(false)}
          />

          <aside className="absolute right-0 top-0 h-full w-full max-w-[420px] border-l border-slate-200 bg-white shadow-2xl">
            <header className="border-b border-slate-200 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">AI 下单助手</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    {props.customerName || "当前经销商"} · 当前采购辅助
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">查看当前采购情况，并生成一版采购预览</p>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="关闭 AI 下单助手"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">当前金额 {formatMoney(props.cartSummary.total_amount)}</Badge>
                <Badge variant="outline">已选 {props.cartSummary.sku_count} 个 SKU</Badge>
                <Badge variant="outline">{getActivityStatus(props.activityHighlights)}</Badge>
                {props.activityHighlights.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-sky-700 underline-offset-4 hover:underline"
                    onClick={() => scrollToSection("purchase-activity-zone")}
                  >
                    查看活动
                  </button>
                ) : null}
              </div>

              <p className="mt-2 text-xs text-slate-600">{getThresholdHint(props.cartSummary)}</p>
            </header>

            <div className="h-[calc(100%-112px)] overflow-y-auto p-4">
              <div className="space-y-4">
                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">当前采购情况</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-slate-700">已加载 {props.templateCount} 组进货模板</p>
                      <button
                        type="button"
                        className="text-xs font-medium text-sky-700 underline-offset-4 hover:underline"
                        onClick={() => scrollToSection("purchase-bundle-templates")}
                      >
                        查看模板
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-slate-700">{getActivityStatus(props.activityHighlights)}</p>
                      {props.activityHighlights.length > 0 ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-sky-700 underline-offset-4 hover:underline"
                          onClick={() => scrollToSection("purchase-activity-zone")}
                        >
                          查看活动
                        </button>
                      ) : null}
                    </div>
                    <p className="text-slate-600">可从模板、活动或商品区继续加购</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">你可以这样操作</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <Button
                      type="button"
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
                    <p className="-mt-1 text-xs leading-5 text-slate-500">
                      按当前门店、活动和采购清单生成一版采购预览
                    </p>
                    <Button
                      type="button"
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
                    <p className="-mt-1 text-xs leading-5 text-slate-500">围绕活动门槛生成一版活动补齐预览</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={runExplain}
                      disabled={!hasCustomerContext || runningAction !== null || applyingDraft}
                    >
                      <MessageCircle className="h-4 w-4" />
                      解释这单
                    </Button>
                    <p className="-mt-1 text-xs leading-5 text-slate-500">查看本次推荐或补齐的依据</p>
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">补充偏好</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {QUICK_PREFERENCES.map((chip) => (
                        <Button
                          key={chip}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleQuickPreference(chip)}
                        >
                          {chip}
                        </Button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-slate-500" htmlFor="purchase-copilot-input">
                        可输入偏好，也可上传采购截图 / 聊天截图 / 纸质单据照片
                      </label>
                      <textarea
                        id="purchase-copilot-input"
                        ref={composerRef}
                        rows={3}
                        className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        placeholder={
                          hasCustomerContext
                            ? "比如：预算 6000，优先活动，不要新品"
                            : "请先选择经销商后再输入偏好"
                        }
                        disabled={!hasCustomerContext}
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        onPaste={(event) => void handlePasteImages(event)}
                      />
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES.join(",")}
                      multiple
                      className="hidden"
                      onChange={(event) => void handleFileChange(event)}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="h-4 w-4" />
                        上传图片
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          composerRef.current?.focus();
                          setPanelSuccess("请在输入框中使用 Ctrl/Cmd + V 粘贴截图。");
                        }}
                      >
                        粘贴截图
                      </Button>
                    </div>

                    {images.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {images.map((image, index) => (
                            <button
                              key={image.id}
                              type="button"
                              className="group relative h-20 w-20 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                              aria-label={`预览图片 ${image.fileName}`}
                              onClick={() => setPreviewIndex(index)}
                            >
                              <img
                                src={image.dataUrl}
                                alt={image.fileName}
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 transition group-hover:bg-slate-900/30">
                                <ZoomIn className="h-4 w-4 text-white opacity-0 transition group-hover:opacity-100" />
                              </div>
                            </button>
                          ))}
                        </div>

                        {recognitionSummary ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            <p>{recognitionSummary}</p>
                            {recognitionLines.length > 0 ? (
                              <button
                                type="button"
                                className="mt-2 text-xs font-medium text-sky-700 underline-offset-4 hover:underline"
                                onClick={() => setExtractDetailOpen(true)}
                              >
                                查看识别内容
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => runtime.thread.composer.cancel()}
                        disabled={!runtime.thread.composer.getState().canCancel}
                      >
                        停止
                      </Button>
                      <Button type="button" size="sm" onClick={runExplain} disabled={!hasCustomerContext}>
                        发送
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {panelError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {panelError}
                  </div>
                ) : null}

                {panelSuccess ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {panelSuccess}
                  </div>
                ) : null}

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">正在整理这单</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {currentSteps.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                        未生成采购预览，可先输入偏好或上传图片。
                      </div>
                    ) : (
                      currentSteps.map((step) => (
                        <div
                          key={step.step_id}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <p className="text-xs text-slate-700">
                            {STEP_LABEL_MAP[step.step_name] ?? step.step_name}
                          </p>
                          <StepStatusPill status={step.status} />
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {currentJob?.status === "blocked" || currentDraft?.status === "blocked" ? (
                  <Card className="border-amber-200 bg-amber-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
                        <AlertTriangle className="h-4 w-4" />
                        当前条件下未生成可执行方案
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-amber-900">
                      <p>{toBlockedReasonText(currentDraft?.blocked_reason ?? currentJob?.blocked_reason)}</p>
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">本次建议</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {!currentDraft ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-slate-500">
                        还没有采购预览。可先选择一种操作。
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-slate-500">新增 SKU</p>
                            <p className="mt-1 font-semibold text-slate-900">{currentDraft.items.length}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-slate-500">预估金额</p>
                            <p className="mt-1 font-semibold text-slate-900">
                              {formatMoney(currentDraft.cart_amount_after_preview)}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <p className="text-slate-500">活动状态</p>
                          <p className="mt-1 text-slate-900">
                            {currentDraft.campaign_state.campaign_name
                              ? currentDraft.campaign_state.is_hit
                                ? "已命中"
                                : `还差 ${formatMoney(currentDraft.campaign_state.gap_amount)}`
                              : "当前无活动"}
                          </p>
                        </div>

                        {currentDraft.summary_text ? (
                          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                            {currentDraft.summary_text}
                          </div>
                        ) : null}

                        <div className="grid gap-2">
                          {currentDraft.status === "preview" ? (
                            <Button
                              type="button"
                              className="w-full"
                              onClick={() => void applyDraft()}
                              disabled={applyingDraft || runningAction !== null}
                            >
                              {applyingDraft ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ShoppingCart className="h-4 w-4" />
                              )}
                              加入采购清单
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                              <CheckCircle2 className="h-4 w-4" />
                              已加入采购清单
                            </div>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => composerRef.current?.focus()}
                          >
                            继续调整
                          </Button>

                          <Button asChild variant="secondary">
                            <Link href="/order-submit">
                              去结算
                            </Link>
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-slate-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-900">对话记录</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AssistantRuntimeProvider runtime={runtime}>
                      <ThreadPrimitive.Root className="flex h-[220px] flex-col rounded-2xl border border-slate-200 bg-slate-50">
                        <ThreadPrimitive.Viewport className="flex-1 space-y-2 overflow-y-auto p-2">
                          <ThreadPrimitive.Empty>
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-xs leading-5 text-slate-500">
                              解释结果会显示在这里。
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
                                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
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
                      </ThreadPrimitive.Root>
                    </AssistantRuntimeProvider>
                  </CardContent>
                </Card>

                {appliedOrderCta ? (
                  <Button asChild className="w-full">
                    <Link href="/order-submit">去结算页继续提交</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>

          {previewIndex !== null ? (
            <ImagePreviewModal
              images={images}
              index={previewIndex}
              onClose={() => setPreviewIndex(null)}
              onPrev={() =>
                setPreviewIndex((prev) =>
                  prev === null ? 0 : (prev - 1 + images.length) % images.length,
                )
              }
              onNext={() =>
                setPreviewIndex((prev) =>
                  prev === null ? 0 : (prev + 1) % images.length,
                )
              }
            />
          ) : null}

          {extractDetailOpen ? (
            <ImageExtractDetailModal
              lines={recognitionLines}
              onClose={() => setExtractDetailOpen(false)}
            />
          ) : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
