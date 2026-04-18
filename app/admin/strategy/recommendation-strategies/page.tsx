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
import { Textarea } from "@/components/ui/textarea";
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
  ExpressionTemplateEntity,
  ProductEntity,
  ProductPoolEntity,
  RecommendationStrategyScene,
  RecommendationStrategyEntity,
  TemplateReferenceItem,
} from "@/lib/memory/types";

type StrategyForm = {
  strategy_id: string;
  strategy_name: string;
  scene: RecommendationStrategyScene;
  target_dealer_ids: string[];
  dealer_segment_ids: string[];
  product_pool_ids: string[];
  campaign_ids: string[];
  candidate_sku_ids: string[];
  reference_items: TemplateReferenceItem[];
  business_notes: string;
  expression_template_id: string;
  priority: number;
  status: "active" | "inactive";
};

const SCENE_LABELS: Record<RecommendationStrategyScene, string> = {
  hot_sale_bundle: "热销组货",
  replenishment_bundle: "补货组货",
  campaign_bundle: "活动组货",
};

const EMPTY_REFERENCE_ITEM = (sortOrder = 1): TemplateReferenceItem => ({
  sku_id: "",
  qty: 1,
  reason: "",
  reason_tags: [],
  sort_order: sortOrder,
});

const EMPTY_FORM: StrategyForm = {
  strategy_id: "",
  strategy_name: "",
  scene: "replenishment_bundle",
  target_dealer_ids: [],
  dealer_segment_ids: [],
  product_pool_ids: [],
  campaign_ids: [],
  candidate_sku_ids: [],
  reference_items: [EMPTY_REFERENCE_ITEM(1)],
  business_notes: "",
  expression_template_id: "",
  priority: 1,
  status: "active" as const,
};

function getScenePurpose(scene: RecommendationStrategyScene) {
  if (scene === "hot_sale_bundle") {
    return "优先推荐走得快、适合先补的商品";
  }
  if (scene === "campaign_bundle") {
    return "优先围绕活动货和周推商品来组货";
  }
  return "优先补齐基础货和容易断货的商品";
}

export default function RecommendationStrategiesPage() {
  const [items, setItems] = useState<RecommendationStrategyEntity[]>([]);
  const [products, setProducts] = useState<ProductEntity[]>([]);
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [segments, setSegments] = useState<DealerSegmentEntity[]>([]);
  const [pools, setPools] = useState<ProductPoolEntity[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignEntity[]>([]);
  const [expressionTemplates, setExpressionTemplates] = useState<ExpressionTemplateEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "priority",
    sortOrder: "asc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<StrategyForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<RecommendationStrategyEntity | null>(
    null,
  );
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(query.page));
    params.set("pageSize", String(query.pageSize));
    if (query.q) params.set("q", query.q);
    if (query.status) params.set("status", query.status);
    params.set("sortBy", query.sortBy);
    params.set("sortOrder", query.sortOrder);
    return params.toString();
  }, [query]);

  const loadReferenceData = useCallback(async () => {
    const [
      productData,
      dealerData,
      segmentData,
      poolData,
      campaignData,
      expressionData,
    ] = await Promise.all([
      requestJson<ListResult<ProductEntity>>(
        "/api/admin/products?page=1&pageSize=500&status=active&sortBy=display_order&sortOrder=asc",
      ),
      requestJson<ListResult<DealerEntity>>(
        "/api/admin/dealers?page=1&pageSize=500&status=active&sortBy=customer_name&sortOrder=asc",
      ),
      requestJson<ListResult<DealerSegmentEntity>>(
        "/api/admin/segments?page=1&pageSize=500&status=active&sortBy=segment_name&sortOrder=asc",
      ),
      requestJson<ListResult<ProductPoolEntity>>(
        "/api/admin/product-pools?page=1&pageSize=500&status=active&sortBy=pool_name&sortOrder=asc",
      ),
      requestJson<ListResult<CampaignEntity>>(
        "/api/admin/campaigns?page=1&pageSize=500&status=active&sortBy=week_id&sortOrder=desc",
      ),
      requestJson<ListResult<ExpressionTemplateEntity>>(
        "/api/admin/expression-templates?page=1&pageSize=500&status=active&sortBy=expression_template_name&sortOrder=asc",
      ),
    ]);
    setProducts(productData.items);
    setDealers(dealerData.items);
    setSegments(segmentData.items);
    setPools(poolData.items);
    setCampaigns(campaignData.items);
    setExpressionTemplates(expressionData.items);
  }, []);

  const loadStrategies = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<RecommendationStrategyEntity>>(
        `/api/admin/recommendation-strategies?${queryString}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载推荐方案失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadStrategies();
  }, [loadStrategies]);

  const productOptions = useMemo<ChecklistOption[]>(
    () =>
      products.map((item) => ({
        value: item.sku_id,
        label: item.sku_name,
        description: `${item.sku_id} · ${item.category}`,
      })),
    [products],
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

  const poolOptions = useMemo<ChecklistOption[]>(
    () =>
      pools.map((item) => ({
        value: item.pool_id,
        label: item.pool_name,
        description: `${item.pool_type} · ${item.sku_ids.length} SKU`,
      })),
    [pools],
  );

  const campaignOptions = useMemo<ChecklistOption[]>(
    () =>
      campaigns.map((item) => ({
        value: item.campaign_id,
        label: item.campaign_name,
        description: item.week_id,
      })),
    [campaigns],
  );

  const selectedExpressionTemplate = useMemo(
    () =>
      expressionTemplates.find(
        (item) => item.expression_template_id === form.expression_template_id,
      ) ?? null,
    [expressionTemplates, form.expression_template_id],
  );

  const referencePreview = useMemo(
    () =>
      form.reference_items
        .filter((item) => item.sku_id)
        .map((item) => {
          const product = products.find((candidate) => candidate.sku_id === item.sku_id);
          return `${product?.sku_name ?? item.sku_id} ${item.qty}箱`;
        })
        .slice(0, 3),
    [form.reference_items, products],
  );

  const promptPreview = useMemo(() => {
    const lines = [
      `场景：${SCENE_LABELS[form.scene]}`,
      `目标：${getScenePurpose(form.scene)}`,
      selectedExpressionTemplate
        ? `话术风格：${selectedExpressionTemplate.tone}；${selectedExpressionTemplate.style_hint}`
        : "话术风格：尚未选择推荐话术",
      selectedExpressionTemplate
        ? `输出控制：理由最多 ${selectedExpressionTemplate.reason_limit} 条，避免 ${selectedExpressionTemplate.avoid.join(" / ") || "空话"}`
        : "",
      referencePreview.length > 0 ? `参考建议：${referencePreview.join("、")}` : "",
      form.business_notes.trim() ? `运营补充：${form.business_notes.trim()}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }, [form.business_notes, form.scene, referencePreview, selectedExpressionTemplate]);

  const resetForm = () => {
    setForm({
      ...EMPTY_FORM,
      expression_template_id: expressionTemplates[0]?.expression_template_id ?? "",
    });
    setEditingId(null);
  };

  useEffect(() => {
    if (!form.expression_template_id && expressionTemplates.length > 0 && !editingId) {
      setForm((prev) => ({
        ...prev,
        expression_template_id: expressionTemplates[0].expression_template_id,
      }));
    }
  }, [editingId, expressionTemplates, form.expression_template_id]);

  const pickForEdit = (item: RecommendationStrategyEntity) => {
    setEditingId(item.strategy_id);
    setForm({
      strategy_id: item.strategy_id,
      strategy_name: item.strategy_name,
      scene: item.scene,
      target_dealer_ids: item.target_dealer_ids,
      dealer_segment_ids: item.dealer_segment_ids,
      product_pool_ids: item.product_pool_ids,
      campaign_ids: item.campaign_ids,
      candidate_sku_ids: item.candidate_sku_ids,
      reference_items:
        item.reference_items.length > 0
          ? item.reference_items
          : [EMPTY_REFERENCE_ITEM(1)],
      business_notes: item.business_notes,
      expression_template_id: item.expression_template_id,
      priority: item.priority,
      status: item.status,
    });
    setDrawerOpen(true);
  };

  const updateReferenceItem = (
    index: number,
    patch: Partial<TemplateReferenceItem>,
  ) => {
    setForm((prev) => ({
      ...prev,
      reference_items: prev.reference_items.map((item, i) => {
        if (i !== index) return item;
        return {
          ...item,
          ...patch,
          sort_order: patch.sort_order ?? item.sort_order ?? i + 1,
        };
      }),
    }));
  };

  const addReferenceItem = () => {
    setForm((prev) => ({
      ...prev,
      reference_items: [
        ...prev.reference_items,
        EMPTY_REFERENCE_ITEM(prev.reference_items.length + 1),
      ],
    }));
  };

  const removeReferenceItem = (index: number) => {
    setForm((prev) => {
      const next = prev.reference_items.filter((_, i) => i !== index);
      return {
        ...prev,
        reference_items:
          next.length > 0
            ? next.map((item, i) => ({ ...item, sort_order: i + 1 }))
            : [EMPTY_REFERENCE_ITEM(1)],
      };
    });
  };

  const payloadFromForm = (): StrategyForm => ({
    ...form,
    reference_items: form.reference_items.map((item, index) => ({
      ...item,
      sort_order: index + 1,
    })),
  });

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecommendationStrategyEntity>("/api/admin/recommendation-strategies", {
        method: "POST",
        body: JSON.stringify(payloadFromForm()),
      });
      setSuccessMessage("推荐方案创建成功");
      setDrawerOpen(false);
      resetForm();
      await loadStrategies();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐方案创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecommendationStrategyEntity>(
        `/api/admin/recommendation-strategies/${editingId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payloadFromForm()),
        },
      );
      setSuccessMessage("推荐方案更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadStrategies();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐方案更新失败");
      }
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<RecommendationStrategyEntity>(
        `/api/admin/recommendation-strategies/${id}`,
        { method: "DELETE" },
      );
      setSuccessMessage("推荐方案已停用");
      if (editingId === id) {
        setDrawerOpen(false);
        resetForm();
      }
      await loadStrategies();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    } finally {
      setPendingDisable(null);
    }
  };

  return (
    <AdminPageFrame
      title="设置推荐方案"
      description="按门店、人群、商品范围和展示场景设置推荐方案。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadStrategies} disabled={loading}>
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
            新建方案
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索方案编号/名称/场景"
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
              <SelectItem value="strategy_name">方案名称</SelectItem>
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
                  <TableHead>方案</TableHead>
                  <TableHead>目标范围</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.strategy_id}>
                    <TableCell className="font-mono text-xs">{item.strategy_id}</TableCell>
                    <TableCell>
                      <p>{item.strategy_name}</p>
                      <p className="text-xs text-slate-500">
                        {SCENE_LABELS[item.scene]} · 优先级 {item.priority}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      经销商 {item.target_dealer_ids.length} · 分群 {item.dealer_segment_ids.length}
                      <br />
                      商品池 {item.product_pool_ids.length} · 活动 {item.campaign_ids.length}
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
        title={editingId ? `编辑方案: ${editingId}` : "创建方案"}
        description="设置适用门店、候选商品和推荐话术，并可预览发给 AI 的重点。"
      >
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>方案编码</Label>
              <Input
                value={form.strategy_id}
                disabled={Boolean(editingId)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, strategy_id: event.target.value }))
                }
              />
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
            <Label>方案名称</Label>
            <Input
              value={form.strategy_name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, strategy_name: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>发布场景</Label>
              <Select
                value={form.scene}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    scene: value as RecommendationStrategyScene,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot_sale_bundle">热销组货</SelectItem>
                  <SelectItem value="replenishment_bundle">补货组货</SelectItem>
                  <SelectItem value="campaign_bundle">活动组货</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>推荐话术</Label>
              <Select
                value={form.expression_template_id || "__none__"}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    expression_template_id: value === "__none__" ? "" : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">请选择</SelectItem>
                  {expressionTemplates.map((item) => (
                    <SelectItem
                      key={item.expression_template_id}
                      value={item.expression_template_id}
                    >
                      {item.expression_template_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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
            selected={form.dealer_segment_ids}
            onChange={(dealer_segment_ids) =>
              setForm((prev) => ({ ...prev, dealer_segment_ids }))
            }
            searchPlaceholder="搜索分群"
          />
          <MultiSelectChecklist
            label="商品池"
            options={poolOptions}
            selected={form.product_pool_ids}
            onChange={(product_pool_ids) =>
              setForm((prev) => ({ ...prev, product_pool_ids }))
            }
            searchPlaceholder="搜索商品池"
          />
          <MultiSelectChecklist
            label="活动"
            options={campaignOptions}
            selected={form.campaign_ids}
            onChange={(campaign_ids) => setForm((prev) => ({ ...prev, campaign_ids }))}
            searchPlaceholder="搜索活动"
          />
          <MultiSelectChecklist
            label="候选 SKU"
            options={productOptions}
            selected={form.candidate_sku_ids}
            onChange={(candidate_sku_ids) =>
              setForm((prev) => ({ ...prev, candidate_sku_ids }))
            }
            searchPlaceholder="搜索候选 SKU"
          />

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <Label>参考建议项</Label>
              <Button size="sm" type="button" variant="outline" onClick={addReferenceItem}>
                <Plus className="h-3.5 w-3.5" />
                添加建议项
              </Button>
            </div>
            <div className="space-y-3">
              {form.reference_items.map((item, index) => (
                <div
                  key={`${item.sku_id}-${index}`}
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_100px_auto]">
                    <Select
                      value={item.sku_id || "__none__"}
                      onValueChange={(value) =>
                        updateReferenceItem(index, {
                          sku_id: value === "__none__" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择 SKU" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">请选择 SKU</SelectItem>
                        {products.map((product) => (
                          <SelectItem key={product.sku_id} value={product.sku_id}>
                            {product.sku_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={(event) =>
                        updateReferenceItem(index, {
                          qty: Number(event.target.value || "1"),
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => removeReferenceItem(index)}
                    >
                      删除
                    </Button>
                  </div>
                  <Input
                    value={item.reason}
                    onChange={(event) =>
                      updateReferenceItem(index, { reason: event.target.value })
                    }
                    placeholder="建议理由"
                  />
                  <TokenEditor
                    label={`理由标签 #${index + 1}`}
                    value={item.reason_tags}
                    onChange={(reason_tags) => updateReferenceItem(index, { reason_tags })}
                    placeholder="输入理由标签"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>运营补充</Label>
            <Textarea
              placeholder="比如：优先推给重餐饮客户；文案更强调活动带货；避免说得太像系统提示。"
              value={form.business_notes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, business_notes: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[0.95fr_1.05fr]">
            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="space-y-3 p-4 text-sm">
                <div>
                  <p className="text-slate-500">当前话术模板</p>
                  <p className="mt-1 font-medium text-slate-900">
                    {selectedExpressionTemplate?.expression_template_name ?? "尚未选择"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedExpressionTemplate
                      ? `${selectedExpressionTemplate.tone} · ${selectedExpressionTemplate.style_hint}`
                      : "先选推荐话术，再看模型会按什么口径输出。"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">这套方案想解决什么</p>
                  <p className="mt-1 text-slate-800">{getScenePurpose(form.scene)}</p>
                </div>
                <div>
                  <p className="text-slate-500">参考建议商品</p>
                  <p className="mt-1 text-slate-800">
                    {referencePreview.length > 0
                      ? referencePreview.join("、")
                      : "还没有补参考建议商品。"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-medium text-slate-900">发给 AI 的重点预览</p>
                <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700">
                  {promptPreview}
                </pre>
              </CardContent>
            </Card>
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
        title="确认停用推荐方案"
        description={`停用后该方案将不再参与后续任务生成。${
          pendingDisable ? `\n方案：${pendingDisable.strategy_name}` : ""
        }`}
        confirmLabel="确认停用"
        onConfirm={async () => {
          if (!pendingDisable) {
            return;
          }
          await softDelete(pendingDisable.strategy_id);
        }}
      />
    </AdminPageFrame>
  );
}
