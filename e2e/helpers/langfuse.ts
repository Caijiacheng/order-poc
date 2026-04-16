type LangfuseTraceResponse = {
  data?: {
    id?: string;
    name?: string;
  };
  id?: string;
  name?: string;
};

export type LangfuseTraceSummary = {
  id: string;
  name: string;
};

function toBasicAuthToken(publicKey: string, secretKey: string) {
  return Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
}

export async function fetchLangfuseTraceById(input: {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  traceId: string;
}): Promise<LangfuseTraceSummary | null> {
  const endpoint = new URL(`/api/public/traces/${input.traceId}`, input.baseUrl);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Basic ${toBasicAuthToken(input.publicKey, input.secretKey)}`,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Langfuse trace query failed (${response.status}) for trace ${input.traceId}.`,
    );
  }

  const payload = (await response.json()) as LangfuseTraceResponse;
  const record = payload.data ?? payload;
  const traceId = record.id ?? input.traceId;
  const traceName = record.name ?? "";

  return {
    id: traceId,
    name: traceName,
  };
}

export async function waitForLangfuseTrace(input: {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  traceId: string;
  expectedName: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<LangfuseTraceSummary> {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  let lastTrace: LangfuseTraceSummary | null = null;

  while (Date.now() < deadline) {
    lastTrace = await fetchLangfuseTraceById(input);
    if (lastTrace && lastTrace.name === input.expectedName) {
      return lastTrace;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!lastTrace) {
    throw new Error(
      `Trace ${input.traceId} not found in Langfuse before timeout (${timeoutMs}ms).`,
    );
  }

  throw new Error(
    `Trace ${input.traceId} found but name mismatch. Expected "${input.expectedName}", received "${lastTrace.name}".`,
  );
}
