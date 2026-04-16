import { loadSeedStore } from "../../lib/memory/seed";

const LLM_ENV_KEYS = [
  "LLM_MOCK_MODE",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
] as const;

type EnvSnapshot = Partial<Record<(typeof LLM_ENV_KEYS)[number], string | undefined>>;

function runtimeGlobals() {
  return globalThis as typeof globalThis & {
    __ORDER_POC_MEMORY_STORE__?: unknown;
    __ORDER_POC_LLM_FACTORY__?: unknown;
  };
}

export function resetRuntimeState() {
  const globals = runtimeGlobals();
  globals.__ORDER_POC_MEMORY_STORE__ = loadSeedStore();
  globals.__ORDER_POC_LLM_FACTORY__ = undefined;
}

export function captureLlmEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of LLM_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

export function restoreLlmEnv(snapshot: EnvSnapshot) {
  for (const key of LLM_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  runtimeGlobals().__ORDER_POC_LLM_FACTORY__ = undefined;
}

export function setMockLlmEnv(model = "mock-model") {
  process.env.LLM_MOCK_MODE = "true";
  process.env.LLM_MODEL = model;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  runtimeGlobals().__ORDER_POC_LLM_FACTORY__ = undefined;
}

export function setUnconfiguredRealLlmEnv() {
  process.env.LLM_MOCK_MODE = "false";
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  runtimeGlobals().__ORDER_POC_LLM_FACTORY__ = undefined;
}
