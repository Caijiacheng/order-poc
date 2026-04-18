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
import type { DealerEntity, DealerSegmentEntity } from "@/lib/memory/types";

type SegmentForm = {
  segment_id: string;
  segment_name: string;
  description: string;
  city_list: string[];
  customer_types: string[];
  channel_types: string[];
  dealer_ids: string[];
  status: "active" | "inactive";
};

const EMPTY_FORM: SegmentForm = {
  segment_id: "",
  segment_name: "",
  description: "",
  city_list: [],
  customer_types: [],
  channel_types: [],
  dealer_ids: [],
  status: "active",
};

export default function SegmentsPage() {
  const [items, setItems] = useState<DealerSegmentEntity[]>([]);
  const [dealers, setDealers] = useState<DealerEntity[]>([]);
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 10,
    q: "",
    status: "",
    sortBy: "segment_name",
    sortOrder: "asc" as "asc" | "desc",
  });
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<SegmentForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<DealerSegmentEntity | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadDealers = useCallback(async () => {
    const data = await requestJson<ListResult<DealerEntity>>(
      "/api/admin/dealers?page=1&pageSize=500&sortBy=customer_name&sortOrder=asc",
    );
    setDealers(data.items);
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

  const loadSegments = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await requestJson<ListResult<DealerSegmentEntity>>(
        `/api/admin/segments?${queryString}`,
      );
      setItems(data.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载分群失败");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadDealers();
  }, [loadDealers]);

  useEffect(() => {
    void loadSegments();
  }, [loadSegments]);

  const cityOptions = useMemo<ChecklistOption[]>(() => {
    return Array.from(new Set(dealers.map((item) => item.city).filter(Boolean)))
      .sort()
      .map((city) => ({ value: city, label: city }));
  }, [dealers]);

  const typeOptions = useMemo<ChecklistOption[]>(() => {
    return Array.from(new Set(dealers.map((item) => item.customer_type).filter(Boolean)))
      .sort()
      .map((value) => ({ value, label: value }));
  }, [dealers]);

  const channelOptions = useMemo<ChecklistOption[]>(() => {
    return Array.from(new Set(dealers.map((item) => item.channel_type).filter(Boolean)))
      .sort()
      .map((value) => ({ value, label: value }));
  }, [dealers]);

  const dealerOptions = useMemo<ChecklistOption[]>(() => {
    return dealers.map((item) => ({
      value: item.customer_id,
      label: item.customer_name,
      description: `${item.customer_id} · ${item.city} · ${item.customer_type}`,
    }));
  }, [dealers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const openCreateDrawer = () => {
    resetForm();
    setDrawerOpen(true);
  };

  const pickForEdit = (item: DealerSegmentEntity) => {
    setEditingId(item.segment_id);
    setForm({
      segment_id: item.segment_id,
      segment_name: item.segment_name,
      description: item.description,
      city_list: item.city_list,
      customer_types: item.customer_types,
      channel_types: item.channel_types,
      dealer_ids: item.dealer_ids,
      status: item.status,
    });
    setDrawerOpen(true);
  };

  const submitCreate = async () => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSegmentEntity>("/api/admin/segments", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSuccessMessage("分群创建成功");
      setDrawerOpen(false);
      resetForm();
      await loadSegments();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("分群创建失败");
      }
    }
  };

  const submitUpdate = async () => {
    if (!editingId) return;
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSegmentEntity>(`/api/admin/segments/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setSuccessMessage("分群更新成功");
      setDrawerOpen(false);
      resetForm();
      await loadSegments();
    } catch (error) {
      if (error instanceof AdminClientError) {
        setErrorMessage(`${error.message} ${formatFieldErrors(error.fieldErrors)}`);
      } else {
        setErrorMessage("分群更新失败");
      }
    }
  };

  const softDelete = async (id: string) => {
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await requestJson<DealerSegmentEntity>(`/api/admin/segments/${id}`, {
        method: "DELETE",
      });
      setSuccessMessage("分群已停用");
      if (editingId === id) resetForm();
      await loadSegments();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停用失败");
    }
  };

  return (
    <AdminPageFrame
      title="维护门店分组"
      description="按城市、类型、渠道和指定门店分组，方便批量生成和投放。"
      action={
        <Button className="rounded-full" onClick={openCreateDrawer}>
          <Plus className="h-4 w-4" />
          新建分群
        </Button>
      }
    >
      <FeedbackBanner kind="success" message={successMessage} />
      <FeedbackBanner kind="error" message={errorMessage} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-6">
          <Input
            placeholder="搜索分群 ID/名称"
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
              <SelectItem value="segment_name">分群名称</SelectItem>
              <SelectItem value="updated_at">更新时间</SelectItem>
              <SelectItem value="created_at">创建时间</SelectItem>
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
          <Button variant="outline" onClick={loadSegments} disabled={loading}>
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
                <TableHead>分群名称</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    {loading ? "加载中..." : "暂无分群"}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.segment_id}>
                    <TableCell className="font-mono text-xs">{item.segment_id}</TableCell>
                    <TableCell>
                      <p className="font-medium text-slate-800">{item.segment_name}</p>
                      <p className="text-xs text-slate-500">{item.description || "无描述"}</p>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      城市 {item.city_list.length} · 客户类型 {item.customer_types.length} ·
                      指定经销商 {item.dealer_ids.length}
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
        title={editingId ? `编辑分群: ${editingId}` : "新建分群"}
        description="设置分组范围，方便按门店分批投放建议。"
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
              {editingId ? "保存更新" : "创建分群"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>分群编码</Label>
            <Input
              value={form.segment_id}
              disabled={Boolean(editingId)}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, segment_id: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>分群名称</Label>
            <Input
              value={form.segment_name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, segment_name: event.target.value }))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>分群说明</Label>
          <Input
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <MultiSelectChecklist
          label="城市范围"
          options={cityOptions}
          selected={form.city_list}
          onChange={(city_list) => setForm((prev) => ({ ...prev, city_list }))}
          searchPlaceholder="搜索城市"
        />
        <MultiSelectChecklist
          label="客户类型"
          options={typeOptions}
          selected={form.customer_types}
          onChange={(customer_types) => setForm((prev) => ({ ...prev, customer_types }))}
          searchPlaceholder="搜索客户类型"
        />
        <MultiSelectChecklist
          label="渠道类型"
          options={channelOptions}
          selected={form.channel_types}
          onChange={(channel_types) => setForm((prev) => ({ ...prev, channel_types }))}
          searchPlaceholder="搜索渠道类型"
        />
        <MultiSelectChecklist
          label="指定经销商"
          options={dealerOptions}
          selected={form.dealer_ids}
          onChange={(dealer_ids) => setForm((prev) => ({ ...prev, dealer_ids }))}
          searchPlaceholder="搜索经销商"
        />

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
      </AdminDrawer>

      <AdminConfirmDialog
        open={Boolean(pendingDisable)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDisable(null);
          }
        }}
        title="确认停用分群"
        description={
          pendingDisable
            ? `停用后该分群不会继续参与生成任务。确认停用 ${pendingDisable.segment_name} 吗？`
            : "停用后该分群不会继续参与生成任务。"
        }
        confirmLabel="确认停用"
        onConfirm={async () => {
          if (!pendingDisable) {
            return;
          }
          await softDelete(pendingDisable.segment_id);
          setPendingDisable(null);
          setDrawerOpen(false);
        }}
      />
    </AdminPageFrame>
  );
}
