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
  cart_gap_trigger_amount: 30,
  threshold_amount: 1000,
  cart_target_amount: 1000,
  prefer_frequent_items: true,
  prefer_pair_items: true,
  box_adjust_if_close: true,
  box_adjust_distance_limit: 2,
  allow_new_product_recommendation: false,
  status: "active",
};

function toForm(data: GlobalRuleEntity): GlobalRuleForm {
  return {
    global_rule_id: data.global_rule_id,
    rule_version: data.rule_version,
    replenishment_days_threshold: data.replenishment_days_threshold,
    cart_gap_trigger_amount: data.cart_gap_trigger_amount,
    threshold_amount: data.threshold_amount,
    cart_target_amount: data.cart_target_amount,
    prefer_frequent_items: data.prefer_frequent_items,
    prefer_pair_items: data.prefer_pair_items,
    box_adjust_if_close: data.box_adjust_if_close,
    box_adjust_distance_limit: data.box_adjust_distance_limit,
    allow_new_product_recommendation: data.allow_new_product_recommendation,
    status: data.status,
  };
}

function formatCurrency(amount: number) {
  return `¥${amount.toLocaleString("zh-CN")}`;
}

function getEnabledRecommendationModes(form: GlobalRuleForm) {
  const modes = [
    `凑够起订额：距目标不超过 ${formatCurrency(form.cart_gap_trigger_amount)} 时提醒补货`,
  ];

  if (form.box_adjust_if_close) {
    modes.push(
      `补齐整箱：离整箱只差 ${form.box_adjust_distance_limit} 箱以内时提醒补齐`,
    );
  }

  if (form.prefer_pair_items) {
    modes.push(
      form.allow_new_product_recommendation
        ? "搭配补货：允许带上关联新品"
        : "搭配补货：只带常规搭配商品",
    );
  }

  return modes;
}

export default function GlobalRulesPage() {
  const [form, setForm] = useState<GlobalRuleForm>(EMPTY_FORM);
  const [updatedAt, setUpdatedAt] = useState("");
  const [simulationAmount, setSimulationAmount] = useState(920);
  const [simulationBoxGap, setSimulationBoxGap] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRules = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<GlobalRuleEntity>("/api/admin/global-rules");
      setForm(toForm(data));
      setUpdatedAt(data.updated_at);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载下单设置失败");
    } finally {
      setLoading(false);
    }
  };

  const thresholdGap = Math.max(0, form.cart_target_amount - simulationAmount);
  const willShowThresholdBar =
    thresholdGap > 0 && thresholdGap <= form.cart_gap_trigger_amount;
  const willShowBoxBar = form.box_adjust_if_close && simulationBoxGap > 0 && simulationBoxGap <= form.box_adjust_distance_limit;
  const willShowPairBar = form.prefer_pair_items;

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
      setForm(toForm(data));
      setUpdatedAt(data.updated_at);
      setSuccessMessage("下单和凑单规则已更新");
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
      title="设置凑单规则"
      description="把起订额、整箱补货和搭配补货三类规则统一配清楚，并直接模拟前台凑单提示。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRules} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button className="rounded-full" onClick={saveRules} disabled={saving}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. 凑够起订额</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <p className="md:col-span-2 text-sm leading-6 text-slate-600">
                当门店这次下单金额还差一点点时，系统会从门店常带商品里挑更合适的货，提醒你补到目标金额。
              </p>
              <div className="space-y-2">
                <Label>最低起订金额</Label>
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
                <Label>建议补到金额</Label>
                <Input
                  type="number"
                  value={form.cart_target_amount}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      cart_target_amount: Number(event.target.value || "0"),
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>差额多少以内才提示补货</Label>
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
                <p className="text-xs text-slate-500">
                  只有当门店离建议补到金额不超过这个差额时，前台才出现“凑单推荐”。
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2">
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
                凑单时优先门店常带商品
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2. 补齐整箱</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <p className="md:col-span-2 text-sm leading-6 text-slate-600">
                门店已经选了商品，但箱数离整箱只差一点时，系统会提醒补齐，避免零散下单。
              </p>
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2">
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
                启用补齐整箱推荐
              </label>
              <div className="space-y-2">
                <Label>离整箱最多差几箱时提醒</Label>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">3. 搭配补货</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <p className="md:col-span-2 text-sm leading-6 text-slate-600">
                当门店已经选了某些核心商品时，可以补上更常见的搭配商品，帮经销商一次配齐。
              </p>
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
                启用搭配补货推荐
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
                搭配补货时允许带上新品
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">当前生效口径</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">起订要求</p>
                <p className="font-medium text-slate-800">
                  最低起订 {formatCurrency(form.threshold_amount)}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  建议补到 {formatCurrency(form.cart_target_amount)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-slate-500">会触发的凑单推荐</p>
                <div className="mt-2 space-y-2">
                  {getEnabledRecommendationModes(form).map((mode) => (
                    <div
                      key={mode}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800"
                    >
                      {mode}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">凑单模拟</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-slate-600">
                先设一个假想购物车，看看前台会不会出现“凑单推荐”，以及会出现哪一种。
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>假设当前已选金额</Label>
                  <Input
                    type="number"
                    value={simulationAmount}
                    onChange={(event) => setSimulationAmount(Number(event.target.value || "0"))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>假设离整箱还差几箱</Label>
                  <Input
                    type="number"
                    value={simulationBoxGap}
                    onChange={(event) =>
                      setSimulationBoxGap(Number(event.target.value || "0"))
                    }
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-500">模拟购物车摘要</p>
                  <p className="mt-1 font-medium text-slate-900">
                    {formatCurrency(simulationAmount)} / {formatCurrency(form.threshold_amount)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {simulationAmount >= form.threshold_amount
                      ? "这单已经达到最低起订。"
                      : `离最低起订还差 ${formatCurrency(
                          Math.max(0, form.threshold_amount - simulationAmount),
                        )}。`}
                  </p>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">凑够起订额</p>
                      <span className="text-xs text-slate-500">
                        {willShowThresholdBar ? "会出现" : "不会出现"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {willShowThresholdBar
                        ? `当前还差 ${formatCurrency(thresholdGap)}，前台会提醒补到建议金额。`
                        : "当前金额离建议补到金额还太远，这条推荐不会出现。"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">补齐整箱</p>
                      <span className="text-xs text-slate-500">
                        {willShowBoxBar ? "会出现" : "不会出现"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {willShowBoxBar
                        ? `当前离整箱还差 ${simulationBoxGap} 箱，前台会提醒补齐。`
                        : "当前箱数差距超过提醒阈值，这条推荐不会出现。"}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">搭配补货</p>
                      <span className="text-xs text-slate-500">
                        {willShowPairBar ? "会出现" : "不会出现"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {willShowPairBar
                        ? form.allow_new_product_recommendation
                          ? "前台会出现搭配推荐，并允许把新品一起带上。"
                          : "前台会出现搭配推荐，但只会推荐常规搭配商品。"
                        : "当前已关闭搭配补货推荐。"}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                最后更新时间：{updatedAt ? new Date(updatedAt).toLocaleString("zh-CN") : "-"}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </AdminPageFrame>
  );
}
