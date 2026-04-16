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
import type { DealerEntity } from "@/lib/memory/types";

type DealerForm = {
  customer_id: string;
  customer_name: string;
  city: string;
  customer_type: string;
  channel_type: string;
  store_count_hint: string;
  last_order_days_ago: number;
  order_frequency: string;
  price_sensitivity: "高" | "中" | "中低" | "低";
  new_product_acceptance: "高" | "中" | "低";
  frequent_items: string;
  forbidden_items: string;
  preferred_categories: string;
  business_traits: string;
  status: "active" | "inactive";
};

const EMPTY_FORM: DealerForm = {
  customer_id: "",
  customer_name: "",
  city: "",
  customer_type: "",
  channel_type: "",
  store_count_hint: "",
  last_order_days_ago: 0,
  order_frequency: "",
  price_sensitivity: "中",
  new_product_acceptance: "中",
  frequent_items: "",
  forbidden_items: "",
  preferred_categories: "",
  business_traits: "",
  status: "active",
};

export default function DealersPage() {
  const [items, setItems] = useState<DealerEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "customer_name",
    sortOrder: "asc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<DealerForm>(EMPTY_FORM);
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

  const loadDealers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<DealerEntity>>(
        `/api/admin/dealers?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载经销商失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadDealers();
  }, [loadDealers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const pickForEdit = (item: DealerEntity) => {
    setEditingId(item.customer_id);
    setForm({
      customer_id: item.customer_id,
      customer_name: item.customer_name,
      city: item.city,
      customer_type: item.customer_type,
      channel_type: item.channel_type,
      store_count_hint: item.store_count_hint,
      last_order_days_ago: item.last_order_days_ago,
      order_frequency: item.order_frequency,
      price_sensitivity: item.price_sensitivity,
      new_product_acceptance: item.new_product_acceptance,
      frequent_items: toEditableText(item.frequent_items),
      forbidden_items: toEditableText(item.forbidden_items),
      preferred_categories: toEditableText(item.preferred_categories),
      business_traits: toEditableText(item.business_traits),
      status: item.status,
    });
  };

  const payloadFromForm = () => ({
    ...form,
    frequent_items: fromEditableText(form.frequent_items),
    forbidden_items: fromEditableText(form.forbidden_items),
    preferred_categories: fromEditableText(form.preferred_categories),
    business_traits: fromEditableText(form.business_traits),
  });

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerEntity>("/api/admin/dealers", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("经销商创建成功");
      resetForm();
      await loadDealers();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("经销商创建失败");
    }
  };

  const submitUpdate = async () => {
    if (!editingId) {
      return;
    }
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerEntity>(`/api/admin/dealers/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("经销商更新成功");
      resetForm();
      await loadDealers();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
        return;
      }
      setErrorMessage("经销商更新失败");
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerEntity>(`/api/admin/dealers/${id}`, { method: "DELETE" });
      setSuccessMessage("经销商已停用");
      if (editingId === id) {
        resetForm();
      }
      await loadDealers();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="经销商档案"
      description="维护经销商主数据与经营画像（内存态），支持查询筛选、编辑与软停用。"
      action={
        <Button className="rounded-full" onClick={resetForm}>
          <Plus className="h-4 w-4" />
          新建经销商
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索 ID/名称/城市"
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
              <SelectValue placeholder="排序字段" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer_name">经销商名称</SelectItem>
              <SelectItem value="city">城市</SelectItem>
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
          <Button variant="outline" onClick={loadDealers} disabled={loading}>
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
                  <TableHead>名称</TableHead>
                  <TableHead>城市/渠道</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.customer_id}>
                    <TableCell className="font-mono text-xs">{item.customer_id}</TableCell>
                    <TableCell>{item.customer_name}</TableCell>
                    <TableCell>
                      <p>{item.city}</p>
                      <p className="text-xs text-slate-500">{item.channel_type}</p>
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
                          onClick={() => softDelete(item.customer_id)}
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
              {editingId ? `编辑经销商: ${editingId}` : "创建经销商"}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>经销商编码</Label>
                <Input
                  value={form.customer_id}
                  disabled={Boolean(editingId)}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customer_id: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>经销商名称</Label>
                <Input
                  value={form.customer_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customer_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>城市</Label>
                <Input
                  value={form.city}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, city: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>渠道类型</Label>
                <Input
                  value={form.channel_type}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, channel_type: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>客户分层</Label>
                <Input
                  value={form.customer_type}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customer_type: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>门店规模提示</Label>
                <Input
                  value={form.store_count_hint}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, store_count_hint: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>距离上次下单（天）</Label>
                <Input
                  type="number"
                  value={form.last_order_days_ago}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      last_order_days_ago: Number(event.target.value || "0"),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>下单频率</Label>
                <Input
                  value={form.order_frequency}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, order_frequency: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>价格敏感度</Label>
                <Select
                  value={form.price_sensitivity}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      price_sensitivity: value as DealerForm["price_sensitivity"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="高">高</SelectItem>
                    <SelectItem value="中">中</SelectItem>
                    <SelectItem value="中低">中低</SelectItem>
                    <SelectItem value="低">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>新品接受度</Label>
                <Select
                  value={form.new_product_acceptance}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      new_product_acceptance: value as DealerForm["new_product_acceptance"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="高">高</SelectItem>
                    <SelectItem value="中">中</SelectItem>
                    <SelectItem value="低">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>常购 SKU（逗号分隔）</Label>
              <Input
                value={form.frequent_items}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, frequent_items: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>禁配 SKU（逗号分隔）</Label>
              <Input
                value={form.forbidden_items}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, forbidden_items: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>偏好品类（逗号分隔）</Label>
              <Input
                value={form.preferred_categories}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, preferred_categories: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>经营特征（逗号分隔）</Label>
              <Input
                value={form.business_traits}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, business_traits: event.target.value }))
                }
              />
            </div>

            <div className="flex items-center gap-2">
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
            </div>

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
