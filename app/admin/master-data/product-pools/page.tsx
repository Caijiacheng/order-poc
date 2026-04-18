"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDrawer } from "@/components/admin/admin-drawer";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { MultiSelectChecklist, type ChecklistOption } from "@/components/admin/multi-select-checklist";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminClientError, formatFieldErrors, requestJson } from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type { ProductEntity, ProductPoolEntity, ProductPoolType } from "@/lib/memory/types";

type ProductPoolForm = {
  pool_id: string;
  pool_name: string;
  pool_type: ProductPoolType;
  description: string;
  sku_ids: string[];
  pair_sku_ids: string[];
  status: "active" | "inactive";
};

const EMPTY_FORM: ProductPoolForm = {
  pool_id: "",
  pool_name: "",
  pool_type: "regular",
  description: "",
  sku_ids: [],
  pair_sku_ids: [],
  status: "active",
};

const POOL_TYPE_LABEL: Record<ProductPoolType, string> = {
  regular: "常规补货池",
  hot_sale: "热销池",
  new_product: "新品池",
  campaign: "活动池",
  pairing: "搭配池",
};

export default function ProductPoolsPage() {
  const [items, setItems] = useState<ProductPoolEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "pool_name",
    sortOrder: "asc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ProductPoolForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<ProductPoolEntity | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadProducts = useCallback(async () => {
    const data = await requestJson<ListResult<ProductEntity>>(
      "/api/admin/products?page=1&pageSize=500&sortBy=display_order&sortOrder=asc",
    );
    setProducts(data.items);
  }, []);

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

  const loadPools = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<ProductPoolEntity>>(
        `/api/admin/product-pools?${queryString}`,
      );
      setItems(data.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载商品池失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    void loadPools();
  }, [loadPools]);

  const productOptions = useMemo<ChecklistOption[]>(() => {
    return products.map((item) => ({
      value: item.sku_id,
      label: item.sku_name,
      description: `${item.sku_id} · ¥${item.price_per_case}/箱`,
    }));
  }, [products]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const openCreateDrawer = () => {
    resetForm();
    setDrawerOpen(true);
  };

  const pickForEdit = (item: ProductPoolEntity) => {
    setEditingId(item.pool_id);
    setForm({
      pool_id: item.pool_id,
      pool_name: item.pool_name,
      pool_type: item.pool_type,
      description: item.description,
      sku_ids: item.sku_ids,
      pair_sku_ids: item.pair_sku_ids,
      status: item.status,
    });
    setDrawerOpen(true);
  };

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductPoolEntity>("/api/admin/product-pools", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSuccessMessage("商品池创建成功");
      setDrawerOpen(false);
      resetForm();
      await loadPools();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("商品池创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductPoolEntity>(`/api/admin/product-pools/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setSuccessMessage("商品池更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadPools();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("商品池更新失败");
      }
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<ProductPoolEntity>(`/api/admin/product-pools/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("商品池已停用");
      if (editingId === id) resetForm();
      await loadPools();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="维护商品分组"
      action={
        <Button className="rounded-full" onClick={openCreateDrawer}>
          <Plus className="h-4 w-4" />
          新建商品池
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索商品池 ID/名称"
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
              <SelectItem value="pool_name">商品池名称</SelectItem>
              <SelectItem value="pool_type">类型</SelectItem>
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
              <SelectValue placeholder="排序方式" />
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
              <SelectValue placeholder="每页条数" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 / 页</SelectItem>
              <SelectItem value="20">20 / 页</SelectItem>
              <SelectItem value="50">50 / 页</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadPools} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>商品池</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>SKU 数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    {loading ? "加载中..." : "暂无商品池"}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.pool_id}>
                    <TableCell className="font-mono text-xs">{item.pool_id}</TableCell>
                    <TableCell>
                      <p className="font-medium text-slate-800">{item.pool_name}</p>
                      <p className="text-xs text-slate-500">{item.description || "无描述"}</p>
                    </TableCell>
                    <TableCell>{POOL_TYPE_LABEL[item.pool_type]}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      主池 {item.sku_ids.length} · 搭配 {item.pair_sku_ids.length}
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
                          className="text-rose-600"
                          onClick={() => setPendingDisable(item)}
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

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            resetForm();
          }
        }}
        title={editingId ? `编辑商品池: ${editingId}` : "新建商品池"}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDrawerOpen(false);
                resetForm();
              }}
            >
              取消
            </Button>
            <Button onClick={() => void (editingId ? submitUpdate() : submitCreate())}>
              {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? "保存更新" : "创建商品池"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>商品池编码</Label>
            <Input
              value={form.pool_id}
              disabled={Boolean(editingId)}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, pool_id: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>商品池名称</Label>
            <Input
              value={form.pool_name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, pool_name: event.target.value }))
              }
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select
              value={form.pool_type}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, pool_type: value as ProductPoolType }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">常规补货池</SelectItem>
                <SelectItem value="hot_sale">热销池</SelectItem>
                <SelectItem value="new_product">新品池</SelectItem>
                <SelectItem value="campaign">活动池</SelectItem>
                <SelectItem value="pairing">搭配池</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>状态</Label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, status: value as "active" | "inactive" }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>业务说明</Label>
          <Input
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <MultiSelectChecklist
          label="主商品清单（SKU）"
          options={productOptions}
          selected={form.sku_ids}
          onChange={(sku_ids) => setForm((prev) => ({ ...prev, sku_ids }))}
          searchPlaceholder="搜索商品"
        />
        <MultiSelectChecklist
          label="搭配商品清单（SKU）"
          options={productOptions}
          selected={form.pair_sku_ids}
          onChange={(pair_sku_ids) => setForm((prev) => ({ ...prev, pair_sku_ids }))}
          searchPlaceholder="搜索搭配商品"
        />
      </AdminDrawer>

      <AdminConfirmDialog
        open={Boolean(pendingDisable)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDisable(null);
          }
        }}
        title="确认停用商品池"
        description={
          pendingDisable
            ? `停用后该商品池不会继续参与方案生成。确认停用 ${pendingDisable.pool_name} 吗？`
            : "停用后该商品池不会继续参与方案生成。"
        }
        confirmLabel="确认停用"
        onConfirm={async () => {
          if (!pendingDisable) {
            return;
          }
          await softDelete(pendingDisable.pool_id);
          setPendingDisable(null);
          setDrawerOpen(false);
        }}
      />
    </AdminPageFrame>
  );
}
