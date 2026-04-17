"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { MultiSelectChecklist, type ChecklistOption } from "@/components/admin/multi-select-checklist";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { TokenEditor } from "@/components/admin/token-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminClientError, formatFieldErrors, requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { ProductEntity } from "@/lib/memory/types";

type ProductForm = {
  sku_id: string;
  sku_name: string;
  brand: string;
  category: string;
  spec: string;
  price_per_case: number;
  box_multiple: number;
  tags: string[];
  pair_items: string[];
  is_weekly_focus: boolean;
  is_new_product: boolean;
  status: "active" | "inactive";
  display_order: number;
};

const EMPTY_FORM: ProductForm = {
  sku_id: "",
  sku_name: "",
  brand: "厨邦",
  category: "",
  spec: "",
  price_per_case: 1,
  box_multiple: 1,
  tags: [],
  pair_items: [],
  is_weekly_focus: false,
  is_new_product: false,
  status: "active",
  display_order: 999,
};

export default function ProductsPage() {
  const [items, setItems] = useState<ProductEntity[]>([]);
  const [allProducts, setAllProducts] = useState<ProductEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "display_order",
    sortOrder: "asc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const loadAllProducts = useCallback(async () => {
    const data = await requestJson<ListResult<ProductEntity>>(
      "/api/admin/products?page=1&pageSize=500&sortBy=display_order&sortOrder=asc",
    );
    setAllProducts(data.items);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<ProductEntity>>(
        `/api/admin/products?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载商品失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadAllProducts();
  }, [loadAllProducts]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(allProducts.map((item) => item.category).filter(Boolean))).sort();
  }, [allProducts]);

  const pairOptions = useMemo<ChecklistOption[]>(() => {
    return allProducts
      .filter((item) => item.sku_id !== form.sku_id)
      .map((item) => ({
        value: item.sku_id,
        label: item.sku_name,
        description: `${item.sku_id} · ${item.category}`,
      }));
  }, [allProducts, form.sku_id]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const pickForEdit = (item: ProductEntity) => {
    setEditingId(item.sku_id);
    setForm({
      sku_id: item.sku_id,
      sku_name: item.sku_name,
      brand: item.brand,
      category: item.category,
      spec: item.spec,
      price_per_case: item.price_per_case,
      box_multiple: item.box_multiple,
      tags: item.tags,
      pair_items: item.pair_items,
      is_weekly_focus: item.is_weekly_focus,
      is_new_product: item.is_new_product,
      status: item.status,
      display_order: item.display_order,
    });
  };

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductEntity>("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSuccessMessage("商品创建成功");
      resetForm();
      await Promise.all([loadProducts(), loadAllProducts()]);
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("商品创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductEntity>(`/api/admin/products/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setSuccessMessage("商品更新成功");
      resetForm();
      await Promise.all([loadProducts(), loadAllProducts()]);
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("商品更新失败");
      }
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductEntity>(`/api/admin/products/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("商品已停用");
      if (editingId === id) resetForm();
      await Promise.all([loadProducts(), loadAllProducts()]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="商品档案"
      description="维护 SKU、价格、箱规与标签关系，供活动和推荐策略结构化引用。"
      action={
        <Button className="rounded-full" onClick={resetForm}>
          <Plus className="h-4 w-4" />
          新建商品
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索 SKU/名称"
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
              <SelectItem value="display_order">陈列顺序</SelectItem>
              <SelectItem value="sku_name">商品名称</SelectItem>
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
              <SelectValue placeholder="排序方向" />
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
          <Button variant="outline" onClick={loadProducts} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>价格/箱规</TableHead>
                  <TableHead>关系</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-slate-500" colSpan={6}>
                      {loading ? "加载中..." : "无数据"}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.sku_id}>
                      <TableCell className="font-mono text-xs">{item.sku_id}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{item.sku_name}</p>
                          <p className="text-xs text-slate-500">
                            {item.category} · {item.spec}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        ¥{item.price_per_case} / 箱规 {item.box_multiple}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        标签 {item.tags.length} · 搭配 SKU {item.pair_items.length}
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
                            onClick={() => softDelete(item.sku_id)}
                            disabled={item.status === "inactive"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            停用
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {editingId ? `编辑商品: ${editingId}` : "创建商品"}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>商品编码</Label>
                <Input
                  value={form.sku_id}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, sku_id: event.target.value }))
                  }
                  disabled={Boolean(editingId)}
                />
              </div>
              <div className="space-y-1">
                <Label>商品名称</Label>
                <Input
                  value={form.sku_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, sku_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>品类</Label>
                <Select
                  value={form.category || "__custom__"}
                  onValueChange={(value) => {
                    if (value === "__custom__") return;
                    setForm((prev) => ({ ...prev, category: value }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择已有品类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom__">手工输入</SelectItem>
                    {categoryOptions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={form.category}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, category: event.target.value }))
                  }
                  placeholder="或手工输入品类"
                />
              </div>
              <div className="space-y-1">
                <Label>规格</Label>
                <Input
                  value={form.spec}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, spec: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>单箱价格</Label>
                <Input
                  type="number"
                  value={form.price_per_case}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      price_per_case: Number(event.target.value || "0"),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>箱规</Label>
                <Input
                  type="number"
                  value={form.box_multiple}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      box_multiple: Number(event.target.value || "0"),
                    }))
                  }
                />
              </div>
            </div>

            <TokenEditor
              label="商品标签"
              value={form.tags}
              onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
              placeholder="输入标签，例如：高频动销"
              suggestions={["高频动销", "常购", "活动", "新品", "利润款"]}
            />
            <MultiSelectChecklist
              label="搭配商品 SKU"
              options={pairOptions}
              selected={form.pair_items}
              onChange={(pair_items) => setForm((prev) => ({ ...prev, pair_items }))}
              searchPlaceholder="搜索可搭配商品"
              emptyText="没有可搭配商品"
            />

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.is_weekly_focus}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      is_weekly_focus: event.target.checked,
                    }))
                  }
                />
                周活动重点品
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.is_new_product}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      is_new_product: event.target.checked,
                    }))
                  }
                />
                新品
              </label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as "active" | "inactive" }))
                }
              >
                <SelectTrigger className="w-36">
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
