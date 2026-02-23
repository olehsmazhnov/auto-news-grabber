import fs from "node:fs";
import path from "node:path";
import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseSupabaseSyncScope, syncNewsToSupabase } from "./modules/supabase-sync.js";

const port = Number.parseInt(process.env.PORT ?? "8000", 10) || 8000;
const rootDir = process.cwd();
const MAX_JSON_BODY_BYTES = 8 * 1024;

class BadRequestError extends Error {}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function safePath(relativePath: string): string | null {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
  const resolved = path.join(rootDir, normalized);
  const relative = path.relative(rootDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function send(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(body)}\n`);
}

function serveFile(res: ServerResponse, absPath: string): void {
  if (!fs.existsSync(absPath)) {
    send(res, 404, "Not found");
    return;
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    send(res, 404, "Not found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", contentType(absPath));
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(absPath).pipe(res);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isBadRequestError(error: unknown): boolean {
  return error instanceof BadRequestError;
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer | string) => {
      const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += nextChunk.length;
      if (totalBytes > maxBytes) {
        reject(new BadRequestError("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(nextChunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const rawBody = await readRequestBody(req, maxBytes);
  const normalizedBody = rawBody.trim();
  if (!normalizedBody) {
    return {};
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(normalizedBody);
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }

  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    throw new BadRequestError("JSON body must be an object");
  }

  return parsedBody as Record<string, unknown>;
}

async function handleSupabaseSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(req, MAX_JSON_BODY_BYTES);
    const scope = parseSupabaseSyncScope(payload.scope);
    const result = await syncNewsToSupabase({ scope });
    sendJson(res, 200, result);
  } catch (error) {
    const statusCode = isBadRequestError(error) ? 400 : 500;
    sendJson(res, statusCode, { ok: false, error: toErrorMessage(error) });
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/supabase/sync") {
    await handleSupabaseSync(req, res);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  if (pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/") {
    res.statusCode = 302;
    res.setHeader("Location", "/viewer/");
    res.end();
    return;
  }

  if (pathname === "/viewer" || pathname === "/viewer/") {
    const filePath = safePath("viewer/index.html");
    if (!filePath) {
      send(res, 400, "Invalid path");
      return;
    }
    serveFile(res, filePath);
    return;
  }

  if (pathname.startsWith("/viewer/") || pathname.startsWith("/dist/") || pathname.startsWith("/data/")) {
    const filePath = safePath(pathname.slice(1));
    if (!filePath) {
      send(res, 400, "Invalid path");
      return;
    }
    serveFile(res, filePath);
    return;
  }

  send(res, 404, "Not found");
}

const server = http.createServer((req, res) => {
  void route(req, res).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Request handling failed: ${toErrorMessage(error)}`);
    if (!res.headersSent) {
      send(res, 500, "Internal server error");
      return;
    }
    if (!res.writableEnded) {
      res.end();
    }
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}/viewer/`);
});
