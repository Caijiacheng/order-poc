export class BusinessError extends Error {
  code: string;
  status: number;
  fieldErrors?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    status = 500,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function isBusinessError(error: unknown): error is BusinessError {
  return error instanceof BusinessError;
}
