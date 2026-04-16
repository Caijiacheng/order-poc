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
import {
  AdminClientError,
  formatFieldErrors,
  fromEditableText,
  requestJson,
  toEditableText,
} from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { CampaignEntity } from "@/lib/memory/types";

type CampaignForm = {
  campaign_id: string;
  week_id: string;
  campaign_name: string;
  weekly_focus_items: string;
  promo_threshold: number;
  promo_type: string;
  activity_notes: string;
  target_customer_types: string;
  status: "active" | "inactive";
};

const EMPTY_FORM: CampaignForm = {
  campaign_id: "",
  week_id: "",
  campaign_name: "",
  weekly_focus_items: "",
  promo_threshold: 0,
  promo_type: "",
  activity_notes: "",
  target_customer_types: "",
  status: "active",
};

export default function CampaignsPage() {
  const [items, setItems] = useState<CampaignEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "week_id",
    sortOrder: "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
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

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<CampaignEntity>>(
        `/api/admin/campaigns?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载活动失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const pickForEdit = (item: CampaignEntity) => {
    setEditingId(item.campaign_id);
    setForm({
      campaign_id: item.campaign_id,
      week_id: item.week_id,
      campaign_name: item.campaign_name,
      weekly_focus_items: toEditableText(item.weekly_focus_items),
      promo_threshold: item.promo_threshold,
      promo_type: item.promo_type,
      activity_notes: toEditableText(item.activity_notes),
      target_customer_types: toEditableText(item.target_customer_types),
      status: item.status,
    });
  };

  const payloadFromForm = () => ({
    ...form,
    weekly_focus_items: fromEditableText(form.weekly_focus_items),
    activity_notes: fromEditableText(form.activity_notes),
    target_customer_types: fromEditableText(form.target_customer_types),
  });

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<CampaignEntity>("/api/admin/campaigns", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("活动创建成功");
      resetForm();
      await loadCampaigns();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("活动创建失败");
    }
  };

  const submitUpdate = async () => {
    if (!editingId) {
      return;
    }
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<CampaignEntity>(`/api/admin/campaigns/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("活动更新成功");
      resetForm();
      await loadCampaigns();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("活动更新失败");
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<CampaignEntity>(`/api/admin/campaigns/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("活动已停用");
      if (editingId === id) {
        resetForm();
      }
      await loadCampaigns();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="活动策略"
      description="维护活动策略（内存态），支持按周配置活动档期并进行软停用。"
      action={
        <Button className="rounded-full" onClick={resetForm}>
          <Plus className="h-4 w-4" />
          新建活动
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索活动 ID/名称"
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
              <SelectItem value="week_id">活动周次</SelectItem>
              <SelectItem value="campaign_name">活动名称</SelectItem>
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
          <Button variant="outline" onClick={loadCampaigns} disabled={loading}>
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
                  <TableHead>活动</TableHead>
                  <TableHead>活动周次</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.campaign_id}>
                    <TableCell className="font-mono text-xs">{item.campaign_id}</TableCell>
                    <TableCell>{item.campaign_name}</TableCell>
                    <TableCell>{item.week_id}</TableCell>
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
                          onClick={() => softDelete(item.campaign_id)}
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

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {editingId ? `编辑活动: ${editingId}` : "创建活动"}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>活动编码</Label>
                <Input
                  value={form.campaign_id}
                  disabled={Boolean(editingId)}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, campaign_id: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>活动周次</Label>
                <Input
                  value={form.week_id}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, week_id: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>活动名称</Label>
                <Input
                  value={form.campaign_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, campaign_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>促销门槛金额</Label>
                <Input
                  type="number"
                  value={form.promo_threshold}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      promo_threshold: Number(event.target.value || "0"),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>促销类型</Label>
                <Input
                  value={form.promo_type}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, promo_type: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>周活动重点 SKU（逗号分隔）</Label>
                <Input
                  value={form.weekly_focus_items}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, weekly_focus_items: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>活动说明（逗号分隔）</Label>
                <Input
                  value={form.activity_notes}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, activity_notes: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>目标客户类型（逗号分隔）</Label>
                <Input
                  value={form.target_customer_types}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      target_customer_types: event.target.value,
                    }))
                  }
                />
              </div>
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
            <p className="text-xs text-slate-500">
              总数 {total}，当前第 {query.page} 页。
            </p>
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
