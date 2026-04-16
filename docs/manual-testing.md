# 手工测试说明

本文档用于本地手工验收这个 POC。

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

推荐分成两种模式：

### 1.3 Mock 模式

适合页面联调、讲流程、看前后台数据流。

`.env.local` 至少设置：

```bash
LLM_MOCK_MODE=true
LLM_MODEL=mock-manual
```

这一模式下可以不填真实 `LLM_API_KEY` 和 `LANGFUSE_*`。

### 1.4 Live 模式

适合完整验收真实模型和 Langfuse 链路。

`.env.local` 需要补齐：

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

- `NEXT_PUBLIC_LANGFUSE_BASE_URL` 建议与 `LANGFUSE_BASE_URL` 保持一致
- 缺少 `LANGFUSE_*` 时，页面仍可运行，但 Trace 链路不会完整上报

## 2. 启动方式

启动开发服务器：

```bash
pnpm dev
```

打开：

- 前台：http://localhost:3000
- 后台：http://localhost:3000/admin/dashboard

## 3. 推荐的手工验收路径

建议按下面顺序走，基本对应客户 demo 脚本。

### 3.1 后台配置台预检查

先打开这些页面，确认 seed 已经正常加载：

- `/admin/products`
- `/admin/dealers`
- `/admin/suggestion-templates`
- `/admin/campaigns`
- `/admin/prompts`
- `/admin/rules`
- `/admin/reports`
- `/admin/reports/recommendations`

检查点：

- 商品数能正常展示
- 有 3 个经销商画像
- 模板列表不为空
- Prompt 与规则页能打开
- 报表页初始可查询

### 3.2 首页建议单

打开 `/`，先选择经销商，再点 `生成建议`。

建议分别测这 3 个经销商：

- 厦门思明经销商
- 东莞商超配送经销商
- 成都餐饮批发经销商

检查点：

- 页面出现 `今日建议补货` 和 `本周重点推荐`
- `Daily Run`、`Weekly Run` 已生成
- 不同经销商的 SKU 候选明显不同
- 点 `查看解释` 后能看到 explanation 卡片
- 点 `加入购物车` 或 `全部加入购物车` 后有成功提示

重点观察的画像差异：

- 厦门：偏味极鲜、蚝油、金标生抽
- 东莞：偏小规格、活动组合、小包装生抽
- 成都：偏餐饮大包装、整箱采购相关 SKU

### 3.3 下单页

打开 `/order`。

检查点：

- 能切换经销商
- 能按名称 / SKU / 标签搜索
- 能按分类筛选
- 单个商品可以直接 `加入购物车`
- 点 `生成快速建议` 后，能出现快速建议
- 点 `应用快速建议` 后，购物车摘要会变化

建议人工验证一次：

1. 切到厦门经销商
2. 生成快速建议
3. 记下推荐 SKU
4. 切到东莞或成都再生成一次
5. 确认推荐结构发生变化

### 3.4 购物车页

打开 `/cart`，点击 `重新优化`。

检查点：

- 出现 `门槛补齐`
- 出现 `箱规修正`
- 出现 `搭配加购`
- 生成 `Optimization Run`
- 如果配置了 Langfuse，可点 `打开 Langfuse Trace`

建议至少覆盖这 3 种动作：

1. 点门槛补齐的 `应用`
2. 点箱规修正的 `应用`
3. 点搭配加购的 `应用`

也可以直接点 `应用全部优化`。

应用后检查：

- 购物车表格数量发生变化
- 金额 / 门槛摘要变化
- 成功提示出现

### 3.5 提交确认页

打开 `/confirm`，点 `确认提交订单`。

检查点：

- 成功生成 `order_id`
- 页面展示订单摘要
- 能看到本单优化结果汇总

## 4. 后台配置变更验证

### 4.1 Prompt 变更

打开 `/admin/prompts`。

推荐测试方式：

1. 在 `recommendation_prompt.instruction` 末尾临时加一个唯一标记，例如 `MANUAL_TEST_MARKER_001`
2. 点击 `保存 Prompt`
3. 回到首页重新生成建议
4. 打开 `/admin/reports/recommendations`
5. 找到刚生成的 run，点开详情
6. 检查 `prompt_snapshot` 里是否包含这个标记

这样能验证：

- 后台配置保存成功
- 推荐 run 确实使用了最新 Prompt
- 不依赖模型最终自然语言措辞

测试结束后建议把这个标记删掉，再保存一次。

### 4.2 商品 / 经销商 / 模板变更

可选做法：

1. 在 `/admin/products` 新增或停用一个商品
2. 或在 `/admin/suggestion-templates` 修改某个模板优先级 / 启用状态
3. 重新生成建议
4. 去 `/admin/reports/recommendations` 查看：
   - `template_id`
   - `template_name`
   - `candidate_sku_ids`
   - `returned_sku_ids`

这是比只看页面文案更稳定的验证方法。

## 5. 报表核查

打开 `/admin/reports/recommendations`。

建议检查：

- 能按 `customerId` 查询
- 能按 `scene` 查询
- 能按 `skuId` 查询
- 能按 `adoptionStatus` 查询
- 点开某个 run 后能看到：
  - `trace_id`
  - `template_id`
  - `prompt_snapshot`
  - 推荐条目的最终状态

如果你刚刚做过解释、加购、优化、提交订单，这里应该能看到状态变化。

## 6. Langfuse 核查

如果启用了 Live 模式并且 `LANGFUSE_*` 正确：

### 6.1 页面入口

可以在这些地方直接点 Trace 链接：

- 首页推荐摘要
- 购物车优化面板
- 推荐记录详情页

### 6.2 预期的顶级 Trace

重点看下面几类：

- `homepage.generate-recommendations`
- `recommendation.explain`
- `cart.generate-optimization`
- `confirm.submit-order`

### 6.3 预期核查项

在 Langfuse 中建议核查：

- trace 能打开
- trace 名称正确
- customer / session / scene 元数据存在
- LLM 调用存在
- 输入输出不是空值
- 与后台推荐记录里的 `trace_id` 能对上

## 7. 推荐的手工回归组合

如果你只想做一轮最小手工回归，按这个走：

1. `/` 生成建议，查看解释，全部加入购物车
2. `/cart` 重新优化，应用全部优化
3. `/confirm` 提交订单
4. `/admin/reports/recommendations` 查这次 run
5. 打开 Langfuse Trace 核对链路

如果你要做一轮更完整的客户验收，再补：

1. `/admin/prompts` 改一次 Prompt 标记
2. `/order` 切换 3 个经销商，比较差异
3. `/admin/reports/recommendations` 核对 `prompt_snapshot` 和 `template_id`

## 8. 常见问题

### 8.1 重启后数据变了

这是预期行为。当前所有运行时状态都在内存里，重启会回到 seed 初始状态。

### 8.2 页面能跑，但没有 Trace

通常是 `LANGFUSE_*` 没配完整，或 `NEXT_PUBLIC_LANGFUSE_BASE_URL` 没设。

### 8.3 推荐失败

先看两件事：

1. `LLM_MOCK_MODE` 是否和当前模式一致
2. `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 是否配置完整

### 8.4 想直接跑自动化

```bash
pnpm test:e2e:mock
pnpm test:e2e:live
```
