import { type CorsOptions, HttpStatus } from '@hopak/common';

export interface CorsHandler {
  apply(req: Request, response: Response): Response;
  preflight(req: Request): Response | null;
}

const PREFLIGHT_METHOD = 'OPTIONS';
const PREFLIGHT_MAX_AGE_SECONDS = '600';
const PREFLIGHT_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

interface OriginPolicy {
  resolve(req: Request): string | null;
}

function buildOriginPolicy(options: CorsOptions): OriginPolicy {
  if (options.origins === '*') {
    return {
      resolve: (req) => req.headers.get('origin'),
    };
  }
  const allowed = new Set(options.origins);
  return {
    resolve: (req) => {
      const origin = req.headers.get('origin');
      return origin && allowed.has(origin) ? origin : null;
    },
  };
}

function corsHeaders(origin: string, credentials: boolean): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  if (credentials) headers.set('Access-Control-Allow-Credentials', 'true');
  return headers;
}

export function createCorsHandler(options: CorsOptions): CorsHandler {
  const policy = buildOriginPolicy(options);
  const credentials = options.credentials ?? false;

  return {
    apply(req, response) {
      const origin = policy.resolve(req);
      if (!origin) return response;
      const headers = corsHeaders(origin, credentials);
      headers.forEach((value, key) => response.headers.set(key, value));
      return response;
    },
    preflight(req) {
      if (req.method !== PREFLIGHT_METHOD) return null;
      const origin = policy.resolve(req);
      if (!origin) return null;
      const headers = corsHeaders(origin, credentials);
      headers.set('Access-Control-Allow-Methods', PREFLIGHT_ALLOWED_METHODS);
      const requested = req.headers.get('access-control-request-headers');
      if (requested) headers.set('Access-Control-Allow-Headers', requested);
      headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
      return new Response(null, { status: HttpStatus.NoContent, headers });
    },
  };
}
