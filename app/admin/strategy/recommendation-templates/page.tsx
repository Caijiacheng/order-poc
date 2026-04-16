"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  AdminClientError,
  formatFieldErrors,
  requestJson,
} from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { DealerSuggestionTemplateEntity, SuggestionScene } from "@/lib/memory/types";

type TemplateForm = {
  template_id: string;
  customer_id: string;
  template_name: string;
  scene: SuggestionScene;
  reference_items: string;
  business_notes: string;
  style_hint: string;
  priority: number;
  enabled: boolean;
};

const EMPTY_REFERENCE_ITEMS = JSON.stringify(
  [
    {
      sku_id: "cb_weijixian_500",
      qty: 12,
      reason: "示例原因",
      reason_tags: ["常购品"],
      sort_order: 1,
    },
    {
      sku_id: "cb_oyster_700",
      qty: 8,
      reason: "示例原因",
      reason_tags: ["搭配品"],
      sort_order: 2,
    },
  ],
  null,
  2,
);

const EMPTY_FORM: TemplateForm = {
  template_id: "",
  customer_id: "",
  template_name: "",
  scene: "daily_recommendation",
  reference_items: EMPTY_REFERENCE_ITEMS,
  business_notes: "",
  style_hint: "",
  priority: 1,
  enabled: true,
};

const SCENE_LABELS: Record<SuggestionScene, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  threshold_topup: "门槛补差",
  box_pair_optimization: "箱规与搭配优化",
};

export default function SuggestionTemplatesPage() {
  const [items, setItems] = useState<DealerSuggestionTemplateEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "priority",
    sortOrder: "asc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
    if (query.q) {
      params.set("q", query.q);
    }
    if (query.status) {
      params.set("status", query.status);
    }
    params.set("sortBy", query.sortBy);
    params.set("sortOrder", query.sortOrder);
    return params.toString();
  }, [query]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<DealerSuggestionTemplateEntity>>(
        `/api/admin/suggestion-templates?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载模板失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const pickForEdit = (item: DealerSuggestionTemplateEntity) => {
    setEditingId(item.template_id);
    setForm({
      template_id: item.template_id,
      customer_id: item.customer_id,
      template_name: item.template_name,
      scene: item.scene,
      reference_items: JSON.stringify(item.reference_items, null, 2),
      business_notes: item.business_notes,
      style_hint: item.style_hint,
      priority: item.priority,
      enabled: item.enabled,
    });
  };

  const payloadFromForm = () => ({
    ...form,
    reference_items: form.reference_items,
  });

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSuggestionTemplateEntity>("/api/admin/suggestion-templates", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("模板创建成功");
      resetForm();
      await loadTemplates();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("模板创建失败");
    }
  };

  const submitUpdate = async () => {
    if (!editingId) {
      return;
    }
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSuggestionTemplateEntity>(
        `/api/admin/suggestion-templates/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payloadFromForm()),
        },
      );
      setSuccessMessage("模板更新成功");
      resetForm();
      await loadTemplates();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("模板更新失败");
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSuggestionTemplateEntity>(
        `/api/admin/suggestion-templates/${id}`,
        { method: "DELETE" },
      );
      setSuccessMessage("模板已停用");
      if (editingId === id) {
        resetForm();
      }
      await loadTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="推荐模板"
      description="维护推荐模板（内存态），支持按场景配置参考条目并进行软停用。"
      action={
        <Button className="rounded-full" onClick={resetForm}>
          <Plus className="h-4 w-4" />
          新建模板
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索模板 ID/名称/场景"
            value={query.q}
            onChange={(event) =>
              setQuery((prev) => ({ ...prev, q: event.target.value, page: 1 }))
            }
          />
          <Select
            value={query.status || "__all__"}
            onValueChange={(value) =>
              setQuery((prev) => ({
                ...prev,
                status: value === "__all__" ? "" : value,
                page: 1,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部状态</SelectItem>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="inactive">停用</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.sortBy}
            onValueChange={(value) => setQuery((prev) => ({ ...prev, sortBy: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">优先级</SelectItem>
              <SelectItem value="template_name">模板名称</SelectItem>
              <SelectItem value="updated_at">更新时间</SelectItem>
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
              <SelectItem value="asc">升序</SelectItem>
              <SelectItem value="desc">降序</SelectItem>
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
          <Button variant="outline" onClick={loadTemplates} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>模板</TableHead>
                  <TableHead>场景</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.template_id}>
                    <TableCell className="font-mono text-xs">{item.template_id}</TableCell>
                    <TableCell>
                      <p>{item.template_name}</p>
                      <p className="text-xs text-slate-500">{item.customer_id}</p>
                    </TableCell>
                    <TableCell>{SCENE_LABELS[item.scene]}</TableCell>
                    <TableCell>
                      <Badge variant={item.enabled ? "secondary" : "outline"}>
                        {item.enabled ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => pickForEdit(item)}>
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => softDelete(item.template_id)}
                          disabled={!item.enabled}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          停用
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      无数据
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {editingId ? `编辑模板: ${editingId}` : "创建模板"}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>模板编码</Label>
                <Input
                  value={form.template_id}
                  disabled={Boolean(editingId)}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, template_id: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>经销商编码</Label>
                <Input
                  value={form.customer_id}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customer_id: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>模板名称</Label>
                <Input
                  value={form.template_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, template_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>适用场景</Label>
                <Select
                  value={form.scene}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, scene: value as SuggestionScene }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily_recommendation">日常补货</SelectItem>
                    <SelectItem value="weekly_focus">周活动备货</SelectItem>
                    <SelectItem value="threshold_topup">门槛补差</SelectItem>
                    <SelectItem value="box_pair_optimization">
                      箱规与搭配优化
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>优先级</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: Number(event.target.value || "1"),
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>业务说明</Label>
              <Textarea
                value={form.business_notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, business_notes: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>表达风格提示</Label>
              <Textarea
                value={form.style_hint}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, style_hint: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>参考商品清单（JSON 数组）</Label>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                value={form.reference_items}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, reference_items: event.target.value }))
                }
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              启用模板
            </label>

            <div className="flex gap-2">
              {editingId ? (
                <Button onClick={submitUpdate}>
                  <Save className="h-4 w-4" />
                  保存更新
                </Button>
              ) : (
                <Button onClick={submitCreate}>
                  <Plus className="h-4 w-4" />
                  创建
                </Button>
              )}
              <Button variant="outline" onClick={resetForm}>
                重置
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              总数 {total}，当前第 {query.page} 页。
            </p>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
