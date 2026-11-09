// Map a failed Anthropic API call to the fleet's structured error taxonomy.
//
// The SDK already retries connection errors, 408/409/429 and 5xx (two retries by
// default) before it throws, so anything that reaches here has outlasted those
// retries. Callers turn the result into a review item or an HTTP status; they never
// let the raw exception escape to the client.

import Anthropic from '@anthropic-ai/sdk';
import { fail, type StructuredError } from './types.js';

export function classifyModelError(err: unknown): StructuredError {
  if (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError
  ) {
    return fail('transient', 'The model is temporarily unavailable.', err.message);
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return fail('permission', 'The service API key was rejected.', err.message);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return fail('validation', 'The model request was rejected as invalid (400).', err.message);
  }
  if (err instanceof Anthropic.APIError) {
    return fail('business', `Model request failed (${err.status ?? 'no status'}).`, err.message);
  }
  // Not an API error: most likely a bug on our side, so retrying will not help.
  return fail(
    'business',
    'The model call failed unexpectedly.',
    err instanceof Error ? err.message : String(err),
  );
}
