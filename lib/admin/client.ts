"use client";

type ApiErrorPayload = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
};

type ApiSuccessPayload<T> = {
  success: true;
  data: T;
  meta: Record<string, unknown>;
};

type ApiFailurePayload = {
  success: false;
  error: ApiErrorPayload;
};

type ApiPayload<T> = ApiSuccessPayload<T> | ApiFailurePayload;

export type ApiSuccessEnvelope<T> = {
  data: T;
  meta: Record<string, unknown>;
};

export class AdminClientError extends Error {
  code: string;
  fieldErrors?: Record<string, string>;
  status: number;

  constructor(
    message: string,
    code = "UNKNOWN_ERROR",
    status = 500,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function requestJsonWithMeta<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiSuccessEnvelope<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as ApiPayload<T>;

  if (!payload.success) {
    throw new AdminClientError(
      payload.error.message,
      payload.error.code,
      response.status,
      payload.error.fieldErrors,
    );
  }

  return {
    data: payload.data,
    meta: payload.meta,
  };
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await requestJsonWithMeta<T>(url, init);
  return result.data;
}

export function toEditableText(value: string[]) {
  return value.join(", ");
}

export function fromEditableText(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function formatFieldErrors(fieldErrors?: Record<string, string>): string {
  if (!fieldErrors || Object.keys(fieldErrors).length === 0) {
    return "";
  }
  return Object.entries(fieldErrors)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}
