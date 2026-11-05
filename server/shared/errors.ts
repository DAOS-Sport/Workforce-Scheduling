/**
 * The one error type services throw for an outcome the caller should see:
 *   throw httpError(404, "Shift not found");
 *   throw httpError(409, "already handled", { code: "ALREADY_HANDLED" });
 *
 * Anything thrown that is not an HttpError is an unexpected failure. The global
 * error handler answers it with 500 and a generic message, and records it.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function httpError(status: number, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(status, message, extra);
}
