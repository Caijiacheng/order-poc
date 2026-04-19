import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { copilotChatRequestSchema } from "@/lib/copilot/schemas";
import { runCopilotChat } from "@/lib/copilot/service";
import { SESSION_COOKIE_NAME } from "@/lib/cart/session";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";

function getUserMessageText(raw: unknown) {
  if (!Array.isArray(raw)) {
    return "";
  }
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const message = item as Record<string, unknown>;
    if (message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content.trim();
    }

    if (Array.isArray(message.parts)) {
      const text = message.parts
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const current = part as Record<string, unknown>;
          if (current.type === "text" && typeof current.text === "string") {
            return current.text;
          }
          return "";
        })
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const current = part as Record<string, unknown>;
          if (current.type === "text" && typeof current.text === "string") {
            return current.text;
          }
          return "";
        })
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function buildSessionCookieHeader(sessionId: string) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

async function handleStreamChat(rawBody: Record<string, unknown>) {
  const customerId = typeof rawBody.customerId === "string" ? rawBody.customerId : "";
  const pageName =
    rawBody.pageName === "/order-submit" ? "/order-submit" : "/purchase";
  const message = getUserMessageText(rawBody.messages);

  if (!customerId || !message) {
    return apiError("VALIDATION_ERROR", "copilot chat 参数不合法", 400, {
      payload: !customerId ? "缺少 customerId" : "缺少用户消息",
    });
  }

  const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
  const result = await runCopilotChat({
    session_id: sessionId,
    customer_id: customerId,
    user_message: message,
    page_name: pageName,
  });

  const textId = `copilot_chat_${randomUUID().replace(/-/g, "")}`;
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: "text-start",
        id: textId,
      });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: result.reply,
      });
      writer.write({
        type: "text-end",
        id: textId,
      });
    },
  });

  const response = createUIMessageStreamResponse({
    stream,
    headers: {
      "x-copilot-run-id": result.run.run_id,
      "x-copilot-trace-id": result.run.trace_id ?? "",
      "x-langfuse-base-url": process.env.LANGFUSE_BASE_URL ?? "",
    },
  });

  if (shouldSetCookie) {
    response.headers.append("Set-Cookie", buildSessionCookieHeader(sessionId));
  }
  return response;
}

export async function POST(request: Request) {
  try {
    assertLlmAvailable();
    const rawBody = (await request.json()) as Record<string, unknown>;

    // assistant-ui / AI SDK transport mode.
    const isAssistantUiTransportRequest =
      Array.isArray(rawBody.messages) ||
      "tools" in rawBody ||
      "trigger" in rawBody ||
      "config" in rawBody ||
      "system" in rawBody;

    if (isAssistantUiTransportRequest) {
      return handleStreamChat(rawBody);
    }

    // Existing JSON mode for direct API usage.
    const payload = copilotChatRequestSchema.safeParse(rawBody);
    if (!payload.success) {
      return apiError("VALIDATION_ERROR", "copilot chat 参数不合法", 400, {
        payload: payload.error.issues[0]?.message ?? "参数不合法",
      });
    }

    const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
    const result = await runCopilotChat({
      session_id: sessionId,
      customer_id: payload.data.customerId,
      user_message: payload.data.message,
      page_name: payload.data.pageName,
    });
    const response = apiSuccess(result, {
      session_id: sessionId,
      trace_id: result.run.trace_id,
      langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? "",
    });
    if (shouldSetCookie) {
      setSessionCookie(response, sessionId);
    }
    return response;
  } catch (error) {
    return handleBusinessRouteError(error);
  }
}
