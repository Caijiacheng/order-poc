"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

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
  RecommendationStrategyEntity,
  SuggestionScene,
  TemplateReferenceItem,
} from "@/lib/memory/types";

type StrategyForm = {
  strategy_id: string;
  strategy_name: string;
  scene: SuggestionScene;
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

const SCENE_LABELS: Record<SuggestionScene, string> = {
  daily_recommendation: "日常补货",
  weekly_focus: "周活动备货",
  threshold_topup: "门槛补差",
  box_pair_optimization: "箱规与搭配优化",
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
  scene: "daily_recommendation",
  target_dealer_ids: [],
  dealer_segment_ids: [],
  product_pool_ids: [],
  campaign_ids: [],
  candidate_sku_ids: [],
  reference_items: [EMPTY_REFERENCE_ITEM(1)],
  business_notes: "",
  expression_template_id: "",
  priority: 1,
  status: "active",
};

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
      setErrorMessage(error instanceof Error ? error.message : "加载推荐策略失败");
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
      setSuccessMessage("推荐策略创建成功");
      resetForm();
      await loadStrategies();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐策略创建失败");
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
      setSuccessMessage("推荐策略更新成功");
      resetForm();
      await loadStrategies();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("推荐策略更新失败");
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
      setSuccessMessage("推荐策略已停用");
      if (editingId === id) {
        resetForm();
      }
      await loadStrategies();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="推荐策略"
      description="按“给谁-推什么-为什么-发布场景”维护策略，不再使用 legacy 模板与 JSON 文本配置。"
      action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadStrategies} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button className="rounded-full" onClick={resetForm}>
            <Plus className="h-4 w-4" />
            新建策略
          </Button>
        </div>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索策略 ID/名称/场景"
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
              <SelectItem value="strategy_name">策略名称</SelectItem>
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

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>策略</TableHead>
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
                          onClick={() => softDelete(item.strategy_id)}
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
              {editingId ? `编辑策略: ${editingId}` : "创建策略"}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label>策略编码</Label>
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
              <Label>策略名称</Label>
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
                    <SelectItem value="box_pair_optimization">箱规与搭配优化</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>表达模板</Label>
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
              <Label>业务说明</Label>
              <Textarea
                value={form.business_notes}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, business_notes: event.target.value }))
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
          </CardContent>
        </Card>
      </section>
    </AdminPageFrame>
  );
}
