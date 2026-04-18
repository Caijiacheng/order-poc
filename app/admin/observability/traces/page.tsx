"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Filter, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type TraceDetail = {
  run: RecommendationRunRecord;
  items: RecommendationItemRecord[];
};

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
  dateFrom: string;
  dateTo: string;
  customerId: string;
  scene: string;
  adoptionStatus: string;
  batchId: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 12,
  q: "",
  dateFrom: "",
  dateTo: "",
  customerId: "",
  scene: "",
  adoptionStatus: "",
  batchId: "",
};

const SCENE_LABELS: Record<string, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  box_pair_optimization: "箱规与搭配优化",
  threshold_topup: "门槛补差",
};

const STATUS_LABELS: Record<string, string> = {
  generated: "已出建议",
  partially_applied: "已采纳部分商品",
  fully_applied: "已采纳",
  ignored: "本轮未采纳",
  adopted: "已采纳",
  not_adopted: "未采纳",
  pending: "待门店处理",
  viewed: "已查看",
  explained: "已看依据",
  applied: "已加入购物车",
  rejected: "已明确不要",
  submitted_with_order: "随单下单",
  expired: "已失效",
};

function toSearchParams(query: QueryState) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sortBy: "created_at",
    sortOrder: "desc",
  });
  if (query.q) params.set("q", query.q);
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.customerId) params.set("customerId", query.customerId);
  if (query.scene) params.set("scene", query.scene);
  if (query.adoptionStatus) params.set("adoptionStatus", query.adoptionStatus);
  if (query.batchId) params.set("batchId", query.batchId);
  return params;
}

function getLangfuseBaseUrl(meta: Record<string, unknown>) {
  const value = meta.langfuse_base_url;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL ?? "";
}

export default function TraceObservabilityPage() {
  const searchParams = useSearchParams();
  const initialBatchId = searchParams.get("batchId") ?? "";

  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [rows, setRows] = useState<RecommendationRunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<(TraceDetail & { langfuseBaseUrl: string }) | null>(null);
  const [langfuseBaseUrl, setLangfuseBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadTraces = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<ListResult<RecommendationRunRecord>>(
        `/api/admin/recommendation-records?${toSearchParams(nextQuery).toString()}`,
      );
      setRows(result.data.items);
      setTotal(result.data.total);
      setLangfuseBaseUrl(getLangfuseBaseUrl(result.meta));
      setDetail((prev) =>
        result.data.items.some(
          (item) => item.recommendation_run_id === prev?.run.recommendation_run_id,
        )
          ? prev
          : null,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载链路列表失败");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    setErrorMessage("");
    try {
      const result = await requestJsonWithMeta<TraceDetail>(
        `/api/admin/recommendation-records/${id}`,
      );
      setDetail({
        ...result.data,
        langfuseBaseUrl: getLangfuseBaseUrl(result.meta),
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载链路详情失败");
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    const nextQuery = {
      ...INITIAL_QUERY,
      batchId: initialBatchId,
    };
    setQuery(nextQuery);
    void loadTraces(nextQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminPageFrame
      title="执行过程"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadTraces()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/analytics/recommendation-records">查看门店建议</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-8">
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
            <Label>批次 ID</Label>
            <Input
              value={query.batchId}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, batchId: event.target.value, page: 1 }))
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
                <SelectItem value="all">全部场景</SelectItem>
                <SelectItem value="daily_recommendation">日常补货</SelectItem>
                <SelectItem value="weekly_focus">周活动备货</SelectItem>
                <SelectItem value="box_pair_optimization">箱规与搭配优化</SelectItem>
                <SelectItem value="threshold_topup">门槛补差</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>状态</Label>
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
                <SelectItem value="generated">已出建议</SelectItem>
                <SelectItem value="partially_applied">已采纳部分商品</SelectItem>
                <SelectItem value="fully_applied">已采纳</SelectItem>
                <SelectItem value="ignored">本轮未采纳</SelectItem>
                <SelectItem value="adopted">已采纳</SelectItem>
                <SelectItem value="not_adopted">未采纳</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>关键词</Label>
            <Input
              value={query.q}
              onChange={(event) =>
                setQuery((prev) => ({ ...prev, q: event.target.value, page: 1 }))
              }
              placeholder="run_id / 经销商 / 模型名"
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void loadTraces({ ...query, page: 1 })}
            >
              <Filter className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>Trace</TableHead>
                  <TableHead>批次</TableHead>
                  <TableHead>经销商</TableHead>
                  <TableHead>场景 / 方案</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-slate-500">
                      暂无链路数据
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.recommendation_run_id}
                      className="cursor-pointer"
                      onClick={() => void loadDetail(row.recommendation_run_id)}
                    >
                      <TableCell className="font-mono text-xs">
                        {new Date(row.created_at).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.trace_id ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.batch_id ?? "-"}</TableCell>
                      <TableCell>{row.customer_name}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        <p>{SCENE_LABELS[row.scene] ?? row.scene}</p>
                        <p className="mt-1 text-slate-500">{row.strategy_id ?? "默认方案"}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.model_latency_ms}ms</TableCell>
                      <TableCell className="text-right">
                        {buildLangfuseTraceUrl(row.trace_id, langfuseBaseUrl) ? (
                          <a
                            href={buildLangfuseTraceUrl(row.trace_id, langfuseBaseUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline underline-offset-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            Langfuse
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">不可用</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">执行详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!detail ? (
              <p className="text-sm text-slate-500">点击左侧链路查看详情。</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-mono text-xs">{detail.run.recommendation_run_id}</p>
                  <p className="mt-1">
                    {detail.run.customer_name} ·{" "}
                    {SCENE_LABELS[detail.run.scene] ?? detail.run.scene}
                  </p>
                  <p className="text-xs text-slate-500">
                    状态：{STATUS_LABELS[detail.run.status] ?? detail.run.status}
                  </p>
                  <p className="text-xs text-slate-500">
                    批次：{detail.run.batch_id ?? "-"} · 方案：{detail.run.strategy_id ?? "默认方案"} · 耗时：{detail.run.model_latency_ms}ms
                  </p>
                  <p className="text-xs text-slate-500">
                    Trace ID：{detail.run.trace_id ?? "暂无"}
                  </p>
                  {buildLangfuseTraceUrl(detail.run.trace_id, detail.langfuseBaseUrl) ? (
                    <a
                      href={buildLangfuseTraceUrl(detail.run.trace_id, detail.langfuseBaseUrl)}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="trace-link"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline underline-offset-2"
                    >
                      在 Langfuse 打开链路
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">未配置 Langfuse 链路入口</p>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">推荐条目（前 8 条）</p>
                  <div className="mt-2 space-y-2">
                    {detail.items.slice(0, 8).map((item) => (
                      <div
                        key={item.recommendation_item_id}
                        className="rounded-lg border border-slate-200 p-2"
                      >
                        <p className="text-sm font-medium text-slate-800">{item.sku_name}</p>
                        <p className="text-xs text-slate-500">
                          {item.sku_id} · 建议数量 {item.suggested_qty} ·{" "}
                          {STATUS_LABELS[item.final_status] ?? item.final_status}
                        </p>
                      </div>
                    ))}
                    {detail.items.length === 0 ? (
                      <p className="text-sm text-slate-500">该链路暂无推荐条目。</p>
                    ) : null}
                  </div>
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
                  void loadTraces(next);
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
                  void loadTraces(next);
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
