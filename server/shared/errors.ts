/**
 * server/shared/errors.ts
 *
 * Shared application error classes.
 *
 * Usage in route / service layers:
 *   throw new NotFoundError("Shift not found");
 *   throw new ValidationError("startDate is required");
 *   throw new ForbiddenError("force=true required");
 *
 * The global errorHandler middleware (server/shared/http/errorHandler.ts)
 * reads .statusCode from these instances so the HTTP response gets the
 * correct status automatically.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain (required when targeting ES5)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad Request", code?: string) {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code?: string) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code?: string) {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not Found", code?: string) {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code?: string) {
    super(message, 409, code);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation Error", code?: string) {
    super(message, 422, code);
  }
}
