export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); }
}
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

type Handler = (req: Request, env: Env, p: Record<string, string>, ctx: ExecutionContext) => Promise<Response>;
export class Router {
  private routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  on(method: string, pattern: string, h: Handler) {
    const keys: string[] = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    this.routes.push({ method, re, keys, h });
    return this;
  }
  async handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method && !(r.method === "GET" && req.method === "HEAD")) continue;
      const p: Record<string, string> = {};
      r.keys.forEach((k, i) => (p[k] = decodeURIComponent(m[i + 1])));
      return r.h(req, env, p, ctx);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed" : "Not found");
  }
}
export async function body<T = any>(req: Request): Promise<T> {
  try { const v = await req.json(); if (v && typeof v === "object") return v as T; } catch {}
  throw new HttpError(400, "Expected a JSON body");
}
