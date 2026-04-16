export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  raw: Response;
}

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json();
  if (res.headers.has('content-length') && res.headers.get('content-length') === '0') return null;
  return res.text();
}

async function send<T>(url: string, init: globalThis.RequestInit = {}): Promise<JsonResponse<T>> {
  const res = await fetch(url, init);
  return {
    status: res.status,
    body: (await readBody(res)) as T,
    headers: res.headers,
    raw: res,
  };
}

export interface JsonClient {
  get<T = unknown>(path: string, init?: globalThis.RequestInit): Promise<JsonResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<JsonResponse<T>>;
  delete<T = unknown>(path: string): Promise<JsonResponse<T>>;
}

function jsonInit(method: string, body?: unknown): globalThis.RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function createJsonClient(baseUrl: string): JsonClient {
  const url = (path: string): string => `${baseUrl}${path}`;
  return {
    get: (path, init) => send(url(path), init),
    post: (path, body) => send(url(path), jsonInit('POST', body)),
    put: (path, body) => send(url(path), jsonInit('PUT', body)),
    patch: (path, body) => send(url(path), jsonInit('PATCH', body)),
    delete: (path) => send(url(path), jsonInit('DELETE')),
  };
}
