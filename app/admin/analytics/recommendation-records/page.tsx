"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Filter, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildLangfuseTraceUrl } from "@/lib/frontstage/api";
import { requestJsonWithMeta } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { RecommendationItemRecord, RecommendationRunRecord } from "@/lib/memory/types";

type RecommendationDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

type ReplayResponse = {
  batch: {
    batch_id: string;
  };
  summary: string;
  generated_run_ids: string[];
};

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  dateFrom: string;
  dateTo: string;
  customerId: string;
  scene: string;
  skuId: string;
  status: string;
  adoptionStatus: string;
  modelName: string;
  batchId: string;
  strategyId: string;
  expressionTemplateId: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 10,
  q: "",
  sortBy: "created_at",
  sortOrder: "desc",
  dateFrom: "",
  dateTo: "",
  customerId: "",
  scene: "purchase_bundle",
  skuId: "",
  status: "",
  adoptionStatus: "",
  modelName: "",
  batchId: "",
  strategyId: "",
  expressionTemplateId: "",
};

const SCENE_LABELS: Record<string, string> = {
  daily_recommendation: "采购页组货建议",
  weekly_focus: "活动备货",
  box_pair_optimization: "结算页凑单推荐",
  threshold_topup: "门槛补差",
};

function getSceneScopeNote(scene: string) {
  if (scene === "purchase_bundle" || scene === "daily_recommendation") {
    return "采购页里“热销补货 / 缺货补货”两张模板卡，会从同一条采购页组货建议里拆开显示；“活动备货”则来自活动场景建议。";
  }
  if (scene === "checkout_optimization" || scene === "box_pair_optimization") {
    return "这里展示的是结算页右侧的凑单记录，和采购页三张组货模板不是同一层数据。";
  }
  return "这里同时包含采购页组货建议和结算页凑单记录。";
}

function getScenePresentationHint(scene: string) {
  if (scene === "daily_recommendation") {
    return "前台会把这条采购页建议拆成“热销补货 / 缺货补货”两张模板卡。";
  }
  if (scene === "weekly_focus") {
    return "前台会把这条建议展示在“活动备货”和活动专区。";
  }
  if (scene === "box_pair_optimization") {
    return "这条记录对应结算页右侧的凑单推荐，不会出现在采购页三张模板卡里。";
  }
  if (scene === "threshold_topup") {
    return "这条记录对应门槛补差提醒，不属于采购页组货模板。";
  }
  return "";
}

const STATUS_LABELS: Record<string, string> = {
  generated: "已出建议",
  partially_applied: "已带走部分商品",
  fully_applied: "已整单带走",
  ignored: "本轮未采用",
  adopted: "已带走",
  not_adopted: "未带走",
  pending: "待门店处理",
  viewed: "已查看",
  explained: "已看依据",
  applied: "已加入购物车",
  rejected: "已明确不要",
  submitted_with_order: "随单下单",
  expired: "已失效",
};

function toSearchParams(query: QueryState) {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sortBy", query.sortBy);
  params.set("sortOrder", query.sortOrder);
  if (query.q) params.set("q", query.q);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.scene) params.set("scene", query.scene);
  if (query.skuId) params.set("skuId", query.skuId);
  if (query.status) params.set("status", query.status);
  if (query.adoptionStatus) params.set("adoptionStatus", query.adoptionStatus);
  if (query.modelName) params.set("modelName", query.modelName);
  if (query.batchId) params.set("batchId", query.batchId);
  if (query.strategyId) params.set("strategyId", query.strategyId);
  if (query.expressionTemplateId) {
    params.set("expressionTemplateId", query.expressionTemplateId);
  }
  return params;
}

function getLangfuseBaseUrl(meta: Record<string, unknown>) {
  const value = meta.langfuse_base_url;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL ?? "";
}

export default function RecommendationRecordsPage() {
  const searchParams = useSearchParams();
  const initialBatchId = searchParams.get("batchId") ?? "";
  const initialCustomerId = searchParams.get("customerId") ?? "";

  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [records, setRecords] = useState<RecommendationRunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<(RecommendationDetail & { langfuseBaseUrl: string }) | null>(
    null,
  );
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRecords = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<ListResult<RecommendationRunRecord>>(
        `/api/admin/recommendation-records?${toSearchParams(nextQuery).toString()}`,
      );
      setRecords(result.data.items);
      setTotal(result.data.total);
      setLangfuseBaseUrl(getLangfuseBaseUrl(result.meta));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载门店建议失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const nextQuery = {
      ...INITIAL_QUERY,
      batchId: initialBatchId,
      customerId: initialCustomerId,
      scene: initialBatchId || initialCustomerId ? "" : INITIAL_QUERY.scene,
    };
    setQuery(nextQuery);
    void loadRecords(nextQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<RecommendationDetail>(
        `/api/admin/recommendation-records/${id}`,
      );
      setDetail({
        ...result.data,
        langfuseBaseUrl: getLangfuseBaseUrl(result.meta),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载详情失败");
    } finally {
      setLoadingDetail(false);
    }
  };

  const traceLink = buildLangfuseTraceUrl(
    detail?.run.trace_id,
    detail?.langfuseBaseUrl || langfuseBaseUrl,
  );
  const canReplayCurrentRecord =
    detail?.run.scene === "daily_recommendation" ||
    detail?.run.scene === "weekly_focus" ||
    detail?.run.scene === "box_pair_optimization";

  const replayCurrentRecord = async () => {
    if (!detail || !canReplayCurrentRecord) {
      return;
    }
    setReplaying(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<ReplayResponse>(
        `/api/admin/recommendation-records/${detail.run.recommendation_run_id}/replay`,
        {
          method: "POST",
        },
      );
      setSuccessMessage(`${result.data.summary}，新批次 ${result.data.batch.batch_id} 已生成。`);
      const nextQuery = {
        ...query,
        page: 1,
        batchId: "",
        customerId: detail.run.customer_id,
      };
      setQuery(nextQuery);
      await loadRecords(nextQuery);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "补跑失败");
    } finally {
      setReplaying(false);
    }
  };

  return (
    <AdminPageFrame
      title="前台建议明细"
      description="默认先看采购页组货建议；切换后也可以查看结算页凑单记录，并支持单条建议重新生成。"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-full"
            variant="outline"
            onClick={() => void loadRecords()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/operations/recommendation-batches">查看生成批次</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/traces">查看执行过程</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="p-4 text-sm leading-6 text-slate-600">
          {getSceneScopeNote(query.scene)}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-9">
          <div className="space-y-1">
            <Label>开始时间</Label>
            <Input
              type="datetime-local"
              value={query.dateFrom}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateFrom: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>结束时间</Label>
            <Input
              type="datetime-local"
              value={query.dateTo}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, dateTo: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>经销商编码</Label>
            <Input
              value={query.customerId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, customerId: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>场景</Label>
            <Select
              value={query.scene || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({ ...prev, scene: value === "all" ? "" : value, page: 1 }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="purchase_bundle">采购页组货建议</SelectItem>
                <SelectItem value="checkout_optimization">结算页凑单记录</SelectItem>
                <SelectItem value="all">全部记录</SelectItem>
                <SelectItem value="daily_recommendation">采购页组货建议</SelectItem>
                <SelectItem value="weekly_focus">活动备货</SelectItem>
                <SelectItem value="box_pair_optimization">结算页凑单推荐</SelectItem>
                <SelectItem value="threshold_topup">门槛补差</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>状态</Label>
            <Select
              value={query.status || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({ ...prev, status: value === "all" ? "" : value, page: 1 }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="generated">已出建议</SelectItem>
                <SelectItem value="partially_applied">已带走部分商品</SelectItem>
                <SelectItem value="fully_applied">已整单带走</SelectItem>
                <SelectItem value="ignored">本轮未采用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>采纳状态</Label>
            <Select
              value={query.adoptionStatus || "all"}
              onValueChange={(value) =>
                setQuery((prev) => ({
                  ...prev,
                  adoptionStatus: value === "all" ? "" : value,
                  page: 1,
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="adopted">已带走</SelectItem>
                <SelectItem value="not_adopted">未带走</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>SKU 编码</Label>
            <Input
              value={query.skuId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, skuId: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>批次 ID</Label>
            <Input
              value={query.batchId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, batchId: event.target.value, page: 1 }))
              }
            />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void loadRecords({ ...query, page: 1 })}
            >
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card data-testid="recommendation-report-table">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>run ID</TableHead>
                  <TableHead>批次</TableHead>
                  <TableHead>经销商</TableHead>
                  <TableHead>场景</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((row) => (
                    <TableRow
                      key={row.recommendation_run_id}
                      className="cursor-pointer"
                      onClick={() => void loadDetail(row.recommendation_run_id)}
                    >
                      <TableCell className="font-mono text-xs">{row.recommendation_run_id}</TableCell>
                      <TableCell className="font-mono text-xs">{row.batch_id ?? "-"}</TableCell>
                      <TableCell>{row.customer_name}</TableCell>
                      <TableCell>{SCENE_LABELS[row.scene] ?? row.scene}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.model_latency_ms}ms</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">建议详情</p>
            {!detail ? (
              <p className="text-sm text-slate-500">点击左侧记录查看详情</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-mono text-xs">{detail.run.recommendation_run_id}</p>
                  <p className="mt-1">
                    {detail.run.customer_name} ·{" "}
                    {SCENE_LABELS[detail.run.scene] ?? detail.run.scene}
                  </p>
                  <p className="text-xs text-slate-500">批次：{detail.run.batch_id ?? "-"}</p>
                  <p className="text-xs text-slate-500">方案：{detail.run.strategy_id ?? "-"}</p>
                  <p className="text-xs text-slate-500">
                    状态：{STATUS_LABELS[detail.run.status] ?? detail.run.status}
                  </p>
                  {traceLink ? (
                    <a
                      href={traceLink}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="trace-link"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline underline-offset-2"
                    >
                      在 Langfuse 打开链路
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">Langfuse 链路入口不可用</p>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                  {getScenePresentationHint(detail.run.scene)}
                </div>
                <div className="space-y-2">
                  {detail.items.slice(0, 8).map((item) => (
                    <div
                      key={item.recommendation_item_id}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
                    >
                      <p className="font-medium">{item.sku_name}</p>
                      <p className="text-xs text-slate-500">
                        {item.sku_id} · 建议数量 {item.suggested_qty} ·{" "}
                        {STATUS_LABELS[item.final_status] ?? item.final_status}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">提示词快照</p>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                    {detail.run.prompt_snapshot}
                  </pre>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">模型回复快照</p>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                    {detail.run.response_snapshot ?? "当前记录暂无模型回复快照。"}
                  </pre>
                </div>
                <div className="grid gap-2">
                  {canReplayCurrentRecord ? (
                    <Button
                      variant="outline"
                      onClick={() => void replayCurrentRecord()}
                      disabled={replaying}
                    >
                      {replaying ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                      重新生成当前这条建议
                    </Button>
                  ) : null}
                  {detail.run.batch_id ? (
                    <Button asChild variant="outline">
                      <Link
                        href={`/admin/observability/traces?batchId=${encodeURIComponent(
                          detail.run.batch_id,
                        )}`}
                      >
                        查看同批次执行过程
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </>
            )}
            {loadingDetail ? <p className="text-xs text-slate-500">详情加载中...</p> : null}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...query, page: Math.max(1, query.page - 1) };
                  setQuery(next);
                  void loadRecords(next);
                }}
                disabled={query.page <= 1 || loading}
              >
                上一页
              </Button>
              <span>
                总数 {total}，当前页 {query.page}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...query, page: query.page + 1 };
                  setQuery(next);
                  void loadRecords(next);
                }}
                disabled={query.page * query.pageSize >= total || loading}
              >
                下一页
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
