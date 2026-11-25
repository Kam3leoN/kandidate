/** Typed fetch wrapper for /api. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: init.body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : method !== 'GET' ? '{}' : undefined,
    signal: init.signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedListeners.forEach((l) => l());
    const err = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `Erreur ${res.status}`, err?.details ?? null);
  }
  return data as T;
}

export const get = <T>(p: string, signal?: AbortSignal): Promise<T> => api<T>(p, { signal });
export const post = <T>(p: string, body: unknown = {}): Promise<T> => api<T>(p, { method: 'POST', body });
export const put = <T>(p: string, body: unknown): Promise<T> => api<T>(p, { method: 'PUT', body });
export const patch = <T>(p: string, body: unknown): Promise<T> => api<T>(p, { method: 'PATCH', body });
export const del = <T>(p: string): Promise<T> => api<T>(p, { method: 'DELETE' });
