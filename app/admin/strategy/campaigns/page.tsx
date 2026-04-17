"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { FeedbackBanner } from "@/components/admin/feedback-banner";
import { MultiSelectChecklist, type ChecklistOption } from "@/components/admin/multi-select-checklist";
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
import {
  AdminClientError,
  formatFieldErrors,
  requestJson,
} from "@/lib/admin/client";
import type { ListResult } from "@/lib/admin/types";
import type {
  CampaignEntity,
  DealerEntity,
  DealerSegmentEntity,
  ProductEntity,
  ProductPoolEntity,
} from "@/lib/memory/types";

type CampaignForm = {
  campaign_id: string;
  week_id: string;
  campaign_name: string;
  weekly_focus_items: string[];
  product_pool_ids: string[];
  promo_threshold: number;
  promo_type: string;
  activity_notes: string[];
  target_dealer_ids: string[];
  target_segment_ids: string[];
  target_customer_types: string[];
  status: "active" | "inactive";
};

const EMPTY_FORM: CampaignForm = {
  campaign_id: "",
  week_id: "",
  campaign_name: "",
  weekly_focus_items: [],
  product_pool_ids: [],
  promo_threshold: 0,
  promo_type: "",
  activity_notes: [],
  target_dealer_ids: [],
  target_segment_ids: [],
  target_customer_types: [],
  status: "active",
};

export default function CampaignsPage() {
  const [items, setItems] = useState<CampaignEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [pools, setPools] = useState<ProductPoolEntity[]>([]);
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [segments, setSegments] = useState<DealerSegmentEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "week_id",
    sortOrder: "desc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<CampaignEntity | null>(null);
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

  const loadReferenceData = useCallback(async () => {
    const [productData, poolData, dealerData, segmentData] = await Promise.all([
      requestJson<ListResult<ProductEntity>>(
        "/api/admin/products?page=1&pageSize=500&status=active&sortBy=display_order&sortOrder=asc",
      ),
      requestJson<ListResult<ProductPoolEntity>>(
        "/api/admin/product-pools?page=1&pageSize=500&status=active&sortBy=pool_name&sortOrder=asc",
      ),
      requestJson<ListResult<DealerEntity>>(
        "/api/admin/dealers?page=1&pageSize=500&status=active&sortBy=customer_name&sortOrder=asc",
      ),
      requestJson<ListResult<DealerSegmentEntity>>(
        "/api/admin/segments?page=1&pageSize=500&status=active&sortBy=segment_name&sortOrder=asc",
      ),
    ]);
    setProducts(productData.items);
    setPools(poolData.items);
    setDealers(dealerData.items);
    setSegments(segmentData.items);
  }, []);

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
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const productOptions = useMemo<ChecklistOption[]>(
    () =>
      products.map((item) => ({
        value: item.sku_id,
        label: item.sku_name,
        description: `${item.sku_id} · ¥${item.price_per_case}/箱`,
      })),
    [products],
  );

  const poolOptions = useMemo<ChecklistOption[]>(
    () =>
      pools.map((item) => ({
        value: item.pool_id,
        label: item.pool_name,
        description: `${item.pool_type} · ${item.sku_ids.length} SKU`,
      })),
    [pools],
  );

  const dealerOptions = useMemo<ChecklistOption[]>(
    () =>
      dealers.map((item) => ({
        value: item.customer_id,
        label: item.customer_name,
        description: `${item.customer_id} · ${item.city}`,
      })),
    [dealers],
  );

  const segmentOptions = useMemo<ChecklistOption[]>(
    () =>
      segments.map((item) => ({
        value: item.segment_id,
        label: item.segment_name,
        description: item.description || item.segment_id,
      })),
    [segments],
  );

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
      weekly_focus_items: item.weekly_focus_items,
      product_pool_ids: item.product_pool_ids ?? [],
      promo_threshold: item.promo_threshold,
      promo_type: item.promo_type,
      activity_notes: item.activity_notes,
      target_dealer_ids: item.target_dealer_ids ?? [],
      target_segment_ids: item.target_segment_ids ?? [],
      target_customer_types: item.target_customer_types,
      status: item.status,
    });
    setDrawerOpen(true);
  };

  const payloadFromForm = () => ({
    ...form,
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
      setDrawerOpen(false);
      resetForm();
      await loadCampaigns();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("活动创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<CampaignEntity>(`/api/admin/campaigns/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("活动更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadCampaigns();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("活动更新失败");
      }
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
    } finally {
      setPendingDisable(null);
    }
  };

  return (
    <AdminPageFrame
      title="活动策略"
      description="结构化维护活动商品与目标范围，禁止用逗号文本维护主数据关联。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadCampaigns} disabled={loading}>
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
            新建活动
          </Button>
        </div>
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
                  <TableHead>活动</TableHead>
                  <TableHead>商品 / 范围</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.campaign_id}>
                    <TableCell className="font-mono text-xs">{item.campaign_id}</TableCell>
                    <TableCell>
                      <p>{item.campaign_name}</p>
                      <p className="text-xs text-slate-500">{item.week_id}</p>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      SKU {item.weekly_focus_items.length} · 池 {(item.product_pool_ids ?? []).length}
                      <br />
                      经销商 {(item.target_dealer_ids ?? []).length} · 分群{" "}
                      {(item.target_segment_ids ?? []).length}
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
        title={editingId ? `编辑活动: ${editingId}` : "创建活动"}
        description="结构化维护活动商品与目标范围。"
      >
        <div className="space-y-3">
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
          </div>

          <div className="space-y-1">
            <Label>活动名称</Label>
            <Input
              value={form.campaign_name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, campaign_name: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
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
          </div>

          <MultiSelectChecklist
            label="活动商品（SKU）"
            options={productOptions}
            selected={form.weekly_focus_items}
            onChange={(weekly_focus_items) =>
              setForm((prev) => ({ ...prev, weekly_focus_items }))
            }
            searchPlaceholder="搜索活动商品"
          />
          <MultiSelectChecklist
            label="活动商品池（可选）"
            options={poolOptions}
            selected={form.product_pool_ids}
            onChange={(product_pool_ids) =>
              setForm((prev) => ({ ...prev, product_pool_ids }))
            }
            searchPlaceholder="搜索商品池"
          />
          <MultiSelectChecklist
            label="目标经销商"
            options={dealerOptions}
            selected={form.target_dealer_ids}
            onChange={(target_dealer_ids) =>
              setForm((prev) => ({ ...prev, target_dealer_ids }))
            }
            searchPlaceholder="搜索经销商"
          />
          <MultiSelectChecklist
            label="目标分群"
            options={segmentOptions}
            selected={form.target_segment_ids}
            onChange={(target_segment_ids) =>
              setForm((prev) => ({ ...prev, target_segment_ids }))
            }
            searchPlaceholder="搜索分群"
          />
          <TokenEditor
            label="运营标签（可选）"
            value={form.target_customer_types}
            onChange={(target_customer_types) =>
              setForm((prev) => ({ ...prev, target_customer_types }))
            }
            placeholder="例如 城区核心客户"
          />
          <TokenEditor
            label="活动说明"
            value={form.activity_notes}
            onChange={(activity_notes) => setForm((prev) => ({ ...prev, activity_notes }))}
            placeholder="输入活动说明"
          />

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
        title="确认停用活动"
        description={`停用后该活动将不再参与推荐生成。${
          pendingDisable ? `\n活动：${pendingDisable.campaign_name}` : ""
        }`}
        confirmLabel="确认停用"
        onConfirm={async () => {
          if (!pendingDisable) {
            return;
          }
          await softDelete(pendingDisable.campaign_id);
        }}
      />
    </AdminPageFrame>
  );
}
