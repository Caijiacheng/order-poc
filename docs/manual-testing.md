# 手工测试说明（按角色）

本文档按最终产品三角色组织手工验收路径：

- 经销商（前台采购）
- 运营（后台配置与生成发布）
- IT 运维（观测、审计、恢复）

## 1. 前置准备

### 1.1 安装依赖

```bash
pnpm install
pnpm exec playwright install chromium
```

### 1.2 准备环境变量

```bash
cp .env.example .env.local
```

### 1.3 运行模式

Mock 模式（页面联调/流程演示）：

```bash
LLM_MOCK_MODE=true
LLM_MODEL=mock-manual
```

Live 模式（模型 + Langfuse 链路）：

```bash
LLM_MOCK_MODE=false
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=...
NEXT_PUBLIC_LANGFUSE_BASE_URL=...
```

说明：

- `NEXT_PUBLIC_LANGFUSE_BASE_URL` 建议与 `LANGFUSE_BASE_URL` 一致。
- 缺少 `LANGFUSE_*` 时，业务页面可运行，但链路上报不完整。

## 2. 启动与入口

启动：

```bash
pnpm dev
```

入口地址：

- 前台入口：`http://localhost:3000`（进入后走 `/procurement` 主流程）
- 后台入口：`http://localhost:3000/admin`（进入后走 `/admin/workbench/overview`）

## 3. 角色一：经销商验收（消费建议并下单）

目标：验证经销商只消费已发布建议，不承担“生成建议”操作。

### 3.1 采购首页 `/procurement`

检查点：

- 可切换经销商画像。
- 可看到“今日建议单 / 周活动备货 / 常购快捷补货 / 上次订单再来一单”。
- 建议项支持“采纳、改量、忽略、查看原因”。
- 页面提示语为“加载已发布建议单”语义，不出现“手动生成建议”入口。

### 3.2 商品选购 `/catalog`

检查点：

- 搜索、分类筛选、视图筛选（全部/常购/待补货/活动/新品）可用。
- 右侧“系统提示”可直接采纳或批量采纳。
- 商品加购成功后，采购清单摘要刷新。

### 3.3 采购清单 `/basket`

检查点：

- 进入页面后可自动看到门槛补差、箱规修正、搭配补充建议（购物车非空时）。
- 应用单条建议或“应用全部优化”后，数量/金额/门槛差额变化正确。
- 仅做“应用优化”动作，不存在“手动生成优化建议”业务要求。

### 3.4 下单确认 `/checkout`

检查点：

- 订单明细、收货、配送、结算、发票与备注信息完整。
- “本单优化说明”自动汇总可见。
- 提交后返回 `order_id`，并显示订单摘要。

## 4. 角色二：运营验收（配置 -> 预检 -> 生成 -> 发布 -> 复盘）

目标：验证运营侧可控生成链路和结果复盘能力。

### 4.1 配置基线

依次检查以下页面可读可写：

- `/admin/master-data/products`
- `/admin/master-data/dealers`
- `/admin/master-data/segments`
- `/admin/master-data/product-pools`
- `/admin/strategy/campaigns`
- `/admin/strategy/recommendation-strategies`
- `/admin/strategy/expression-templates`
- `/admin/strategy/global-rules`

建议至少完成一次变更并保存（如策略优先级、活动状态、表达模板文案）。

### 4.2 生成任务链路

在 `/admin/operations/generation-jobs`：

1. 创建或编辑任务（目标经销商/分群/策略）。
2. 执行预检并确认状态进入可执行。
3. 触发抽样试生成。
4. 触发正式生成。
5. 发布批次（或验证自动发布策略）。

检查点：

- 任务状态与发布时间字段更新正确。
- 任务可跳转到批次中心查看结果。

### 4.3 批次与记录复盘

在 `/admin/operations/recommendation-batches`：

- 按任务 ID、经销商、场景、状态筛选批次。
- 选择异常批次可下钻到记录页或链路页。

在 `/admin/analytics/recommendation-records`：

- 按时间、经销商、场景、SKU、状态、采纳状态筛选。
- 详情可查看 run/item 级状态、trace_id、候选与返回结果字段。

## 5. 角色三：IT 运维验收（观测 -> 审计 -> 恢复）

目标：验证“可观测、可追溯、可回滚”闭环。

### 5.1 工作台总览

打开 `/admin/workbench/overview`，检查：

- 今日批次成功/失败/部分失败统计。
- 配置健康度（商品、经销商、策略、活动、表达模板）可见。
- 最近审计日志可见。

### 5.2 链路观察

打开 `/admin/observability/traces`，检查：

- 可按时间、经销商、场景、采纳状态、批次筛选。
- run 详情可跳转 Langfuse（Live 模式下）。
- 记录中的 trace_id 与 Langfuse 对应可对齐。

### 5.3 审计与恢复

打开 `/admin/observability/audit-logs`：

- 可查询近期配置变更与关键操作轨迹。

打开 `/admin/observability/recovery`：

- 可创建恢复快照。
- 可对可用快照执行“应用恢复”。
- 可归档历史快照。

## 6. 最小回归组合（推荐）

1. 运营在 `/admin/operations/generation-jobs` 完成一次预检、生成、发布。
2. 经销商按 `/procurement` -> `/catalog` -> `/basket` -> `/checkout` 完成一单。
3. 运营在 `/admin/analytics/recommendation-records` 查询本单关联 run。
4. IT 在 `/admin/observability/traces` 与 `/admin/observability/recovery` 完成链路核查与恢复演练。

## 7. 常见问题

### 7.1 重启后数据变化

预期行为。系统为内存态，重启会回到 seed 初始状态。

### 7.2 页面可用但无 Trace

通常是 `LANGFUSE_*` 或 `NEXT_PUBLIC_LANGFUSE_BASE_URL` 配置不完整。

### 7.3 想直接跑自动化

```bash
pnpm test:e2e:mock
pnpm test:e2e:live
```
