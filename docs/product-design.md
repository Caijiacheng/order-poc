# AI 经销商下单助手 POC 详细设计文档

## 1. 文档目标

本文档定义一个面向美味鲜客户、以厨邦品牌商品为核心的 POC 设计方案。目标不是构建真实生产系统，而是构建一个可以稳定演示、逻辑完整、配置清晰、可观察的 Demo。

本次文档覆盖 3 个层面：

- 前台演示系统：建议单、下单、购物车凑单、提交确认
- 后台配置台：商品、经销商、建议单模板、规则、Prompt 等配置
- 报表与观测：内存态指标报表 + Langfuse 全链路追踪

默认技术栈：

- `Next.js App Router`
- `TypeScript`
- `Tailwind CSS`
- `Vercel AI SDK`
- `Langfuse + OpenTelemetry`
- 本地 JSON / 内存态数据存储

---

## 2. 产品定义

### 2.1 产品名称

`AI 建议单 + 智能凑单 Demo`

### 2.2 产品定位

在经销商下单前提供主动建议单，在购物车阶段提供实时凑单与优化建议，并用 AI 解释推荐理由；同时提供后台配置台，让业务人员能够直接修改商品、经销商、建议模板、Prompt 和规则。

### 2.3 本期范围

本期只做以下内容：

- 前台 4 个业务页面
- 后台配置台
- 商品信息 CRUD
- 经销商信息 CRUD
- 经销商建议单模板 CRUD
- 活动 / 规则 / Prompt 配置
- 内存态指标统计
- 报表页
- Langfuse 全链路追踪

本期明确不做：

- 真实库存系统
- 真实 OMS 下单
- 真实促销引擎
- 数据库持久化
- 权限体系和登录体系
- 复杂预测模型
- 多轮自主 Agent 编排

### 2.4 核心原则

- 规则负责稳定
- AI 负责表达与排序
- 页面负责演示效果
- 后台负责可配置
- 报表负责可解释
- Langfuse 负责可观测

---

## 3. 用户角色与入口

### 3.1 角色

#### 角色 A：演示用户

用于在客户面前演示 AI 建议单和智能凑单。

#### 角色 B：业务配置人员

用于维护商品、经销商、建议单模板、活动、规则和 Prompt。

#### 角色 C：演示讲解人员

用于查看报表、指标和 Langfuse 链路。

### 3.2 路由入口

建议拆为两组入口：

- 前台演示：`/`、`/order`、`/cart`、`/confirm`
- 后台配置：`/admin`

后台配置页下再分模块：

- `/admin/dashboard`
- `/admin/products`
- `/admin/dealers`
- `/admin/suggestion-templates`
- `/admin/campaigns`
- `/admin/rules`
- `/admin/prompts`
- `/admin/reports`

POC 阶段不做登录，默认本地可访问。页面顶部用明显的导航区分“演示台”和“配置台”。

---

## 4. 业务对象与演示数据

### 4.1 品牌范围

Demo 聚焦美味鲜业务场景，商品池采用厨邦品牌调味品。

### 4.2 经销商数量与画像

设计 3 个经销商，保证客户画像明显不同，便于演示“同一套系统对不同客户输出不同建议”。

#### 客户 A：厦门思明核心经销商

- `customer_id`: `dealer_xm_sm`
- `customer_name`: `厦门思明经销商`
- `city`: `厦门`
- `customer_type`: `城区核心客户`
- `channel_type`: `餐饮+流通`
- `store_count_hint`: `120+`
- `last_order_days_ago`: `6`
- `order_frequency`: `5-7天`
- `price_sensitivity`: `中`
- `new_product_acceptance`: `高`
- `frequent_items`: `味极鲜`, `金标生抽`, `蚝油`, `鸡精`
- `business_traits`: `动销快`, `有新品试销能力`, `接受活动引导`

适合演示：

- 常规补货建议
- 本周主推建议
- 达免运费凑单

#### 客户 B：东莞商超配送经销商

- `customer_id`: `dealer_dg_sm`
- `customer_name`: `东莞商超配送经销商`
- `city`: `东莞`
- `customer_type`: `商超配送客户`
- `channel_type`: `KA 商超`
- `store_count_hint`: `60+`
- `last_order_days_ago`: `4`
- `order_frequency`: `3-5天`
- `price_sensitivity`: `高`
- `new_product_acceptance`: `中`
- `frequent_items`: `小包装生抽`, `陈醋`, `鸡精组合装`, `料酒`
- `business_traits`: `重视促销`, `重视周转`, `偏好多规格组合`

适合演示：

- 活动型建议单
- 门槛补齐
- 小规格补货

#### 客户 C：成都餐饮批发经销商

- `customer_id`: `dealer_cd_pf`
- `customer_name`: `成都餐饮批发经销商`
- `city`: `成都`
- `customer_type`: `餐饮批发客户`
- `channel_type`: `餐饮批发`
- `store_count_hint`: `80+`
- `last_order_days_ago`: `8`
- `order_frequency`: `7-10天`
- `price_sensitivity`: `中低`
- `new_product_acceptance`: `低`
- `frequent_items`: `厨邦蚝油`, `厨邦蒸鱼豉油`, `大包装料酒`, `鸡精`
- `business_traits`: `偏重大包装`, `重视整箱配送`, `喜欢固定搭配采购`

适合演示：

- 常规补货
- 箱规修正
- 搭配补货

### 4.3 商品池建议

SKU 数量建议 `18-24` 个，足够支撑 POC。

建议商品池：

- 厨邦味极鲜特级生抽 500ml
- 厨邦金标生抽 500ml
- 厨邦金标老抽 500ml
- 厨邦蚝油 700g
- 厨邦鸡精 200g
- 厨邦鸡粉组合装
- 厨邦料酒 500ml
- 厨邦陈醋 450ml
- 厨邦蒸鱼豉油 450ml
- 厨邦零添加特级生抽 500ml
- 厨邦零添加头道酱油 500ml
- 厨邦宴会酱油 1.75L
- 厨邦大包装蚝油 2.27kg
- 厨邦餐饮装鸡精 1kg
- 厨邦小包装生抽 250ml
- 厨邦小包装蚝油 230g
- 厨邦拌面鲜酱油
- 厨邦凉拌鲜酱油
- 厨邦鲜香红烧酱油
- 厨邦本周活动组合装

### 4.4 搭配关系建议

- 蚝油 -> 鸡精
- 蒸鱼豉油 -> 金标生抽
- 零添加特级生抽 -> 零添加头道酱油
- 料酒 -> 陈醋
- 味极鲜 -> 蚝油

### 4.5 活动商品建议

每周维护 3-5 个活动项即可：

- 本周主推：零添加特级生抽
- 新品试销：零添加头道酱油
- 组合搭售：鸡精组合装
- 门店补货便利装：小包装生抽

---

## 5. 总体页面地图

### 5.1 前台演示页面

前台保留 4 个页面：

1. 首页 `/`
2. 下单页 `/order`
3. 购物车页 `/cart`
4. 提交确认页 `/confirm`

### 5.2 后台配置与报表页面

后台建议做 7 个页面：

1. 后台首页 `/admin/dashboard`
2. 商品管理 `/admin/products`
3. 经销商管理 `/admin/dealers`
4. 建议单模板管理 `/admin/suggestion-templates`
5. 活动与规则管理 `/admin/campaigns`、`/admin/rules`
6. Prompt 配置页 `/admin/prompts`
7. 报表页 `/admin/reports`

---

## 6. 前台页面设计

### 6.1 首页 `/`

目标：展示“系统会主动给建议单”。

页面区块：

- 客户切换区
- 客户画像卡片
- 今日建议补货区
- 本周重点推荐区
- 推荐解释抽屉

核心操作：

- 切换经销商
- 查看推荐原因
- 单条加入购物车
- 全部加入购物车
- 跳转下单页

### 6.2 下单页 `/order`

目标：承接首页建议，让用户继续选品。

页面区块：

- 商品筛选区
- 商品列表区
- 购物车预览区
- AI 快捷操作条

快捷操作建议：

- `帮我看看还缺什么`
- `按本周主推补一点`
- `只看常购品`

### 6.3 购物车页 `/cart`

目标：展示“围绕当前订单做优化”。

页面区块：

- 购物车明细表
- 金额摘要
- AI 优化建议面板

建议面板分 3 块：

- 门槛补齐建议
- 箱规修正建议
- 搭配补充建议

核心操作：

- 应用建议
- 调整数量
- 删除商品
- 重新计算

### 6.4 提交确认页 `/confirm`

目标：展示本单优化效果。

页面区块：

- 订单摘要
- 本单优化说明
- 最终确认

优化说明示例：

- 已补充鸡精 1 箱，达到免运费门槛
- 已将金标生抽调整为 6 箱，更符合整箱配送建议
- 已加入本周主推新品 1 项

---

## 7. 后台配置台设计

### 7.1 设计目标

后台配置台不是附属页面，而是本次 POC 的重要组成部分。它的价值是：

- 让业务人员自己改数据
- 让 Prompt 可控
- 让建议单有可编辑参考模板
- 让 Demo 可快速换行业话术和商品组合

### 7.2 后台首页 `/admin/dashboard`

目标：让配置人员快速看到系统状态。

页面区块：

- 商品数量
- 经销商数量
- 建议模板数量
- 当前活动数量
- 今日 AI 请求数
- 今日建议应用数
- 最近配置变更记录

快捷入口：

- 新建商品
- 新建经销商
- 新建建议单模板
- 修改 Prompt
- 查看报表

### 7.3 商品管理页 `/admin/products`

目标：维护厨邦商品主数据。

支持操作：

- 商品列表
- 搜索
- 分类筛选
- 新增商品
- 编辑商品
- 删除商品
- 启用 / 停用
- 批量导入 mock 数据

商品字段建议：

- `sku_id`
- `sku_name`
- `brand`
- `category`
- `spec`
- `price_per_case`
- `box_multiple`
- `tags`
- `pair_items`
- `is_weekly_focus`
- `is_new_product`
- `status`
- `display_order`

列表字段建议：

- 商品名称
- 品类
- 单箱价格
- 箱规
- 标签
- 搭配商品数量
- 是否主推
- 状态
- 操作

表单能力：

- 基础信息编辑
- 搭配关系选择
- 标签维护
- 价格和箱规维护
- 活动属性开关

### 7.4 经销商管理页 `/admin/dealers`

目标：维护经销商画像与推荐上下文。

支持操作：

- 经销商列表
- 新增经销商
- 编辑经销商
- 删除经销商
- 复制经销商画像
- 启用 / 停用

经销商字段建议：

- `customer_id`
- `customer_name`
- `city`
- `customer_type`
- `channel_type`
- `store_count_hint`
- `last_order_days_ago`
- `order_frequency`
- `price_sensitivity`
- `new_product_acceptance`
- `frequent_items`
- `forbidden_items`
- `business_traits`
- `preferred_categories`
- `status`

页面能力：

- 左侧列表，右侧详情表单
- 常购商品多选
- 禁推商品多选
- 经营特征标签化维护
- 客户摘要自动预览

### 7.5 经销商建议单模板页 `/admin/suggestion-templates`

这是你特别点名要补的重点模块。

目标：给每个经销商维护“建议单参考模板”，供 Prompt 作为参考，不直接作为最终输出。

设计原则：

- 模板是参考，不是硬编码结果
- 模板可以按场景维护
- 模板可人工调整顺序、数量和理由

支持操作：

- 模板列表
- 新建模板
- 编辑模板
- 删除模板
- 复制模板
- 按经销商筛选
- 按场景筛选
- 启用 / 停用

模板场景建议：

- `daily_recommendation`
- `weekly_focus`
- `threshold_topup`
- `box_pair_optimization`

模板字段建议：

- `template_id`
- `customer_id`
- `template_name`
- `scene`
- `reference_items`
- `business_notes`
- `style_hint`
- `priority`
- `enabled`

其中 `reference_items` 建议结构：

```json
[
  {
    "sku_id": "cb_weijixian_500",
    "qty": 12,
    "reason": "该客户进入常规补货周期，味极鲜属于高频动销品。",
    "reason_tags": ["常购品", "补货周期", "高频动销"],
    "sort_order": 1
  }
]
```

页面设计建议：

- 左侧模板列表
- 中部模板表单
- 右侧 Prompt 预览区

Prompt 预览区展示：

- 当前模板如何拼入 Prompt
- 当前参考商品顺序
- 当前业务说明

模板用途说明：

这些模板不会直接返回给前台，而是以“参考建议单样例 / few-shot reference”的方式拼进 Prompt，帮助模型输出更贴近业务预期的话术、顺序和数量。

### 7.6 活动管理页 `/admin/campaigns`

目标：维护每周主推、新品、活动门槛等。

支持操作：

- 活动列表
- 新增活动
- 编辑活动
- 删除活动
- 启用 / 停用

活动字段建议：

- `campaign_id`
- `week_id`
- `campaign_name`
- `weekly_focus_items`
- `promo_threshold`
- `promo_type`
- `activity_notes`
- `target_customer_types`
- `status`

### 7.7 规则管理页 `/admin/rules`

目标：维护推荐和凑单的业务规则阈值。

支持配置：

- 补货阈值天数
- 门槛补齐触发差额
- 免运费门槛金额
- 是否优先常购品
- 是否优先搭配品
- 是否允许箱规补齐
- 箱规接近阈值
- 新品推荐开关

建议分组：

- 补货规则
- 凑单规则
- 箱规规则
- 搭配规则
- 活动规则

### 7.8 Prompt 配置页 `/admin/prompts`

目标：让业务方能直接修改 Prompt 文案，而不是改代码。

支持配置：

- 全局系统角色
- 建议单 Prompt
- 凑单 Prompt
- 解释 Prompt
- 风格偏好
- 禁用词
- 原因条数限制

页面能力：

- 文本编辑
- 一键恢复默认
- JSON 配置查看
- 当前 Prompt 预览
- 与当前经销商 / 场景拼装后的最终 Prompt 预览

### 7.9 报表页 `/admin/reports`

目标：展示演示效果和 AI 运行情况。

页面区块：

- 概览 KPI 卡片
- 业务效果报表
- AI 调用报表
- 配置使用报表
- 最近事件流水
- Langfuse 跳转入口

---

## 8. 后台配置内容清单

后台建议至少配置以下 8 类内容：

1. 商品主数据
2. 经销商画像
3. 经销商建议单模板
4. 活动配置
5. 业务规则
6. Prompt 配置
7. UI 演示文案配置
8. 指标事件查看与重置

其中前 6 类建议作为正式配置对象进入数据模型；第 7、8 类可视项目时间决定是否做简化版。

---

## 9. 数据设计

### 9.1 总体原则

这次所有数据都可以只放内存中，但要模拟出“像后台系统一样”的数据结构。建议采用：

- 初始数据从本地 `data/*.json` 加载
- 应用运行后读入 `memory store`
- 所有后台 CRUD 都直接改内存
- 重启服务后恢复初始数据

### 9.2 内存态总存储结构

```ts
type AppMemoryStore = {
  products: ProductEntity[];
  dealers: DealerEntity[];
  suggestionTemplates: DealerSuggestionTemplateEntity[];
  campaigns: CampaignEntity[];
  rules: RuleConfigEntity;
  promptConfig: PromptConfigEntity;
  uiConfig: UIConfigEntity;
  metrics: MetricsStore;
  recommendationRuns: RecommendationRunRecord[];
  recommendationItems: RecommendationItemRecord[];
  auditLogs: AuditLogEvent[];
};
```

### 9.3 商品实体

```ts
type ProductEntity = {
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
  created_at: string;
  updated_at: string;
};
```

### 9.4 经销商实体

```ts
type DealerEntity = {
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
  frequent_items: string[];
  forbidden_items: string[];
  preferred_categories: string[];
  business_traits: string[];
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};
```

### 9.5 经销商建议单模板实体

```ts
type DealerSuggestionTemplateEntity = {
  template_id: string;
  customer_id: string;
  template_name: string;
  scene:
    | "daily_recommendation"
    | "weekly_focus"
    | "threshold_topup"
    | "box_pair_optimization";
  reference_items: Array<{
    sku_id: string;
    qty: number;
    reason: string;
    reason_tags: string[];
    sort_order: number;
  }>;
  business_notes: string;
  style_hint: string;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
```

### 9.6 活动实体

```ts
type CampaignEntity = {
  campaign_id: string;
  week_id: string;
  campaign_name: string;
  weekly_focus_items: string[];
  promo_threshold: number;
  promo_type: string;
  activity_notes: string[];
  target_customer_types: string[];
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};
```

### 9.7 规则实体

```ts
type RuleConfigEntity = {
  replenishment_days_threshold: number;
  cart_gap_trigger_amount: number;
  threshold_amount: number;
  prefer_frequent_items: boolean;
  prefer_pair_items: boolean;
  box_adjust_if_close: boolean;
  box_adjust_distance_limit: number;
  allow_new_product_recommendation: boolean;
};
```

### 9.8 Prompt 配置实体

```ts
type PromptConfigEntity = {
  global_style: {
    tone: string;
    avoid: string[];
    reason_limit: number;
  };
  recommendation_prompt: {
    system_role: string;
    instruction: string;
  };
  cart_opt_prompt: {
    system_role: string;
    instruction: string;
  };
  explain_prompt: {
    system_role: string;
    instruction: string;
  };
};
```

### 9.9 UI 文案配置实体

建议额外增加一份 UI 可配置内容，让演示时能快速换话术。

```ts
type UIConfigEntity = {
  product_title: string;
  homepage_banner: string;
  recommendation_section_title: string;
  weekly_focus_title: string;
  cart_panel_title: string;
  confirm_summary_title: string;
};
```

### 9.10 审计日志实体

后台既然允许 CRUD，建议补一份轻量审计日志，仍然只放内存。

```ts
type AuditLogEvent = {
  id: string;
  timestamp: string;
  entity_type:
    | "product"
    | "dealer"
    | "suggestion_template"
    | "campaign"
    | "rule"
    | "prompt";
  entity_id: string;
  action: "create" | "update" | "delete" | "toggle";
  summary: string;
};
```

---

## 10. CRUD 设计

### 10.1 CRUD 原则

- 所有后台对象均支持列表、查看、新建、编辑、删除
- 删除优先做软删除或停用，避免演示数据消失过快
- 每次 CRUD 都写入审计日志
- 每次配置变更都更新 `updated_at`

### 10.2 商品 CRUD

支持：

- `Create Product`
- `Read Product`
- `Update Product`
- `Delete Product`
- `Toggle Product Status`

校验规则：

- `sku_name` 必填
- `price_per_case` 必须大于 0
- `box_multiple` 必须大于 0
- `pair_items` 只能选择已存在商品

### 10.3 经销商 CRUD

支持：

- `Create Dealer`
- `Read Dealer`
- `Update Dealer`
- `Delete Dealer`
- `Clone Dealer`

校验规则：

- `customer_name` 必填
- `frequent_items` 至少 1 个
- `frequent_items` 与 `forbidden_items` 不能冲突

### 10.4 建议单模板 CRUD

支持：

- `Create Suggestion Template`
- `Read Suggestion Template`
- `Update Suggestion Template`
- `Delete Suggestion Template`
- `Clone Suggestion Template`
- `Reorder Reference Items`

校验规则：

- 模板必须绑定经销商
- 模板必须绑定场景
- 模板至少有 1 个参考商品
- 参考商品必须在商品主数据中存在

### 10.5 活动 CRUD

支持：

- `Create Campaign`
- `Read Campaign`
- `Update Campaign`
- `Delete Campaign`

### 10.6 规则 CRUD

POC 可以把规则管理做成单实例配置，不必做多版本列表。

支持：

- 查看规则
- 编辑规则
- 恢复默认规则

### 10.7 Prompt CRUD

Prompt 配置同样建议做单实例配置。

支持：

- 查看 Prompt 配置
- 编辑 Prompt 配置
- 恢复默认 Prompt
- 预览最终 Prompt

---

## 11. AI 与 Prompt 设计

### 11.1 AI 在系统中的职责

AI 只负责：

- 对候选商品做建议组织和排序
- 输出结构化建议单
- 输出业务化理由
- 输出凑单说明

AI 不负责：

- 真实计算
- 复杂约束求解
- 金额计算
- 箱规判断
- 规则命中判断

这些工作都在规则层完成。

### 11.2 Prompt 组装原则

Prompt 不应写死在代码里，而应由以下内容拼接而成：

1. 系统角色 Prompt
2. 场景说明 Prompt
3. 全局风格 Prompt
4. 当前经销商画像
5. 当前商品知识
6. 当前活动与规则
7. 当前经销商建议单模板
8. 当前候选商品 / 当前购物车上下文
9. 输出 schema 约束

### 11.3 经销商建议单模板如何进入 Prompt

这一点是本次设计的关键。

建议在 Prompt 中加入一段显式参考说明：

```text
以下是该经销商在当前场景下的人工建议单参考样例，仅供你参考输出风格、商品优先级和理由表达，不要求逐条照搬。你需要结合当前客户画像、活动和规则重新生成建议。
```

然后把模板内容序列化后拼进 Prompt。

这样做的好处：

- 推荐结果更贴近业务预期
- 便于业务方通过后台直接调优
- 不会把模板写死成固定结果

### 11.4 结构化输出要求

建议单输出：

```json
{
  "scenario": "daily_recommendation",
  "items": [
    {
      "sku_id": "cb_weijixian_500",
      "item_name": "厨邦味极鲜特级生抽 500ml",
      "qty": 12,
      "reason": "该客户近期已进入常规补货周期，且味极鲜属于高频动销品。",
      "reason_tags": ["常购品", "补货周期", "高频动销"],
      "action_type": "add_to_cart",
      "priority": 1
    }
  ]
}
```

购物车优化输出：

```json
{
  "thresholdSuggestion": {
    "sku_id": "cb_chicken_essence_200",
    "item_name": "厨邦鸡精 200g",
    "qty": 1,
    "reason": "再补 1 箱可达到免运费门槛，且属于该客户常购搭配品。",
    "effect": "达到免运费门槛"
  },
  "boxAdjustments": [
    {
      "sku_id": "cb_jinbiao_shengchou_500",
      "from_qty": 5,
      "to_qty": 6,
      "reason": "调整为整箱倍数更利于配送和备货。"
    }
  ],
  "pairSuggestions": [
    {
      "sku_id": "cb_chicken_essence_200",
      "qty": 1,
      "reason": "蚝油与鸡精在该客户历史采购中常一起出现。"
    }
  ]
}
```

### 11.5 模型调用封装

建议统一封装成：

- `generateRecommendation()`
- `generateCartOptimization()`
- `generateExplanation()`

统一封装的好处：

- Prompt 管理集中
- Schema 校验集中
- Telemetry 配置一致
- Langfuse metadata 一致

---

## 12. 推荐与凑单流程设计

### 12.1 首页建议单流程

1. 读取经销商画像
2. 读取活动配置
3. 读取商品主数据
4. 读取该经销商的建议单模板
5. 根据规则筛选候选商品
6. 拼接 Prompt
7. 调用 AI SDK 输出结构化建议
8. 写入指标
9. 返回前端

### 12.2 购物车优化流程

1. 读取购物车
2. 计算总金额与门槛差额
3. 根据规则筛选门槛补齐候选
4. 检查箱规修正候选
5. 检查搭配候选
6. 读取该经销商相关模板
7. 拼接 Prompt
8. 调用 AI SDK 输出结构化优化建议
9. 写入指标
10. 返回前端

### 12.3 查看推荐原因流程

1. 读取目标建议项
2. 读取经销商画像、活动和模板上下文
3. 调用 AI 生成解释文案
4. 写入指标
5. 返回前端

---

## 13. 指标统计设计

### 13.1 目标

报表不是附属信息，而是 POC 的一部分。它要让客户看到：

- 系统推荐有多少被采用
- 凑单建议是否带来了金额提升
- 哪类客户更容易接受建议
- AI 调用的耗时和 token 情况

### 13.2 指标存储方式

全部放内存：

```ts
type MetricsStore = {
  sessionCount: number;
  recommendationRequests: number;
  weeklyFocusRequests: number;
  cartOptimizationRequests: number;
  explanationRequests: number;
  addToCartFromSuggestion: number;
  applyOptimizationCount: number;
  thresholdReachedCount: number;
  boxAdjustmentCount: number;
  pairSuggestionAppliedCount: number;
  totalCartAmountBefore: number;
  totalCartAmountAfter: number;
  totalRevenueLift: number;
  averageModelLatencyMs: number;
  totalModelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  structuredOutputFailureCount: number;
  customerSceneBreakdown: Record<string, number>;
  latestEvents: MetricEvent[];
};
```

### 13.2.1 推荐记录明细存储

除了聚合指标，还建议单独维护一份“推荐记录事实表”。这张表的目标不是做概览统计，而是记录每一次推荐到底推荐了什么、模型返回了什么、用户是否采纳、最终带来了什么效果。

这部分非常适合做成一个可查询报表页。

建议拆成两层：

- 推荐批次记录：记录某次推荐请求整体信息
- 推荐条目记录：记录该次推荐返回的每一条建议项

推荐批次记录建议结构：

```ts
type RecommendationRunRecord = {
  recommendation_run_id: string;
  session_id: string;
  trace_id?: string;
  customer_id: string;
  customer_name: string;
  scene:
    | "daily_recommendation"
    | "weekly_focus"
    | "threshold_topup"
    | "box_pair_optimization";
  page_name: "/" | "/order" | "/cart";
  trigger_source: "auto" | "manual" | "assistant";
  template_id?: string;
  template_name?: string;
  prompt_version?: string;
  prompt_snapshot: string;
  candidate_sku_ids: string[];
  returned_sku_ids: string[];
  cart_amount_before?: number;
  cart_amount_after?: number;
  model_name: string;
  model_latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  status: "generated" | "partially_applied" | "fully_applied" | "ignored";
  created_at: string;
  updated_at: string;
};
```

推荐条目记录建议结构：

```ts
type RecommendationItemRecord = {
  recommendation_item_id: string;
  recommendation_run_id: string;
  customer_id: string;
  scene:
    | "daily_recommendation"
    | "weekly_focus"
    | "threshold_topup"
    | "box_pair_optimization";
  sku_id: string;
  sku_name: string;
  suggested_qty: number;
  suggested_rank: number;
  reason: string;
  reason_tags: string[];
  action_type: "add_to_cart" | "adjust_qty" | "replace_item";
  effect_type?:
    | "replenishment"
    | "weekly_focus"
    | "threshold_reached"
    | "box_adjustment"
    | "pair_item";
  was_viewed: boolean;
  was_explained: boolean;
  was_applied: boolean;
  applied_qty?: number;
  applied_at?: string;
  applied_by: "user" | "system" | "unknown";
  ignored_at?: string;
  rejected_reason?: string;
  order_submitted_with_item?: boolean;
  final_status: "pending" | "applied" | "ignored" | "rejected" | "expired";
  created_at: string;
  updated_at: string;
};
```

### 13.3 事件模型

```ts
type MetricEvent = {
  id: string;
  timestamp: string;
  customerId: string;
  customerName: string;
  eventType:
    | "recommendation_generated"
    | "weekly_focus_generated"
    | "recommendation_applied"
    | "cart_optimized"
    | "threshold_reached"
    | "box_adjusted"
    | "pair_item_added"
    | "explanation_viewed"
    | "config_updated";
  scene:
    | "daily_recommendation"
    | "weekly_focus"
    | "threshold_topup"
    | "box_pair_optimization"
    | "admin_config";
  payload: Record<string, unknown>;
};
```

### 13.4 指标分类

#### 业务效果指标

- 建议单生成次数
- 推荐批次记录数
- 推荐条目记录数
- 建议单点击次数
- 建议单加购次数
- 建议单采纳率
- 推荐忽略次数
- 推荐拒绝次数
- 推荐部分采纳次数
- 凑单建议生成次数
- 凑单建议应用次数
- 达到免运费次数
- 箱规修正次数
- 搭配建议应用次数
- 订单金额提升总额
- 平均订单金额优化值

#### AI 运行指标

- AI 请求次数
- 平均响应时长
- 平均输入 token
- 平均输出 token
- 结构化输出失败次数
- 各场景调用分布

#### 配置运营指标

- 商品总数
- 启用商品数
- 经销商总数
- 启用模板数
- 今日配置变更次数
- 最近 20 条配置审计日志

### 13.5 报表页设计

报表页 `/admin/reports` 建议分 4 个板块。

#### 板块 A：概览卡片

- 今日建议单生成数
- 今日建议单采纳数
- 今日凑单应用数
- 今日订单金额提升
- AI 平均耗时
- 当前经销商数

#### 板块 B：业务效果报表

建议展示：

- 不同经销商建议采纳率
- 不同场景使用次数
- 免运费达成次数
- 箱规修正次数

展示形式：

- 柱状图
- 饼图
- 表格

#### 板块 C：AI 调用报表

建议展示：

- 各接口调用次数
- 平均耗时
- token 消耗
- 结构化失败次数

#### 板块 D：事件流水

表格字段建议：

- 时间
- 经销商
- 事件类型
- 场景
- 关键摘要

### 13.5.1 推荐记录报表

建议在 `/admin/reports` 下再增加一个二级视图，或独立页面 `/admin/reports/recommendations`，专门查询每次推荐记录。

这个页面的定位是：

- 查某次推荐到底输出了什么
- 查某个经销商最近被推荐了什么
- 查哪些推荐被采纳了
- 查哪些推荐长期不被采纳
- 查推荐结果与最终订单之间的关系

建议支持的筛选条件：

- 时间范围
- 经销商
- 场景
- 推荐状态
- SKU
- 是否采纳
- 是否达成效果
- 模型名称

建议展示两层视图：

#### 视图 A：推荐批次列表

一行代表一次推荐请求。

字段建议：

- 推荐时间
- 推荐批次 ID
- 经销商
- 页面
- 场景
- 候选商品数
- 返回商品数
- 是否有采纳
- 采纳件数
- 推荐前金额
- 推荐后金额
- 模型耗时
- trace_id

#### 视图 B：推荐条目明细

点开批次后查看该次推荐的每一条建议项。

字段建议：

- SKU 名称
- 建议数量
- 推荐排序
- 推荐理由
- 推荐标签
- 动作类型
- 是否查看
- 是否解释
- 是否采纳
- 实际采纳数量
- 最终状态
- 是否随订单提交

### 13.5.2 推荐记录生命周期

每次推荐建议都建议按生命周期更新，而不是只记录生成时一条静态数据。

推荐生命周期建议如下：

1. `generated`
2. `viewed`
3. `explained`
4. `applied` / `ignored` / `rejected`
5. `submitted_with_order` 或 `expired`

这样报表里就可以查询：

- 推荐生成了但没看
- 看了但没采纳
- 采纳了但最终没下单
- 采纳后最终一起提交了订单

### 13.5.3 推荐记录与 Langfuse 关联

建议每条推荐批次记录都保存：

- `recommendation_run_id`
- `trace_id`
- `template_id`
- `prompt_version`

这样可以从报表直接跳到 Langfuse，对应查看：

- 这次推荐的 Prompt
- 这次推荐参考了哪个模板
- 这次推荐的模型输出原文
- 这次推荐的规则命中过程

### 13.6 KPI 计算方式

建议单采纳率：

```text
建议单采纳率 = 建议单加购次数 / 建议单生成次数
```

凑单应用率：

```text
凑单应用率 = 凑单建议应用次数 / 凑单建议生成次数
```

订单金额提升：

```text
订单金额提升 = 应用建议后的订单金额 - 应用建议前的订单金额
```

平均模型耗时：

```text
平均模型耗时 = 模型总耗时 / 模型调用次数
```

---

## 14. Langfuse 全链路设计

### 14.1 目标

Langfuse 要能看到“完整业务链路”，而不是只看到单个 LLM span。

需要覆盖：

- 页面请求入口
- 配置读取
- 规则筛选
- Prompt 组装
- 模型调用
- 输出校验
- 指标写入
- 用户应用建议

### 14.2 实现方式

建议两层结合：

#### 第一层：AI SDK Telemetry

在 `generateText` / `streamText` 调用中开启：

- `experimental_telemetry.isEnabled = true`
- `functionId`
- `metadata`

这一层记录模型调用与 token 等。

#### 第二层：Langfuse 手工 Observation

在业务入口创建 observation，把规则处理、配置读取、指标写入等非 LLM 节点也记录为 span。

### 14.3 关键链路

#### Trace A：首页建议单生成

根节点：

- `homepage.generate-recommendations`

子节点：

- `load.dealer`
- `load.products`
- `load.campaigns`
- `load.suggestion-template`
- `load.prompt-config`
- `rules.filter-replenishment-candidates`
- `rules.filter-weekly-focus-candidates`
- `prompt.compose`
- `ai.generate-daily-recommendation`
- `ai.generate-weekly-focus`
- `validate.output-schema`
- `metrics.record-recommendation-generated`

#### Trace B：购物车优化生成

根节点：

- `cart.generate-optimization`

子节点：

- `load.cart`
- `load.dealer`
- `load.suggestion-template`
- `rules.calculate-cart-gap`
- `rules.find-threshold-topup-candidates`
- `rules.find-box-adjustments`
- `rules.find-pair-items`
- `prompt.compose`
- `ai.generate-cart-optimization`
- `validate.output-schema`
- `metrics.record-cart-optimization`

#### Trace C：应用建议

根节点：

- `cart.apply-optimization`

子节点：

- `cart.apply-item-change`
- `cart.recalculate-summary`
- `metrics.record-optimization-applied`
- `metrics.record-threshold-reached`

#### Trace D：查看推荐原因

根节点：

- `recommendation.explain`

子节点：

- `load.recommendation-context`
- `load.suggestion-template`
- `prompt.compose`
- `ai.generate-explanation`
- `metrics.record-explanation-view`

#### Trace E：后台配置变更

根节点：

- `admin.update-config`

子节点：

- `validate.form`
- `memory.update-entity`
- `audit.write`
- `metrics.record-config-update`

### 14.4 Trace 标签建议

每条 trace / span 建议带上：

- `customer_id`
- `customer_name`
- `page_name`
- `scene`
- `session_id`
- `cart_amount_before`
- `cart_amount_after`
- `threshold_amount`
- `selected_sku_ids`
- `applied_sku_ids`
- `template_id`
- `campaign_id`

### 14.5 Langfuse 中的价值

最终在 Langfuse 里可以回答这些问题：

- 为什么这次给厦门客户推荐了味极鲜和蚝油
- 这次推荐参考了哪个建议模板
- 是哪条规则命中了候选商品
- 模型输出了什么结构化结果
- 用户有没有应用建议
- 应用后购物车金额有没有提升

---

## 15. API 设计

### 15.1 前台业务接口

#### `POST /api/recommendations`

输入：

```json
{
  "customerId": "dealer_xm_sm"
}
```

输出：

```json
{
  "dailyRecommendations": [],
  "weeklyFocusRecommendations": [],
  "summary": {}
}
```

#### `POST /api/cart-optimize`

输入：

```json
{
  "customerId": "dealer_xm_sm",
  "cartItems": []
}
```

输出：

```json
{
  "thresholdSuggestion": {},
  "boxAdjustments": [],
  "pairSuggestions": [],
  "summary": {}
}
```

#### `POST /api/explain`

输入：

```json
{
  "customerId": "dealer_xm_sm",
  "scene": "daily_recommendation",
  "targetItemIds": ["cb_weijixian_500"]
}
```

### 15.2 后台接口

#### 商品接口

- `GET /api/admin/products`
- `POST /api/admin/products`
- `GET /api/admin/products/:id`
- `PATCH /api/admin/products/:id`
- `DELETE /api/admin/products/:id`

#### 经销商接口

- `GET /api/admin/dealers`
- `POST /api/admin/dealers`
- `GET /api/admin/dealers/:id`
- `PATCH /api/admin/dealers/:id`
- `DELETE /api/admin/dealers/:id`

#### 建议单模板接口

- `GET /api/admin/suggestion-templates`
- `POST /api/admin/suggestion-templates`
- `GET /api/admin/suggestion-templates/:id`
- `PATCH /api/admin/suggestion-templates/:id`
- `DELETE /api/admin/suggestion-templates/:id`

#### 活动接口

- `GET /api/admin/campaigns`
- `POST /api/admin/campaigns`
- `PATCH /api/admin/campaigns/:id`
- `DELETE /api/admin/campaigns/:id`

#### 规则接口

- `GET /api/admin/rules`
- `PATCH /api/admin/rules`

#### Prompt 接口

- `GET /api/admin/prompts`
- `PATCH /api/admin/prompts`

#### 报表接口

- `GET /api/admin/reports/summary`
- `GET /api/admin/reports/events`
- `GET /api/admin/reports/audit-logs`
- `GET /api/admin/reports/recommendations`
- `GET /api/admin/reports/recommendations/:id`

---

## 16. 项目结构建议

```text
app/
  page.tsx
  order/page.tsx
  cart/page.tsx
  confirm/page.tsx
  admin/
    dashboard/page.tsx
    products/page.tsx
    dealers/page.tsx
    suggestion-templates/page.tsx
    campaigns/page.tsx
    rules/page.tsx
    prompts/page.tsx
    reports/page.tsx
  api/
    recommendations/route.ts
    cart-optimize/route.ts
    explain/route.ts
    admin/
      products/route.ts
      products/[id]/route.ts
      dealers/route.ts
      dealers/[id]/route.ts
      suggestion-templates/route.ts
      suggestion-templates/[id]/route.ts
      campaigns/route.ts
      campaigns/[id]/route.ts
      rules/route.ts
      prompts/route.ts
      reports/summary/route.ts
      reports/events/route.ts
      reports/audit-logs/route.ts

components/
  customer-switcher.tsx
  suggestion-card.tsx
  optimization-panel.tsx
  metrics-overview.tsx
  admin/
    data-table.tsx
    product-form.tsx
    dealer-form.tsx
    suggestion-template-form.tsx
    prompt-editor.tsx
    report-cards.tsx
    event-log-table.tsx

data/
  products.json
  dealers.json
  campaigns.json
  rules.json
  prompt-config.json
  suggestion-templates.json
  ui-config.json

lib/
  ai/
    prompts.ts
    schemas.ts
    service.ts
  domain/
    recommendation-rules.ts
    cart-rules.ts
  memory/
    store.ts
    seed.ts
  metrics/
    store.ts
    recorder.ts
    report-builder.ts
  admin/
    validation.ts
    crud-service.ts
    audit.ts
  tracing/
    observation.ts

instrumentation.ts
```

---

## 17. 演示脚本建议

### 第一幕：后台快速配置

- 进入商品管理页，展示商品可增删改
- 进入经销商管理页，展示不同客户画像
- 进入建议单模板页，展示“经销商建议单参考模板”
- 进入 Prompt 配置页，展示推荐话术可改

### 第二幕：首页建议单

- 切换到厦门客户
- 展示常规补货建议
- 展示本周重点推荐
- 点开推荐原因
- 选 2 个商品加入购物车

### 第三幕：购物车优化

- 展示差额补齐建议
- 展示箱规修正建议
- 展示搭配补充建议
- 一键应用建议

### 第四幕：提交确认

- 展示本单优化说明
- 展示优化后金额

### 第五幕：报表与链路

- 打开报表页
- 展示建议采纳率和金额提升
- 打开 Langfuse trace
- 展示完整链路

---

## 18. 实施优先级

### Phase 1：骨架

- 初始化 Next.js 工程
- 接入 Vercel AI SDK
- 接入 Langfuse
- 搭建前后台路由壳子

### Phase 2：基础数据与后台 CRUD

- 商品管理
- 经销商管理
- 建议单模板管理
- 活动与规则管理
- Prompt 配置管理

### Phase 3：AI 业务能力

- 首页建议单
- 购物车优化
- 推荐解释
- 结构化输出校验

### Phase 4：报表与链路

- 内存指标统计
- 报表页
- 审计日志
- Langfuse 全链路标签

---

## 19. 实施补充规格

这一节用于补足“可以开始搭骨架”和“可以进入完整实现”之间的缺口。下面内容是后续工程实施时必须遵守的落地规格。

### 19.1 页面级验收标准

每个页面都必须明确成功态、空态、加载态、错误态，以及最小必做动作。

#### 首页 `/`

成功态必须满足：

- 可以切换 3 个经销商
- 可以展示今日建议补货和本周重点推荐两块内容
- 每条推荐至少展示商品名、数量、原因摘要、操作按钮
- 支持单条加入购物车
- 支持全部加入购物车
- 支持查看推荐原因

空态要求：

- 当某场景无推荐结果时，展示“当前无建议，可前往下单页自主选品”

加载态要求：

- 首次切换经销商时有 skeleton 或 loading 卡片

错误态要求：

- 推荐接口失败时展示“推荐生成失败，请重试”
- 页面提供重试按钮

完成标准：

- 至少 2 类推荐可正常展示
- 任一推荐可成功写入推荐记录报表

#### 下单页 `/order`

成功态必须满足：

- 可查看商品列表
- 可按分类和关键词筛选商品
- 可加入购物车
- 可看到购物车预览
- 可触发 AI 快捷操作

空态要求：

- 搜索结果为空时展示无结果提示

错误态要求：

- 商品数据读取失败时展示错误提示和重试按钮

完成标准：

- 商品搜索、加购、购物车预览三条路径可闭环

#### 购物车页 `/cart`

成功态必须满足：

- 展示购物车明细
- 展示总金额和门槛差额
- 展示门槛补齐、箱规修正、搭配补充建议
- 可应用建议
- 可删除或调整商品数量

空态要求：

- 购物车为空时展示返回首页和前往下单页按钮

错误态要求：

- 优化接口失败时展示“优化建议生成失败”
- 已生成的购物车明细不能丢失

完成标准：

- 至少 1 个优化建议可应用
- 应用后金额、推荐记录、指标统计同步更新

#### 提交确认页 `/confirm`

成功态必须满足：

- 展示订单摘要
- 展示本单优化说明
- 展示最终金额
- 支持确认提交和返回修改

空态要求：

- 若无购物车数据，禁止进入确认流程

完成标准：

- 确认提交后，推荐记录中相关已采纳项状态更新为 `submitted_with_order`

#### 后台 CRUD 页通用验收标准

商品、经销商、建议模板、活动页必须满足：

- 列表展示
- 新建
- 编辑
- 删除或停用
- 成功提示
- 表单校验提示

空态要求：

- 列表为空时提供“新建”入口

错误态要求：

- 表单校验失败展示字段级错误
- 服务端失败展示全局错误提示

完成标准：

- 任一 CRUD 操作都必须写入审计日志

#### 报表页验收标准

成功态必须满足：

- 可展示聚合 KPI
- 可展示推荐记录批次表
- 可展开查看推荐条目明细
- 可根据筛选条件查询
- 可跳转 Langfuse trace

完成标准：

- 至少可以查询到一次首页推荐批次
- 至少可以查询到一次购物车优化批次

### 19.2 本地运行与环境变量

在开始脚手架前，建议明确以下环境变量：

- `OPENAI_API_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_BASE_URL`
- `NEXT_PUBLIC_APP_NAME`

如果后续使用 AI Gateway，再补：

- `AI_GATEWAY_API_KEY`

POC 阶段允许在缺失 Langfuse 配置时降级运行，但必须在 UI 或日志中明确标记“观测未启用”。

## 20. 接口、状态流与 Seed 数据补充规格

### 20.1 API 响应约定

所有接口统一返回以下结构之一。

成功响应：

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数校验失败",
    "fieldErrors": {
      "sku_name": "商品名称不能为空"
    }
  }
}
```

状态码约定：

- `200` 查询成功
- `201` 创建成功
- `400` 参数错误
- `404` 资源不存在
- `409` 状态冲突或重复操作
- `500` 服务端错误

### 20.2 列表接口约定

后台列表接口统一支持以下查询参数：

- `page`
- `pageSize`
- `q`
- `status`
- `sortBy`
- `sortOrder`

列表响应统一包含：

- `items`
- `total`
- `page`
- `pageSize`

推荐记录报表额外支持：

- `dateFrom`
- `dateTo`
- `customerId`
- `scene`
- `skuId`
- `adoptionStatus`
- `modelName`

### 20.3 后台 CRUD 变更语义

POC 里默认采用“内存软删除优先”的语义：

- 商品删除默认改为 `inactive`
- 经销商删除默认改为 `inactive`
- 建议模板删除默认改为 `enabled = false`
- 活动删除默认改为 `inactive`

只有在明确调用“永久删除”模式时才从内存中移除，但第一版可以不开放永久删除。

### 20.4 运行时状态源定义

为避免前后端状态歧义，运行时状态定义如下：

- 配置主数据源：服务端内存 `AppMemoryStore`
- 购物车主数据源：服务端内存中的 session-scoped cart
- 前端状态：仅作为界面镜像缓存，不作为最终真值

每次页面刷新后，前端都应从服务端当前 session 状态重新拉取。

### 20.5 推荐记录生命周期定义

推荐批次状态：

- `generated`
- `partially_applied`
- `fully_applied`
- `ignored`

推荐条目状态：

1. `pending`
2. `viewed`
3. `explained`
4. `applied`
5. `ignored`
6. `rejected`
7. `submitted_with_order`
8. `expired`

状态触发规则：

- 推荐接口返回成功时，批次记录创建为 `generated`，条目记录创建为 `pending`
- 用户点击查看原因时，条目 `was_viewed = true`
- 用户打开解释抽屉或调用解释接口时，条目 `was_explained = true`
- 用户点击应用建议且购物车更新成功时，条目变为 `applied`
- 用户明确点击“不采纳/忽略”时，条目变为 `ignored` 或 `rejected`
- 用户提交订单且该条目仍在最终订单中时，条目变为 `submitted_with_order`
- 当同场景生成新推荐批次且旧条目仍为 `pending` 时，旧条目变为 `expired`

### 20.6 幂等与重复操作规则

- 同一推荐条目重复点击“应用建议”不得重复叠加数量
- `add_to_cart` 类型第一次应用后，后续重复点击视为 no-op
- `adjust_qty` 类型第一次应用后，后续重复点击如果目标数量未变，也视为 no-op
- 对已 `ignored` 或 `rejected` 的条目，不允许再次自动应用，除非用户显式恢复

### 20.7 购物车同步规则

- 应用推荐后，购物车金额、优化摘要、推荐记录、聚合指标必须在同一事务式流程中更新
- 如果购物车更新成功但报表记录失败，接口返回失败并回滚购物车变化
- POC 第一版可用单进程内同步更新实现，不需要真实事务引擎

### 20.8 Seed 数据基线

开始实现前，初始数据文件必须至少包含：

- `products.json`: 20 条
- `dealers.json`: 3 条
- `campaigns.json`: 3 条
- `suggestion-templates.json`: 12 条
- `rules.json`: 1 条
- `prompt-config.json`: 1 条
- `ui-config.json`: 1 条

其中 `suggestion-templates.json` 采用：

- 3 个经销商
- 每个经销商 4 个场景模板

即：

- `daily_recommendation`
- `weekly_focus`
- `threshold_topup`
- `box_pair_optimization`

### 20.9 Seed 数据必备字段约束

每类 seed 数据都必须满足：

- 所有 ID 显式定义，不允许运行时自动推断
- 所有 `status` 或 `enabled` 字段显式定义
- 所有时间字段初始化为固定字符串
- 所有关联字段都必须引用已存在实体

模板 seed 数据必须满足：

- 每个模板至少 2 条参考商品
- 每条参考商品必须带 `reason`
- 每个模板必须带 `business_notes`
- 每个模板必须带 `style_hint`

## 21. 报表与观测补充规格

### 21.1 报表刷新与时间窗口

由于数据只保存在内存中，报表默认统计窗口定义为：

- `runtime_all`: 自应用启动以来
- `last_1h`
- `last_24h`

默认展示 `runtime_all`。

报表刷新策略：

- 页面首次进入主动拉取
- 支持手动刷新
- 默认每 `10` 秒自动刷新一次

### 21.2 推荐记录报表行为

推荐记录报表必须支持：

- 批次列表查询
- 批次详情抽屉
- 条目明细查询
- 按经销商、场景、状态、SKU、时间筛选
- 从批次跳转 Langfuse

批次列表默认排序：

- 按 `created_at desc`

### 21.3 报表重置规则

后台必须提供“重置运行时统计”能力，但要与配置主数据分离。

重置统计时清空：

- `metrics`
- `recommendationRuns`
- `recommendationItems`
- 报表事件流水

默认不清空：

- `products`
- `dealers`
- `suggestionTemplates`
- `campaigns`
- `rules`
- `promptConfig`

### 21.4 Langfuse 关联契约

每次推荐批次记录必须至少保存以下关联字段：

- `recommendation_run_id`
- `trace_id`
- `scene`
- `customer_id`
- `template_id`
- `prompt_version`
- `model_name`

每个核心 span 命名必须固定，不允许同一类动作使用多套名字。

推荐使用的顶级 trace 名：

- `homepage.generate-recommendations`
- `cart.generate-optimization`
- `recommendation.explain`
- `admin.update-config`
- `confirm.submit-order`

### 21.5 报表与 Langfuse 对账能力

报表页中每个推荐批次都应支持：

- 查看 recommendation_run_id
- 查看 trace_id
- 一键跳转 Langfuse

这样可以从报表直接核对：

- 当前报表中的推荐结果
- Langfuse 中对应的 Prompt 与输出
- 这次推荐最终有没有被采纳

## 22. 最终结论

这版 POC 已经不是单纯的 4 个前台页面，而是一套完整的“演示台 + 配置台 + 报表台”方案。

这次重点新增并明确了：

- 商品信息 CRUD
- 经销商信息 CRUD
- 经销商建议单模板 CRUD
- 活动、规则、Prompt 等可配置项
- 内存态指标报表
- 后台配置变更审计日志
- Langfuse 端到端全链路观测

这套设计能满足你当前最核心的目标：

- 前台能演示价值
- 后台能快速改数据
- Prompt 能由业务直接调整
- 报表能讲清结果
- Langfuse 能讲清过程

下一步就可以直接按这份文档开始搭工程。
