# AI 建议单 + 智能凑单 Demo

美味鲜 / 厨邦 经销商下单 POC。

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

- Mock 手工测试：把 `.env.local` 里的 `LLM_MOCK_MODE` 设为 `true`
- Live 手工测试：把 `LLM_MOCK_MODE` 设为 `false`，并补齐 `LLM_*`、`LANGFUSE_*`、`NEXT_PUBLIC_LANGFUSE_BASE_URL`

4. 启动开发服务器

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:mock
pnpm test:e2e:live
```

## 手工测试说明

完整手工测试路径见：

- [docs/manual-testing.md](/Users/caijiacheng/AIProject/order-poc/docs/manual-testing.md)

## 说明

- 所有业务数据都在内存中，重启应用后会回到 seed 初始状态。
- 后台 CRUD、购物车、推荐记录、报表都不是持久化数据。
