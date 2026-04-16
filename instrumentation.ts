import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

declare global {
  var __ORDER_POC_OTEL_SDK__: NodeSDK | undefined;
  var __ORDER_POC_OTEL_HOOKS__: boolean | undefined;
}

function shouldEnableLangfuseTracing() {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY &&
      process.env.LANGFUSE_BASE_URL,
  );
}

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (globalThis.__ORDER_POC_OTEL_SDK__) {
    return;
  }

  if (!shouldEnableLangfuseTracing()) {
    console.info(
      "[instrumentation] Langfuse tracing disabled (missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL).",
    );
    return;
  }

  const sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? "local",
        release: process.env.LANGFUSE_RELEASE ?? "dev",
      }),
    ],
  });

  await Promise.resolve(sdk.start());
  globalThis.__ORDER_POC_OTEL_SDK__ = sdk;

  if (!globalThis.__ORDER_POC_OTEL_HOOKS__) {
    const shutdown = async () => {
      const activeSdk = globalThis.__ORDER_POC_OTEL_SDK__;
      if (!activeSdk) {
        return;
      }
      await activeSdk.shutdown();
      globalThis.__ORDER_POC_OTEL_SDK__ = undefined;
    };
    const processRef = globalThis.process;
    if (processRef?.on) {
      processRef.on("beforeExit", () => {
        void shutdown();
      });
      processRef.on("SIGTERM", () => {
        void shutdown();
      });
      processRef.on("SIGINT", () => {
        void shutdown();
      });
    }
    globalThis.__ORDER_POC_OTEL_HOOKS__ = true;
  }
}
