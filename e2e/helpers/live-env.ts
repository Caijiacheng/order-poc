const LIVE_REQUIRED_ENV_KEYS = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
] as const;

export type LiveEnvKey = (typeof LIVE_REQUIRED_ENV_KEYS)[number];

export function getMissingLiveEnvKeys(env: NodeJS.ProcessEnv = process.env): LiveEnvKey[] {
  return LIVE_REQUIRED_ENV_KEYS.filter((key) => !env[key]);
}

export function hasRequiredLiveEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getMissingLiveEnvKeys(env).length === 0;
}

export function getLiveSkipReason(env: NodeJS.ProcessEnv = process.env): string {
  const missing = getMissingLiveEnvKeys(env);
  if (missing.length === 0) {
    return "";
  }
  return `Missing required live env: ${missing.join(", ")}`;
}
