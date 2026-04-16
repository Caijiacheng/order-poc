"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminClientError,
  formatFieldErrors,
  fromEditableText,
  requestJson,
  toEditableText,
} from "@/lib/admin/client";
import type { PromptConfigEntity } from "@/lib/memory/types";

type PromptForm = {
  global_style: {
    tone: string;
    avoid: string;
    reason_limit: number;
  };
  recommendation_prompt: {
    system_role: string;
    instruction: string;
  };
  cart_opt_prompt: {
    system_role: string;
    instruction: string;
  };
  explain_prompt: {
    system_role: string;
    instruction: string;
  };
};

const EMPTY_PROMPTS: PromptForm = {
  global_style: {
    tone: "",
    avoid: "",
    reason_limit: 3,
  },
  recommendation_prompt: {
    system_role: "",
    instruction: "",
  },
  cart_opt_prompt: {
    system_role: "",
    instruction: "",
  },
  explain_prompt: {
    system_role: "",
    instruction: "",
  },
};

function toForm(config: PromptConfigEntity): PromptForm {
  return {
    global_style: {
      tone: config.global_style.tone,
      avoid: toEditableText(config.global_style.avoid),
      reason_limit: config.global_style.reason_limit,
    },
    recommendation_prompt: { ...config.recommendation_prompt },
    cart_opt_prompt: { ...config.cart_opt_prompt },
    explain_prompt: { ...config.explain_prompt },
  };
}

function toPayload(form: PromptForm): PromptConfigEntity {
  return {
    global_style: {
      tone: form.global_style.tone,
      avoid: fromEditableText(form.global_style.avoid),
      reason_limit: form.global_style.reason_limit,
    },
    recommendation_prompt: { ...form.recommendation_prompt },
    cart_opt_prompt: { ...form.cart_opt_prompt },
    explain_prompt: { ...form.explain_prompt },
  };
}

export default function PromptsPage() {
  const [form, setForm] = useState<PromptForm>(EMPTY_PROMPTS);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadPrompts = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<PromptConfigEntity>("/api/admin/prompts");
      setForm(toForm(data));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, []);

  const savePrompts = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      const data = await requestJson<PromptConfigEntity>("/api/admin/prompts", {
        method: "PATCH",
        body: JSON.stringify(toPayload(form)),
      });
      setForm(toForm(data));
      setSuccessMessage("AI 表达配置保存成功");
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "保存配置失败");
    }
  };

  return (
    <AdminPageFrame
      title="AI 表达配置"
      description="统一维护推荐生成、凑单优化与解释文案的表达配置（单实例）。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadPrompts} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button className="rounded-full" onClick={savePrompts}>
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
            <CardTitle className="text-lg">全局风格</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>表达语气</Label>
              <Input
                value={form.global_style.tone}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    global_style: {
                      ...prev.global_style,
                      tone: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>禁用词（逗号分隔）</Label>
              <Input
                value={form.global_style.avoid}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    global_style: {
                      ...prev.global_style,
                      avoid: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>单条理由上限</Label>
              <Input
                type="number"
                value={form.global_style.reason_limit}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    global_style: {
                      ...prev.global_style,
                      reason_limit: Number(event.target.value || "0"),
                    },
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">场景表达模板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>推荐生成 · 系统角色</Label>
              <Textarea
                value={form.recommendation_prompt.system_role}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    recommendation_prompt: {
                      ...prev.recommendation_prompt,
                      system_role: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>推荐生成 · 指令模板</Label>
              <Textarea
                value={form.recommendation_prompt.instruction}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    recommendation_prompt: {
                      ...prev.recommendation_prompt,
                      instruction: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>凑单优化 · 系统角色</Label>
              <Textarea
                value={form.cart_opt_prompt.system_role}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    cart_opt_prompt: {
                      ...prev.cart_opt_prompt,
                      system_role: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>凑单优化 · 指令模板</Label>
              <Textarea
                value={form.cart_opt_prompt.instruction}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    cart_opt_prompt: {
                      ...prev.cart_opt_prompt,
                      instruction: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>解释说明 · 系统角色</Label>
              <Textarea
                value={form.explain_prompt.system_role}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    explain_prompt: {
                      ...prev.explain_prompt,
                      system_role: event.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>解释说明 · 指令模板</Label>
              <Textarea
                value={form.explain_prompt.instruction}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    explain_prompt: {
                      ...prev.explain_prompt,
                      instruction: event.target.value,
                    },
                  }))
                }
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
