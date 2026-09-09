import { InputError } from './post-service';
import { PublishError } from '@/lib/publishers';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}
export function apiError(error: unknown) {
  const e = error instanceof ApiError ? error : error instanceof InputError || error instanceof PublishError
    ? new ApiError(422, 'validation_error', error instanceof PublishError ? error.humanMessage : error.message)
    : new ApiError(500, 'internal_error', 'Unable to complete this request.');
  const response = json({error: {code: e.code, message: e.message}}, e.status);
  if (e.retryAfter) response.headers.set('Retry-After', String(e.retryAfter));
  return response;
}
