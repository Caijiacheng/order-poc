import { apiError, apiSuccess } from "@/lib/admin/api-response";
import { assertLlmAvailable } from "@/lib/ai/model-factory";
import { copilotChatRequestSchema } from "@/lib/copilot/schemas";
import { runCopilotChat } from "@/lib/copilot/service";
import type { CopilotImageInput } from "@/lib/copilot/types";
import { SESSION_COOKIE_NAME } from "@/lib/cart/session";
import { getOrCreateSessionId, setSessionCookie } from "@/lib/cart/session";
import { handleBusinessRouteError } from "@/lib/domain/route-errors";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { randomUUID } from "node:crypto";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeImageInput(raw: unknown, index: number): CopilotImageInput | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : "";
  const mimeType =
    typeof record.mimeType === "string" && record.mimeType.trim().length > 0
      ? record.mimeType.trim()
      : typeof record.mediaType === "string" && record.mediaType.trim().length > 0
        ? record.mediaType.trim()
        : "";
  const fileName =
    typeof record.fileName === "string" && record.fileName.trim().length > 0
      ? record.fileName.trim()
      : typeof record.filename === "string" && record.filename.trim().length > 0
        ? record.filename.trim()
        : `image_${index + 1}`;
  const dataUrl =
    typeof record.dataUrl === "string" && record.dataUrl.startsWith("data:")
      ? record.dataUrl
      : typeof record.image === "string" && record.image.startsWith("data:")
        ? record.image
        : typeof record.url === "string" && record.url.startsWith("data:")
          ? record.url
          : typeof record.data === "string" && record.data.startsWith("data:")
            ? record.data
            : "";

  if (!mimeType || !dataUrl) {
    return null;
  }

  return {
    id: id || `img_${index + 1}`,
    mimeType,
    fileName,
    dataUrl,
  };
}

function getUserMessageText(raw: unknown) {
  if (!Array.isArray(raw)) {
    return "";
  }
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const message = asRecord(raw[index]);
    if (!message || message.role !== "user") {
      continue;
    }

    if (typeof message.content === "string") {
      return message.content.trim();
    }

    const contentParts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [];
    const text = contentParts
      .map((part) => {
        const current = asRecord(part);
        if (!current) {
          return "";
        }
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

  return "";
}

function getUserMessageImages(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const message = asRecord(raw[index]);
    if (!message || message.role !== "user") {
      continue;
    }

    const contentParts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [];
    const images = contentParts
      .map((part, partIndex) => normalizeImageInput(part, partIndex))
      .filter((item): item is CopilotImageInput => Boolean(item));
    if (images.length > 0) {
      return images;
    }
  }

  return [];
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
  const rawImages = Array.isArray(rawBody.images) ? rawBody.images : [];
  const imagesFromPayload = rawImages
    .map((image, index) => normalizeImageInput(image, index))
    .filter((item): item is CopilotImageInput => Boolean(item));
  const imagesFromMessages = getUserMessageImages(rawBody.messages);
  const images = imagesFromPayload.length > 0 ? imagesFromPayload : imagesFromMessages;

  if (!customerId || (message.length === 0 && images.length === 0)) {
    return apiError("VALIDATION_ERROR", "copilot chat 参数不合法", 400, {
      payload: !customerId ? "缺少 customerId" : "message 与 images 不能同时为空",
    });
  }

  const { sessionId, shouldSetCookie } = await getOrCreateSessionId();
  const result = await runCopilotChat({
    session_id: sessionId,
    customer_id: customerId,
    user_message: message,
    images,
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
      images: payload.data.images,
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
