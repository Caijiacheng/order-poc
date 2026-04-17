"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, CheckCircle2, Plus, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { TokenEditor } from "@/components/admin/token-editor";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AdminClientError,
  formatFieldErrors,
  requestJson,
} from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { RecoverySnapshotRecord } from "@/lib/memory/types";

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
  status: string;
};

type SnapshotForm = {
  snapshot_id: string;
  snapshot_name: string;
  source: RecoverySnapshotRecord["source"];
  description: string;
  config_snapshot_id: string;
  related_entity_types: string[];
  status: RecoverySnapshotRecord["status"];
  created_by: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 12,
  q: "",
  status: "",
};

const EMPTY_FORM: SnapshotForm = {
  snapshot_id: "",
  snapshot_name: "",
  source: "manual",
  description: "",
  config_snapshot_id: "config_snapshot_manual",
  related_entity_types: [],
  status: "available",
  created_by: "admin",
};

const STATUS_LABELS: Record<RecoverySnapshotRecord["status"], string> = {
  available: "可用",
  applied: "已应用",
  archived: "已归档",
};

const SOURCE_LABELS: Record<RecoverySnapshotRecord["source"], string> = {
  seed: "Seed 基线",
  manual: "人工创建",
  system: "系统生成",
};

function toSearchParams(query: QueryState) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sortBy: "created_at",
    sortOrder: "desc",
  });
  if (query.q) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  return params;
}

export default function RecoveryPage() {
  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [rows, setRows] = useState<RecoverySnapshotRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<RecoverySnapshotRecord | null>(null);
  const [form, setForm] = useState<SnapshotForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadSnapshots = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<RecoverySnapshotRecord>>(
        `/api/admin/recovery?${toSearchParams(nextQuery).toString()}`,
      );
      setRows(data.items);
      setTotal(data.total);
      setSelected((prev) =>
        data.items.some((item) => item.snapshot_id === prev?.snapshot_id)
          ? prev
          : (data.items[0] ?? null),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载恢复快照失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshots(INITIAL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSnapshot = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecoverySnapshotRecord>("/api/admin/recovery", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSuccessMessage("恢复快照创建成功");
      setForm(EMPTY_FORM);
      await loadSnapshots({ ...query, page: 1 });
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage(error instanceof Error ? error.message : "创建失败");
      }
    }
  };

  const applySnapshot = async (snapshot: RecoverySnapshotRecord) => {
    setActingId(snapshot.snapshot_id);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecoverySnapshotRecord>(
        `/api/admin/recovery/${snapshot.snapshot_id}/apply`,
        { method: "POST" },
      );
      setSuccessMessage(`已应用恢复快照 ${snapshot.snapshot_name}`);
      await loadSnapshots();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "应用失败");
    } finally {
      setActingId(null);
    }
  };

  const archiveSnapshot = async (snapshot: RecoverySnapshotRecord) => {
    setActingId(snapshot.snapshot_id);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecoverySnapshotRecord>(`/api/admin/recovery/${snapshot.snapshot_id}`, {
        method: "DELETE",
      });
      setSuccessMessage(`已归档恢复快照 ${snapshot.snapshot_name}`);
      await loadSnapshots();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "归档失败");
    } finally {
      setActingId(null);
    }
  };

  return (
    <AdminPageFrame
      title="回滚中心"
      description="管理恢复快照并执行应用/归档操作，保持演示基线可回退。"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadSnapshots()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/audit-logs">查看审计日志</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]">
          <Input
            placeholder="搜索 snapshot_id / 名称 / 说明"
            value={query.q}
            onChange={(event) => setQuery((prev) => ({ ...prev, q: event.target.value }))}
          />
          <Select
            value={query.status || "all"}
            onValueChange={(value) =>
              setQuery((prev) => ({
                ...prev,
                status: value === "all" ? "" : value,
                page: 1,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="available">可用</SelectItem>
              <SelectItem value="applied">已应用</SelectItem>
              <SelectItem value="archived">已归档</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              const next = { ...query, page: 1 };
              setQuery(next);
              void loadSnapshots(next);
            }}
          >
            <RefreshCw className="h-4 w-4" />
            查询
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>快照</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建人</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      暂无恢复快照
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.snapshot_id}
                      className="cursor-pointer"
                      onClick={() => setSelected(row)}
                    >
                      <TableCell>
                        <p className="font-medium text-slate-900">{row.snapshot_name}</p>
                        <p className="font-mono text-xs text-slate-500">{row.snapshot_id}</p>
                      </TableCell>
                      <TableCell>{SOURCE_LABELS[row.source]}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "available"
                              ? "secondary"
                              : row.status === "applied"
                                ? "outline"
                                : "outline"
                          }
                        >
                          {STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.created_by}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={row.status !== "available" || actingId === row.snapshot_id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void applySnapshot(row);
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            应用
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={row.status === "archived" || actingId === row.snapshot_id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void archiveSnapshot(row);
                            }}
                          >
                            <Archive className="h-3.5 w-3.5" />
                            归档
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

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-slate-900">快照详情</p>
              {!selected ? (
                <p className="text-sm text-slate-500">点击左侧快照查看详情。</p>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-medium">{selected.snapshot_name}</p>
                    <p className="font-mono text-xs text-slate-500">{selected.snapshot_id}</p>
                    <p className="text-xs text-slate-500">
                      {SOURCE_LABELS[selected.source]} · {STATUS_LABELS[selected.status]}
                    </p>
                    <p className="text-xs text-slate-500">
                      更新于 {new Date(selected.updated_at).toLocaleString("zh-CN")}
                    </p>
                    {selected.applied_at ? (
                      <p className="text-xs text-slate-500">
                        应用于 {new Date(selected.applied_at).toLocaleString("zh-CN")}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="text-xs text-slate-500">说明</p>
                    <p className="mt-1 text-slate-700">{selected.description || "无"}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="text-xs text-slate-500">关联对象</p>
                    <p className="mt-1 text-slate-700">
                      {selected.related_entity_types.join(" / ") || "无"}
                    </p>
                  </div>
                </>
              )}
              <div className="grid gap-2">
                <Button asChild variant="outline">
                  <Link href="/admin/observability/audit-logs">查看相关审计日志</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/admin/operations/recommendation-batches">查看运行批次</Link>
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const next = { ...query, page: Math.max(1, query.page - 1) };
                    setQuery(next);
                    void loadSnapshots(next);
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
                    void loadSnapshots(next);
                  }}
                  disabled={query.page * query.pageSize >= total || loading}
                >
                  下一页
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-slate-900">新建恢复快照</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>快照 ID</Label>
                  <Input
                    value={form.snapshot_id}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, snapshot_id: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>快照名称</Label>
                  <Input
                    value={form.snapshot_name}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, snapshot_name: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>来源</Label>
                  <Select
                    value={form.source}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        source: value as RecoverySnapshotRecord["source"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">人工创建</SelectItem>
                      <SelectItem value="system">系统生成</SelectItem>
                      <SelectItem value="seed">Seed 基线</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>配置快照 ID</Label>
                  <Input
                    value={form.config_snapshot_id}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        config_snapshot_id: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>创建人</Label>
                  <Input
                    value={form.created_by}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, created_by: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>状态</Label>
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        status: value as RecoverySnapshotRecord["status"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">可用</SelectItem>
                      <SelectItem value="applied">已应用</SelectItem>
                      <SelectItem value="archived">已归档</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>描述</Label>
                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
              <TokenEditor
                label="关联对象类型"
                value={form.related_entity_types}
                onChange={(related_entity_types) =>
                  setForm((prev) => ({ ...prev, related_entity_types }))
                }
                placeholder="例如 recommendation_strategy"
                suggestions={[
                  "campaign",
                  "recommendation_strategy",
                  "expression_template",
                  "global_rule",
                  "generation_job",
                ]}
              />
              <Button className="w-full" onClick={createSnapshot}>
                <Plus className="h-4 w-4" />
                创建快照
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </AdminPageFrame>
  );
}
