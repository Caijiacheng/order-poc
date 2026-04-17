"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AdminClientError,
  formatFieldErrors,
  requestJson,
} from "@/lib/admin/client";
import type { GlobalRuleEntity } from "@/lib/memory/types";

type GlobalRuleForm = Omit<GlobalRuleEntity, "created_at" | "updated_at">;

const EMPTY_FORM: GlobalRuleForm = {
  global_rule_id: "global_rules_default",
  rule_version: "manual",
  replenishment_days_threshold: 7,
  cart_gap_trigger_amount: 0,
  threshold_amount: 1200,
  prefer_frequent_items: true,
  prefer_pair_items: true,
  box_adjust_if_close: true,
  box_adjust_distance_limit: 100,
  allow_new_product_recommendation: false,
  status: "active",
};

export default function GlobalRulesPage() {
  const [form, setForm] = useState<GlobalRuleForm>(EMPTY_FORM);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRules = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<GlobalRuleEntity>("/api/admin/global-rules");
      setForm({
        global_rule_id: data.global_rule_id,
        rule_version: data.rule_version,
        replenishment_days_threshold: data.replenishment_days_threshold,
        cart_gap_trigger_amount: data.cart_gap_trigger_amount,
        threshold_amount: data.threshold_amount,
        prefer_frequent_items: data.prefer_frequent_items,
        prefer_pair_items: data.prefer_pair_items,
        box_adjust_if_close: data.box_adjust_if_close,
        box_adjust_distance_limit: data.box_adjust_distance_limit,
        allow_new_product_recommendation: data.allow_new_product_recommendation,
        status: data.status,
      });
      setUpdatedAt(data.updated_at);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载全局规则失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
  }, []);

  const saveRules = async () => {
    setSaving(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const data = await requestJson<GlobalRuleEntity>("/api/admin/global-rules", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setForm({
        global_rule_id: data.global_rule_id,
        rule_version: data.rule_version,
        replenishment_days_threshold: data.replenishment_days_threshold,
        cart_gap_trigger_amount: data.cart_gap_trigger_amount,
        threshold_amount: data.threshold_amount,
        prefer_frequent_items: data.prefer_frequent_items,
        prefer_pair_items: data.prefer_pair_items,
        box_adjust_if_close: data.box_adjust_if_close,
        box_adjust_distance_limit: data.box_adjust_distance_limit,
        allow_new_product_recommendation: data.allow_new_product_recommendation,
        status: data.status,
      });
      setUpdatedAt(data.updated_at);
      setSuccessMessage("全局规则已更新");
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage(error instanceof Error ? error.message : "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPageFrame
      title="全局规则"
      description="统一维护门槛、箱规和推荐偏好，保证策略执行口径一致。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRules} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button className="rounded-full" onClick={saveRules} disabled={saving}>
            <Save className="h-4 w-4" />
            保存规则
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">规则参数</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>补货触发天数阈值</Label>
              <Input
                type="number"
                value={form.replenishment_days_threshold}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    replenishment_days_threshold: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>门槛补差触发金额</Label>
              <Input
                type="number"
                value={form.cart_gap_trigger_amount}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    cart_gap_trigger_amount: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>下单门槛金额</Label>
              <Input
                type="number"
                value={form.threshold_amount}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    threshold_amount: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>箱规修正距离阈值</Label>
              <Input
                type="number"
                value={form.box_adjust_distance_limit}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    box_adjust_distance_limit: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.prefer_frequent_items}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    prefer_frequent_items: event.target.checked,
                  }))
                }
              />
              优先常购商品
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.prefer_pair_items}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    prefer_pair_items: event.target.checked,
                  }))
                }
              />
              优先搭配商品
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.box_adjust_if_close}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    box_adjust_if_close: event.target.checked,
                  }))
                }
              />
              允许近门槛箱规修正
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.allow_new_product_recommendation}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    allow_new_product_recommendation: event.target.checked,
                  }))
                }
              />
              允许新品推荐
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">规则版本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">规则 ID</p>
              <p className="font-mono text-xs text-slate-800">{form.global_rule_id}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">当前版本</p>
              <p className="font-medium text-slate-800">{form.rule_version}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">状态</p>
              <p className="font-medium text-slate-800">
                {form.status === "active" ? "启用中" : "已停用"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-slate-500">最后更新时间</p>
              <p className="font-mono text-xs text-slate-800">
                {updatedAt ? new Date(updatedAt).toLocaleString("zh-CN") : "-"}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
