import { ERROR_CODE_RE, ERRORS, isErrorCode, makeRef, REF_RE } from '../../shared/errors';

export interface ErrorInfo {
  message: string;
  /** Catalogue code, e.g. KH-AUTH-001. */
  code?: string;
  /** Reference for this occurrence, e.g. R-7K2M9QXA. */
  ref?: string;
}

/** Reads the message, code and reference from an API error response, falling back to a safe default. */
export function errorInfo(data: unknown, fallback: string = ERRORS['KH-SYS-001'].message): ErrorInfo {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    message: typeof d.message === 'string' && d.message ? d.message : fallback,
    code: typeof d.errorCode === 'string' && ERROR_CODE_RE.test(d.errorCode) ? d.errorCode : undefined,
    ref: typeof d.ref === 'string' && REF_RE.test(d.ref) ? d.ref : undefined,
  };
}

/** The browser could not reach the server at all (offline, blocked or timed out). The reference is made here. */
export function networkError(): ErrorInfo {
  return { message: ERRORS['KH-NET-001'].message, code: 'KH-NET-001', ref: makeRef() };
}

/** An error response when the request may not have reached the server: status 0 means no response arrived. */
export function failureInfo(r: { status: number; data: unknown }, fallback?: string): ErrorInfo {
  return r.status === 0 ? networkError() : errorInfo(r.data, fallback);
}

export function codeInfo(code: string): ErrorInfo {
  return isErrorCode(code) ? { message: ERRORS[code].message, code } : { message: ERRORS['KH-SYS-001'].message };
}
