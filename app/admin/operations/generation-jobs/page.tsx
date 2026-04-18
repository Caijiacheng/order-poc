"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, PlayCircle, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2 } from "lucide-react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDrawer } from "@/components/admin/admin-drawer";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { MultiSelectChecklist, type ChecklistOption } from "@/components/admin/multi-select-checklist";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminClientError, formatFieldErrors, requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type {
  DealerEntity,
  DealerSegmentEntity,
  GenerationJobEntity,
  RecommendationStrategyEntity,
} from "@/lib/memory/types";

type JobForm = {
  job_id: string;
  job_name: string;
  business_date: string;
  target_dealer_ids: string[];
  target_segment_ids: string[];
  strategy_ids: string[];
  publish_mode: "manual" | "auto";
  status: GenerationJobEntity["status"];
  publication_status: GenerationJobEntity["publication_status"];
  precheck_summary: string;
  last_precheck_at?: string;
  last_sample_batch_id?: string;
  last_batch_id?: string;
  published_batch_id?: string;
  published_at?: string;
};

type JobActionResponse = {
  job: GenerationJobEntity;
  summary?: string;
  issues?: string[];
};

const EMPTY_FORM: JobForm = {
  job_id: "",
  job_name: "",
  business_date: new Date().toISOString().slice(0, 10),
  target_dealer_ids: [],
  target_segment_ids: [],
  strategy_ids: [],
  publish_mode: "manual",
  status: "draft",
  publication_status: "unpublished",
  precheck_summary: "",
  last_precheck_at: undefined,
  last_sample_batch_id: undefined,
  last_batch_id: undefined,
  published_batch_id: undefined,
  published_at: undefined,
};

const STATUS_LABEL: Record<GenerationJobEntity["status"], string> = {
  draft: "草稿",
  prechecking: "预检中",
  ready: "预检通过",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const PUBLICATION_LABEL: Record<GenerationJobEntity["publication_status"], string> = {
  unpublished: "未发布",
  ready: "待发布",
  published: "已发布",
};

function isSnapshotStale(summary: string) {
  return summary.includes("快照状态：已过期");
}

export default function GenerationJobsPage() {
  const [items, setItems] = useState<GenerationJobEntity[]>([]);
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [segments, setSegments] = useState<DealerSegmentEntity[]>([]);
  const [strategies, setStrategies] = useState<RecommendationStrategyEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    sortBy: "business_date",
    sortOrder: "desc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<GenerationJobEntity | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
    params.set("sortBy", query.sortBy);
    params.set("sortOrder", query.sortOrder);
    if (query.q) params.set("q", query.q);
    return params.toString();
  }, [query]);

  const loadReferenceData = useCallback(async () => {
    const [dealerData, segmentData, strategyData] = await Promise.all([
      requestJson<ListResult<DealerEntity>>(
        "/api/admin/dealers?page=1&pageSize=500&sortBy=customer_name&sortOrder=asc",
      ),
      requestJson<ListResult<DealerSegmentEntity>>(
        "/api/admin/segments?page=1&pageSize=500&sortBy=segment_name&sortOrder=asc",
      ),
      requestJson<ListResult<RecommendationStrategyEntity>>(
        "/api/admin/recommendation-strategies?sceneGroup=purchase&page=1&pageSize=500&sortBy=priority&sortOrder=asc",
      ),
    ]);
    setDealers(dealerData.items);
    setSegments(segmentData.items);
    setStrategies(strategyData.items);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<GenerationJobEntity>>(
        `/api/admin/generation-jobs?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载生成任务失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const dealerOptions = useMemo<ChecklistOption[]>(() => {
    return dealers.map((item) => ({
      value: item.customer_id,
      label: item.customer_name,
      description: `${item.customer_id} · ${item.city}`,
    }));
  }, [dealers]);

  const segmentOptions = useMemo<ChecklistOption[]>(() => {
    return segments.map((item) => ({
      value: item.segment_id,
      label: item.segment_name,
      description: item.description || item.segment_id,
    }));
  }, [segments]);

  const strategyOptions = useMemo<ChecklistOption[]>(() => {
    return strategies
      .filter(
        (item) =>
          item.scene === "hot_sale_restock" ||
          item.scene === "stockout_restock" ||
          item.scene === "campaign_stockup",
      )
      .map((item) => ({
        value: item.strategy_id,
        label: item.strategy_name,
        description: `${item.scene} · 优先级 ${item.priority}`,
      }));
  }, [strategies]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const pickForEdit = (item: GenerationJobEntity) => {
    setEditingId(item.job_id);
    setForm({
      job_id: item.job_id,
      job_name: item.job_name,
      business_date: item.business_date,
      target_dealer_ids: item.target_dealer_ids,
      target_segment_ids: item.target_segment_ids,
      strategy_ids: item.strategy_ids,
      publish_mode: item.publish_mode,
      status: item.status,
      publication_status: item.publication_status,
      precheck_summary: item.precheck_summary,
      last_precheck_at: item.last_precheck_at,
      last_sample_batch_id: item.last_sample_batch_id,
      last_batch_id: item.last_batch_id,
      published_batch_id: item.published_batch_id,
      published_at: item.published_at,
    });
    setDrawerOpen(true);
  };

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const payload: JobForm = {
        ...form,
        status: "draft",
        publication_status: "unpublished",
        precheck_summary: "",
        last_precheck_at: undefined,
        last_sample_batch_id: undefined,
        last_batch_id: undefined,
        published_batch_id: undefined,
        published_at: undefined,
      };
      await requestJson<GenerationJobEntity>("/api/admin/generation-jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSuccessMessage("生成任务创建成功");
      setDrawerOpen(false);
      resetForm();
      await loadJobs();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("生成任务创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const current = items.find((item) => item.job_id === editingId);
      const payload: JobForm = {
        ...form,
        status: current?.status ?? form.status,
        publication_status: current?.publication_status ?? form.publication_status,
        precheck_summary: current?.precheck_summary ?? form.precheck_summary,
        last_precheck_at: current?.last_precheck_at ?? form.last_precheck_at,
        last_sample_batch_id: current?.last_sample_batch_id ?? form.last_sample_batch_id,
        last_batch_id: current?.last_batch_id ?? form.last_batch_id,
        published_batch_id: current?.published_batch_id ?? form.published_batch_id,
        published_at: current?.published_at ?? form.published_at,
      };
      await requestJson<GenerationJobEntity>(`/api/admin/generation-jobs/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSuccessMessage("生成任务更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadJobs();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("生成任务更新失败");
      }
    }
  };

  const cancelJob = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<GenerationJobEntity>(`/api/admin/generation-jobs/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("生成任务已取消");
      if (editingId === id) {
        setDrawerOpen(false);
        resetForm();
      }
      await loadJobs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "取消失败");
    } finally {
      setPendingCancel(null);
    }
  };

  const triggerJobAction = async (
    item: GenerationJobEntity,
    action: "precheck" | "sample-generate" | "publish" | "replay",
    fallbackSuccessMessage: string,
  ) => {
    setBusyJobId(item.job_id);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const result = await requestJson<JobActionResponse>(
        `/api/admin/generation-jobs/${item.job_id}/${action}`,
        {
          method: "POST",
        },
      );
      setSuccessMessage(result.summary || fallbackSuccessMessage);
      await loadJobs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${action} 执行失败`);
    } finally {
      setBusyJobId(null);
    }
  };

  const markReady = async (item: GenerationJobEntity) => {
    await triggerJobAction(item, "precheck", `任务 ${item.job_name} 已完成预检`);
  };

  const runSample = async (item: GenerationJobEntity) => {
    await triggerJobAction(item, "sample-generate", `任务 ${item.job_name} 已完成试生成`);
  };

  const publishNow = async (item: GenerationJobEntity) => {
    await triggerJobAction(item, "publish", `任务 ${item.job_name} 已发布`);
  };

  const replayJob = async (item: GenerationJobEntity) => {
    await triggerJobAction(item, "replay", `任务 ${item.job_name} 已触发补跑`);
  };

  return (
    <AdminPageFrame
      title="采购建议预处理任务"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadJobs} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/operations/recommendation-batches" className="gap-2">
              查看预处理批次
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/analytics/recommendation-records?view=purchase" className="gap-2">
              查看采购建议记录
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            className="rounded-full"
            onClick={() => {
              resetForm();
              setDrawerOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新建预处理任务
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <Input
            placeholder="搜索任务编号/名称"
            value={query.q}
            onChange={(event) =>
              setQuery((prev) => ({ ...prev, q: event.target.value, page: 1 }))
            }
          />
          <Select
            value={query.sortBy}
            onValueChange={(value) => setQuery((prev) => ({ ...prev, sortBy: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business_date">业务日期</SelectItem>
              <SelectItem value="updated_at">更新时间</SelectItem>
              <SelectItem value="status">状态</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.sortOrder}
            onValueChange={(value) =>
              setQuery((prev) => ({ ...prev, sortOrder: value as "asc" | "desc" }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">降序</SelectItem>
              <SelectItem value="asc">升序</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={String(query.pageSize)}
            onValueChange={(value) =>
              setQuery((prev) => ({ ...prev, pageSize: Number(value), page: 1 }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 / 页</SelectItem>
              <SelectItem value="20">20 / 页</SelectItem>
              <SelectItem value="50">50 / 页</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center text-xs text-slate-500">总数 {total}</div>
        </CardContent>
      </Card>

      <section>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>目标范围</TableHead>
                  <TableHead>策略数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>采购发布态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      {loading ? "加载中..." : "暂无生成任务"}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.job_id}>
                      <TableCell>
                        <p className="font-medium text-slate-900">{item.job_name}</p>
                        <p className="font-mono text-xs text-slate-500">{item.job_id}</p>
                        <p className="text-xs text-slate-500">业务日期 {item.business_date}</p>
                        {item.precheck_summary ? (
                          <p className="mt-1 text-xs text-slate-500">{item.precheck_summary}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        经销商 {item.target_dealer_ids.length} · 分群 {item.target_segment_ids.length}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {item.strategy_ids.length}（{item.publish_mode === "auto" ? "自动发布" : "人工发布"}）
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.status === "completed" ? "secondary" : "outline"}>
                          {STATUS_LABEL[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.publication_status === "published" ? "secondary" : "outline"}>
                          {PUBLICATION_LABEL[item.publication_status]}
                        </Badge>
                        {isSnapshotStale(item.precheck_summary) ? (
                          <Badge className="ml-2" variant="destructive">
                            待重生成
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => pickForEdit(item)}>
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => markReady(item)}
                            disabled={busyJobId === item.job_id}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            预检
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runSample(item)}
                            disabled={busyJobId === item.job_id}
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                            试生成
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => publishNow(item)}
                            disabled={busyJobId === item.job_id}
                          >
                            <Send className="h-3.5 w-3.5" />
                            发布
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => replayJob(item)}
                            disabled={busyJobId === item.job_id}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            补跑
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-600"
                            onClick={() => setPendingCancel(item)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            取消
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            resetForm();
          }
        }}
        title={editingId ? `编辑预处理任务: ${editingId}` : "创建预处理任务"}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>任务编码</Label>
              <Input
                value={form.job_id}
                disabled={Boolean(editingId)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, job_id: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>任务名称</Label>
              <Input
                value={form.job_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, job_name: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>业务日期</Label>
              <Input
                type="date"
                value={form.business_date}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, business_date: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>发布方式</Label>
              <Select
                value={form.publish_mode}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, publish_mode: value as "manual" | "auto" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">人工发布</SelectItem>
                  <SelectItem value="auto">自动发布</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <MultiSelectChecklist
            label="目标经销商"
            options={dealerOptions}
            selected={form.target_dealer_ids}
            onChange={(target_dealer_ids) =>
              setForm((prev) => ({ ...prev, target_dealer_ids }))
            }
            searchPlaceholder="搜索经销商"
          />
          <MultiSelectChecklist
            label="目标分群"
            options={segmentOptions}
            selected={form.target_segment_ids}
            onChange={(target_segment_ids) =>
              setForm((prev) => ({ ...prev, target_segment_ids }))
            }
            searchPlaceholder="搜索分群"
          />
          <MultiSelectChecklist
            label="执行方案"
            options={strategyOptions}
            selected={form.strategy_ids}
            onChange={(strategy_ids) => setForm((prev) => ({ ...prev, strategy_ids }))}
            searchPlaceholder="搜索方案"
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            状态与预检说明由任务动作接口维护（预检 / 试生成 / 发布 / 补跑），不在此表单内手工编辑。
          </div>

          <div className="flex gap-2">
            {editingId ? (
              <Button className="rounded-full" onClick={submitUpdate}>
                <Save className="h-4 w-4" />
                保存预处理任务
              </Button>
            ) : (
              <Button className="rounded-full" onClick={submitCreate}>
                <Plus className="h-4 w-4" />
                创建预处理任务
              </Button>
            )}
            <Button variant="outline" onClick={resetForm}>
              重置
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            共 {total} 条记录，当前第 {query.page} 页。
          </p>
        </div>
      </AdminDrawer>

      <AdminConfirmDialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCancel(null);
          }
        }}
        title="确认停用生成任务"
        description={`停用后该预处理任务将不再参与后续生成和发布。${
          pendingCancel ? `\n任务：${pendingCancel.job_name}` : ""
        }`}
        confirmLabel="确认取消"
        onConfirm={async () => {
          if (!pendingCancel) {
            return;
          }
          await cancelJob(pendingCancel.job_id);
        }}
      />
    </AdminPageFrame>
  );
}
