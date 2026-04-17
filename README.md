# AI 建议单 + 智能凑单 Demo

美味鲜 / 厨邦经销商采购 POC，聚焦三类角色的端到端演示闭环：

- 经销商：消费已发布建议并完成采购下单
- 运营：配置策略并批量生成/发布建议单
- IT 运维：追踪链路、审计变更、执行恢复

## Canonical 路由

前台（经销商）主流程：

- `/` -> `/purchase`
- `/purchase` -> `/order-submit`

后台（运营 / IT）主信息架构：

- `/admin` -> `/admin/workbench/overview`
- `/admin/master-data/products`
- `/admin/master-data/dealers`
- `/admin/master-data/segments`
- `/admin/master-data/product-pools`
- `/admin/strategy/campaigns`
- `/admin/strategy/recommendation-strategies`
- `/admin/strategy/expression-templates`
- `/admin/strategy/global-rules`
- `/admin/operations/generation-jobs`
- `/admin/operations/recommendation-batches`
- `/admin/analytics/overview`
- `/admin/analytics/recommendation-records`
- `/admin/observability/traces`
- `/admin/observability/audit-logs`
- `/admin/observability/recovery`

后台关键 CRUD 交互模式（本期统一）：

- `/admin/strategy/campaigns`
- `/admin/strategy/recommendation-strategies`
- `/admin/strategy/expression-templates`
- `/admin/operations/generation-jobs`
- 以上页面统一为“列表浏览 + Drawer 新建/编辑 + Confirm 停用/删除”

## 启动

1. 安装依赖

```bash
pnpm install
pnpm exec playwright install chromium
```

2. 准备环境变量

```bash
cp .env.example .env.local
```

3. 选择运行模式

- Mock 演示：`LLM_MOCK_MODE=true`
- Live 验证：`LLM_MOCK_MODE=false`，并补齐 `LLM_*`、`LANGFUSE_*`、`NEXT_PUBLIC_LANGFUSE_BASE_URL`

4. 启动开发服务器

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:mock
pnpm test:e2e:live
```

## Live E2E 环境变量注入

`pnpm test:e2e:live` 依赖当前 shell 的显式环境变量。仅有 `.env.local` 不一定能保证 Playwright live worker 与 webServer 进程读取到完整 `LLM_*` / `LANGFUSE_*`。

推荐在同一 shell 中先导出再执行：

```bash
export LLM_MOCK_MODE=false
export LLM_BASE_URL=...
export LLM_API_KEY=...
export LLM_MODEL=...
export LANGFUSE_BASE_URL=...
export LANGFUSE_PUBLIC_KEY=...
export LANGFUSE_SECRET_KEY=...
export NEXT_PUBLIC_LANGFUSE_BASE_URL=...
pnpm test:e2e:live
```

## 手工测试

完整手工路径见 [docs/manual-testing.md](/Users/caijiacheng/AIProject/order-poc/docs/manual-testing.md)（按经销商 / 运营 / IT 三角色组织）。

## 运行约束

- 数据为 mock + 内存态，重启应用后回到 seed 初始状态。
- 后台 CRUD、建议单记录、报表、审计日志均非持久化存储。
