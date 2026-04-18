"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { RecoverySnapshotRecord } from "@/lib/memory/types";

type ResetResponse = {
  snapshot: RecoverySnapshotRecord | null;
  summary: string;
};

const DEFAULT_ENTITY_TYPES = [
  "products",
  "dealers",
  "dealer_segments",
  "product_pools",
  "recommendation_strategies",
  "expression_templates",
  "global_rules",
];

export default function RecoveryPage() {
  const [baseline, setBaseline] = useState<RecoverySnapshotRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadBaseline = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<RecoverySnapshotRecord>>(
        "/api/admin/recovery?page=1&pageSize=20&sortBy=created_at&sortOrder=desc",
      );
      const seedSnapshot =
        data.items.find((item) => item.snapshot_id === "snapshot_seed_default") ??
        data.items[0] ??
        null;
      setBaseline(seedSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载演示基线失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBaseline();
  }, []);

  const resetDemo = async () => {
    setResetting(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const data = await requestJson<ResetResponse>("/api/admin/recovery/reset", {
        method: "POST",
      });
      setSuccessMessage(data.summary);
      setBaseline(data.snapshot);
      await loadBaseline();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "恢复演示数据失败");
    } finally {
      setResetting(false);
      setConfirmOpen(false);
    }
  };

  const relatedEntityTypes = baseline?.related_entity_types.length
    ? baseline.related_entity_types
    : DEFAULT_ENTITY_TYPES;

  return (
    <AdminPageFrame
      title="恢复演示数据"
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadBaseline()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/observability/audit-logs">查看变更记录</Link>
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">恢复后会发生什么</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-700">
              <p>恢复后会回到应用启动时的演示基线，运行期新建、修改和停用的数据都会被清空。</p>
              <p>这项操作只影响当前内存数据，不会写入数据库；刷新服务后也会回到同一份种子数据。</p>
              <Button
                className="rounded-full"
                onClick={() => setConfirmOpen(true)}
                disabled={resetting || loading}
              >
                {resetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                恢复到演示初始数据
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">这次会恢复什么</CardTitle>
            </CardHeader>
            <CardContent className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {relatedEntityTypes.join(" / ")}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">当前演示基线</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">基线名称</p>
                <p className="font-medium text-slate-900">
                  {loading ? "加载中..." : baseline?.snapshot_name ?? "未找到"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">快照 ID</p>
                <p className="font-mono text-xs text-slate-800">
                  {baseline?.snapshot_id ?? "snapshot_seed_default"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">最近更新时间</p>
                <p className="font-mono text-xs text-slate-800">
                  {baseline?.updated_at
                    ? new Date(baseline.updated_at).toLocaleString("zh-CN")
                    : "-"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">最近恢复时间</p>
                <p className="font-mono text-xs text-slate-800">
                  {baseline?.applied_at
                    ? new Date(baseline.applied_at).toLocaleString("zh-CN")
                    : "尚未手动恢复"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">继续查看</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button asChild variant="outline">
                <Link href="/admin/operations/recommendation-batches">查看生成批次</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/analytics/recommendation-records">查看门店建议</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <AdminConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="恢复演示初始数据"
        description="确认后会清空当前运行期改动，并恢复到应用启动时的演示基线。"
        confirmLabel="确认恢复"
        onConfirm={() => void resetDemo()}
      />
    </AdminPageFrame>
  );
}
