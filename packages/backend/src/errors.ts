/** Application-level HTTP error with a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);

export const conflict = (message: string) => new HttpError(409, 'conflict', message);
