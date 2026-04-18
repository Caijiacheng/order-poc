"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Filter, RefreshCw } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { AuditLogEvent } from "@/lib/memory/types";

const ENTITY_LABELS: Record<AuditLogEvent["entity_type"], string> = {
  product: "商品信息",
  dealer: "门店信息",
  dealer_segment: "门店分组",
  product_pool: "商品分组",
  recommendation_strategy: "推荐方案",
  expression_template: "推荐话术",
  campaign: "活动安排",
  global_rule: "下单设置",
  generation_job: "生成任务",
  recommendation_batch: "生成批次",
  recovery_snapshot: "演示恢复",
};

const ACTION_LABELS: Record<AuditLogEvent["action"], string> = {
  create: "新增",
  update: "更新",
  delete: "删除",
  toggle: "启停",
  apply: "应用",
};

type QueryState = {
  page: number;
  pageSize: number;
  q: string;
};

const INITIAL_QUERY: QueryState = {
  page: 1,
  pageSize: 12,
  q: "",
};

export default function AuditLogsPage() {
  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [logs, setLogs] = useState<AuditLogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<AuditLogEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLogs = async (nextQuery = query) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams({
        page: String(nextQuery.page),
        pageSize: String(nextQuery.pageSize),
        sortBy: "timestamp",
        sortOrder: "desc",
      });
      if (nextQuery.q.trim()) {
        params.set("q", nextQuery.q.trim());
      }
      const data = await requestJson<ListResult<AuditLogEvent>>(
        `/api/admin/audit-logs?${params.toString()}`,
      );
      setLogs(data.items);
      setTotal(data.total);
      setSelected((prev) =>
        data.items.some((item) => item.id === prev?.id) ? prev : data.items[0] ?? null,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载变更记录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs(INITIAL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminPageFrame
      title="变更记录"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/traces" className="gap-2">
              查看执行过程
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/recovery">恢复演示数据</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]">
          <Input
            placeholder="按对象类型 / 编号 / 动作 / 摘要搜索"
            value={query.q}
            onChange={(event) => setQuery((prev) => ({ ...prev, q: event.target.value }))}
          />
          <Button
            variant="outline"
            onClick={() => {
              const next = { ...query, page: 1 };
              setQuery(next);
              void loadLogs(next);
            }}
            disabled={loading}
          >
            <Filter className="h-4 w-4" />
            查询
          </Button>
          <div className="flex items-center text-xs text-slate-500">总数 {total}</div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>摘要</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-500">
                      暂无变更记录
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow
                      key={log.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(log)}
                    >
                      <TableCell className="font-mono text-xs">
                        {new Date(log.timestamp).toLocaleString("zh-CN")}
                      </TableCell>
                      <TableCell>{ENTITY_LABELS[log.entity_type]}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{ACTION_LABELS[log.action]}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[420px] truncate">{log.summary}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">这次改了什么</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selected ? (
              <p className="text-sm text-slate-500">点击左侧日志查看对象级详情。</p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">{ENTITY_LABELS[selected.entity_type]}</p>
                  <p className="mt-1 text-xs text-slate-500">对象 ID：{selected.entity_id}</p>
                  <p className="text-xs text-slate-500">
                    操作：{ACTION_LABELS[selected.action]} ·{" "}
                    {new Date(selected.timestamp).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-500">变更摘要</p>
                  <p className="mt-1 text-sm text-slate-700">{selected.summary}</p>
                </div>
              </>
            )}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = { ...query, page: Math.max(1, query.page - 1) };
                  setQuery(next);
                  void loadLogs(next);
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
                  void loadLogs(next);
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
