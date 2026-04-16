import { NextResponse } from "next/server";

export type ApiErrorBody = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type ApiFailureResponse = {
  success: false;
  error: ApiErrorBody;
};

export type ApiSuccessResponse<TData, TMeta = Record<string, unknown>> = {
  success: true;
  data: TData;
  meta: TMeta;
};

export function apiSuccess<TData, TMeta = Record<string, unknown>>(
  data: TData,
  meta?: TMeta,
  status = 200,
) {
  const body: ApiSuccessResponse<TData, TMeta> = {
    success: true,
    data,
    meta: (meta ?? ({} as TMeta)),
  };

  return NextResponse.json(body, { status });
}

export function apiError(
  code: string,
  message: string,
  status: number,
  fieldErrors?: Record<string, string>,
) {
  const body: ApiFailureResponse = {
    success: false,
    error: { code, message, fieldErrors },
  };
  return NextResponse.json(body, { status });
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "未知错误";
}
