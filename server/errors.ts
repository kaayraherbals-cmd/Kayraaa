import type { VercelResponse } from '@vercel/node';
import { deriveErrorCode, ERRORS, isErrorCode, makeRef, type ErrorArea, type ErrorCode } from '../shared/errors.js';

type Body = Record<string, unknown>;

/**
 * Adds `errorCode` (stable, from the catalogue) and `ref` (this occurrence) to an error response, and logs server
 * faults (5xx) with the reference so a visitor's report can be matched to a log line. Success bodies pass through.
 */
export function withErrorCode(area: Exclude<ErrorArea, 'NET' | 'SYS'>, status: number, body: unknown): unknown {
  if (status < 400 || typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  const b = body as Body;
  const errorCode: ErrorCode = isErrorCode(b.errorCode) ? b.errorCode : deriveErrorCode(area, status, b);
  const ref = makeRef();
  const message = typeof b.message === 'string' && b.message ? b.message : ERRORS[errorCode].message;
  if (status >= 500) console.error(`[${errorCode}] ${ref} ${message}`);
  return { ...b, message, errorCode, ref };
}

/** Send an error with a catalogue code. Extra fields (such as `errors` or `problems`) are kept. */
export function sendError(res: VercelResponse, area: Exclude<ErrorArea, 'NET' | 'SYS'>, code: ErrorCode, extra: Body = {}, status: number = ERRORS[code].status) {
  return res.status(status).json(withErrorCode(area, status, { status: 'error', ...extra, errorCode: code }));
}
