"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDrawer } from "@/components/admin/admin-drawer";
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
import type { ExpressionTemplateEntity } from "@/lib/memory/types";

type TemplateForm = {
  expression_template_id: string;
  expression_template_name: string;
  template_type: ExpressionTemplateEntity["template_type"];
  scene: ExpressionTemplateEntity["scene"];
  tone: string;
  avoid: string[];
  reason_limit: number;
  system_role: string;
  instruction: string;
  style_hint: string;
  status: "active" | "inactive";
};

const EMPTY_FORM: TemplateForm = {
  expression_template_id: "",
  expression_template_name: "",
  template_type: "bundle_explanation",
  scene: "all",
  tone: "",
  avoid: [],
  reason_limit: 3,
  system_role: "",
  instruction: "",
  style_hint: "",
  status: "active",
};

const TYPE_LABELS: Record<ExpressionTemplateEntity["template_type"], string> = {
  bundle_explanation: "组货说明",
  topup_explanation: "凑单说明",
};

const SCENE_LABELS: Record<ExpressionTemplateEntity["scene"], string> = {
  all: "全场景",
  bundle: "组货场景",
  topup: "凑单场景",
};

export default function ExpressionTemplatesPage() {
  const [items, setItems] = useState<ExpressionTemplateEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "expression_template_name",
    sortOrder: "asc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<ExpressionTemplateEntity | null>(
    null,
  );
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
    params.set("sortBy", query.sortBy);
    params.set("sortOrder", query.sortOrder);
    if (query.q) params.set("q", query.q);
    if (query.status) params.set("status", query.status);
    return params.toString();
  }, [query]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<ExpressionTemplateEntity>>(
        `/api/admin/expression-templates?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载推荐话术失败");
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

  const pickForEdit = (item: ExpressionTemplateEntity) => {
    setEditingId(item.expression_template_id);
    setForm({
      expression_template_id: item.expression_template_id,
      expression_template_name: item.expression_template_name,
      template_type: item.template_type,
      scene: item.scene,
      tone: item.tone,
      avoid: item.avoid,
      reason_limit: item.reason_limit,
      system_role: item.system_role,
      instruction: item.instruction,
      style_hint: item.style_hint,
      status: item.status,
    });
    setDrawerOpen(true);
  };

  const payloadFromForm = () => ({ ...form });

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ExpressionTemplateEntity>("/api/admin/expression-templates", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("推荐话术创建成功");
      setDrawerOpen(false);
      resetForm();
      await loadTemplates();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐话术创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ExpressionTemplateEntity>(
        `/api/admin/expression-templates/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payloadFromForm()),
        },
      );
      setSuccessMessage("推荐话术更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadTemplates();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐话术更新失败");
      }
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ExpressionTemplateEntity>(`/api/admin/expression-templates/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("推荐话术已停用");
      if (editingId === id) {
        resetForm();
      }
      await loadTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    } finally {
      setPendingDisable(null);
    }
  };

  return (
    <AdminPageFrame
      title="设置推荐话术"
      description="维护推荐说明和补货依据的话术内容。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadTemplates} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button
            className="rounded-full"
            onClick={() => {
              resetForm();
              setDrawerOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新建话术
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索话术编号/名称/类型"
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
              <SelectValue />
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
              <SelectItem value="expression_template_name">话术名称</SelectItem>
              <SelectItem value="template_type">话术类型</SelectItem>
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
          <div className="flex items-center text-xs text-slate-500">总数 {total}</div>
        </CardContent>
      </Card>

      <section>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>话术</TableHead>
                  <TableHead>类型/场景</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.expression_template_id}>
                    <TableCell className="font-mono text-xs">{item.expression_template_id}</TableCell>
                    <TableCell>
                      <p>{item.expression_template_name}</p>
                      <p className="text-xs text-slate-500">{item.style_hint || "-"}</p>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {TYPE_LABELS[item.template_type]} · {SCENE_LABELS[item.scene]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "secondary" : "outline"}>
                        {item.status === "active" ? "启用" : "停用"}
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
                          onClick={() => setPendingDisable(item)}
                          disabled={item.status === "inactive"}
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
      </section>

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            resetForm();
          }
        }}
        title={editingId ? `编辑话术: ${editingId}` : "创建话术"}
        description="维护推荐说明生成时要用到的话术字段。"
      >
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>话术编码</Label>
              <Input
                value={form.expression_template_id}
                disabled={Boolean(editingId)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    expression_template_id: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>话术名称</Label>
              <Input
                value={form.expression_template_name}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    expression_template_name: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>话术类型</Label>
              <Select
                value={form.template_type}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    template_type: value as ExpressionTemplateEntity["template_type"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bundle_explanation">组货说明</SelectItem>
                  <SelectItem value="topup_explanation">凑单说明</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>适用场景</Label>
              <Select
                value={form.scene}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    scene: value as ExpressionTemplateEntity["scene"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全场景</SelectItem>
                  <SelectItem value="bundle">组货场景</SelectItem>
                  <SelectItem value="topup">凑单场景</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>语气</Label>
              <Input
                value={form.tone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tone: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>理由数量上限</Label>
              <Input
                type="number"
                value={form.reason_limit}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    reason_limit: Number(event.target.value || "1"),
                  }))
                }
              />
            </div>
          </div>
          <TokenEditor
            label="禁用词"
            value={form.avoid}
            onChange={(avoid) => setForm((prev) => ({ ...prev, avoid }))}
            placeholder="输入禁用词"
          />
          <div className="space-y-1">
            <Label>系统角色</Label>
            <Textarea
              value={form.system_role}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, system_role: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>话术指令</Label>
            <Textarea
              value={form.instruction}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, instruction: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>风格提示</Label>
            <Textarea
              value={form.style_hint}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, style_hint: event.target.value }))
              }
            />
          </div>

          <Select
            value={form.status}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, status: value as "active" | "inactive" }))
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">启用</SelectItem>
              <SelectItem value="inactive">停用</SelectItem>
            </SelectContent>
          </Select>

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
        </div>
      </AdminDrawer>

      <AdminConfirmDialog
        open={Boolean(pendingDisable)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDisable(null);
          }
        }}
        title="确认停用推荐话术"
        description={`停用后这套话术将不再参与推荐说明生成。${
          pendingDisable ? `\n话术：${pendingDisable.expression_template_name}` : ""
        }`}
        confirmLabel="确认停用"
        onConfirm={async () => {
          if (!pendingDisable) {
            return;
          }
          await softDelete(pendingDisable.expression_template_id);
        }}
      />
    </AdminPageFrame>
  );
}
