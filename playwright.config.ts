import { defineConfig } from "@playwright/test";
import { hasRequiredLiveEnv } from "./e2e/helpers/live-env";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_MODE = process.env.E2E_MODE ?? "mock";
const IS_LIVE_MODE = E2E_MODE === "live";

const LIVE_ENV = {
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? "",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_MODEL: process.env.LLM_MODEL ?? "",
  LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL ?? "",
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY ?? "",
  NEXT_PUBLIC_LANGFUSE_BASE_URL:
    process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL ?? process.env.LANGFUSE_BASE_URL ?? "",
};

const MOCK_ENV = {
  LLM_MOCK_MODE: "true",
  LLM_MODEL: "mock-e2e-model",
  NEXT_PUBLIC_LANGFUSE_BASE_URL: "https://mock-langfuse.local",
};

const LIVE_MODE_ENV = {
  ...LIVE_ENV,
  LLM_MOCK_MODE: "false",
};

const webServerEnv = {
  ...process.env,
  ...(IS_LIVE_MODE ? LIVE_MODE_ENV : MOCK_ENV),
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mock",
      testMatch: /mock\/.*\.spec\.ts/,
    },
    {
      name: "live",
      testMatch: /live\/.*\.spec\.ts/,
      timeout: 300_000,
      use: {
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
      },
    },
  ],
  webServer: {
    command: `pnpm run dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: webServerEnv,
  },
  metadata: {
    e2eMode: E2E_MODE,
    liveEnvReady: hasRequiredLiveEnv() ? "true" : "false",
  },
});
