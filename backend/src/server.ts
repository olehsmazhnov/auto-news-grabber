import fs from "node:fs";
import path from "node:path";
import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "8000", 10) || 8000;
const rootDir = process.cwd();

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

function route(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
  const pathname = decodeURIComponent(url.pathname);

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

const server = http.createServer(route);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${port}/viewer/`);
});
