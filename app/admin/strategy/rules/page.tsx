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
import type { RuleConfigEntity } from "@/lib/memory/types";

const EMPTY_RULES: RuleConfigEntity = {
  replenishment_days_threshold: 0,
  cart_gap_trigger_amount: 0,
  threshold_amount: 0,
  prefer_frequent_items: false,
  prefer_pair_items: false,
  box_adjust_if_close: false,
  box_adjust_distance_limit: 0,
  allow_new_product_recommendation: false,
};

export default function RulesPage() {
  const [rules, setRules] = useState<RuleConfigEntity>(EMPTY_RULES);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadRules = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<RuleConfigEntity>("/api/admin/rules");
      setRules(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载规则失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const saveRules = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const data = await requestJson<RuleConfigEntity>("/api/admin/rules", {
        method: "PATCH",
        body: JSON.stringify(rules),
      });
      setRules(data);
      setSuccessMessage("规则保存成功");
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "保存规则失败");
    }
  };

  return (
    <AdminPageFrame
      title="推荐规则"
      description="维护推荐与凑单规则（单实例），变更后立即作用于当前内存态运行。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadRules} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button className="rounded-full" onClick={saveRules}>
            <Save className="h-4 w-4" />
            保存配置
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">补货与门槛规则</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>补货触发天数阈值</Label>
              <Input
                type="number"
                value={rules.replenishment_days_threshold}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    replenishment_days_threshold: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>凑单触发差额（元）</Label>
              <Input
                type="number"
                value={rules.cart_gap_trigger_amount}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    cart_gap_trigger_amount: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>订单目标门槛（元）</Label>
              <Input
                type="number"
                value={rules.threshold_amount}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    threshold_amount: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <p className="text-xs text-slate-500">
              以上数值用于确定经销商是否需要补货、是否触发凑单优化。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">偏好与箱规规则</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.prefer_frequent_items}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    prefer_frequent_items: event.target.checked,
                  }))
                }
              />
              优先推荐常购商品
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.prefer_pair_items}
                onChange={(event) =>
                  setRules((prev) => ({ ...prev, prefer_pair_items: event.target.checked }))
                }
              />
              优先推荐搭配商品
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.box_adjust_if_close}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    box_adjust_if_close: event.target.checked,
                  }))
                }
              />
              接近整箱时自动箱规调整
            </label>
            <div className="space-y-2">
              <Label>箱规调整距离上限</Label>
              <Input
                type="number"
                value={rules.box_adjust_distance_limit}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    box_adjust_distance_limit: Number(event.target.value || "0"),
                  }))
                }
              />
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={rules.allow_new_product_recommendation}
                onChange={(event) =>
                  setRules((prev) => ({
                    ...prev,
                    allow_new_product_recommendation: event.target.checked,
                  }))
                }
              />
              允许推荐新品
            </label>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
