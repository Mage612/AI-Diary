import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { handleFeishuWebhook } from "./feishuWebhook.js";
import { getHealth, handleChat, handleDailyRecords } from "./apiHandlers.js";

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const DIST_DIR = path.resolve("dist");
const ACCESS_COOKIE = "ai_diary_access";

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, getHealth());
    return;
  }

  if (url.pathname === "/api/session") {
    await handleSession(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feishu-webhook") {
    const body = await readBody(req);
    const result = await handleFeishuWebhook(body);
    sendJson(res, result.status, result.body);
    return;
  }

  if (url.pathname.startsWith("/api/") && !hasValidAccess(req)) {
    sendJson(res, 401, { message: "Unauthorized" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await handleChat(body));
    } catch (error) {
      sendJson(res, 500, {
        type: "ERROR",
        message: "分析失败，请稍后重试。",
        detail: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    }
    return;
  }

  if (url.pathname === "/api/daily-records" && ["GET", "POST"].includes(req.method)) {
    try {
      const body = req.method === "POST" ? await readBody(req) : {};
      sendJson(res, 200, await handleDailyRecords({ method: req.method, body }));
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        message: "每日记录云端读写失败。",
        detail: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { message: "Not found" });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (serveStaticAsset(req, res, url.pathname)) return;
  }

  sendJson(res, 404, { message: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`AI&Diary listening on http://${HOST}:${PORT}`);
});

async function handleSession(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, getSessionState(req));
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const session = createSession(body.password);
      sendJson(res, session.ok ? 200 : 401, {
        protected: isAccessControlEnabled(),
        authenticated: session.ok
      }, session.headers);
    } catch {
      sendJson(res, 400, { protected: isAccessControlEnabled(), authenticated: false });
    }
    return;
  }

  if (req.method === "DELETE") {
    sendJson(res, 200, { protected: isAccessControlEnabled(), authenticated: false }, {
      "Set-Cookie": `${ACCESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    });
    return;
  }

  sendJson(res, 405, { message: "Method not allowed" });
}

function serveStaticAsset(req, res, pathname) {
  if (!fs.existsSync(DIST_DIR)) return false;

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const relativePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^[/\\]+/, "");
  let filePath = path.resolve(DIST_DIR, relativePath);

  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`) && filePath !== DIST_DIR) {
    sendJson(res, 403, { message: "Forbidden" });
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  if (!fs.existsSync(filePath)) return false;

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Content-Length": stat.size
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  fs.createReadStream(filePath).pipe(res);
  return true;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[extension] || "application/octet-stream";
}

function isAccessControlEnabled() {
  return Boolean(process.env.APP_ACCESS_PASSWORD);
}

function getSessionState(req) {
  return {
    protected: isAccessControlEnabled(),
    authenticated: hasValidAccess(req)
  };
}

function createSession(password) {
  if (!isAccessControlEnabled()) {
    return { ok: true, headers: {} };
  }

  if (String(password || "") !== process.env.APP_ACCESS_PASSWORD) {
    return { ok: false, headers: {} };
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    ok: true,
    headers: {
      "Set-Cookie": `${ACCESS_COOKIE}=${createAccessToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`
    }
  };
}

function hasValidAccess(req) {
  if (!isAccessControlEnabled()) return true;
  const token = parseCookies(req.headers?.cookie || "")[ACCESS_COOKIE];
  if (!token) return false;
  return safeEqual(token, createAccessToken());
}

function createAccessToken() {
  return crypto.createHmac("sha256", process.env.APP_ACCESS_PASSWORD).update("ai-diary-access").digest("hex");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(cookieHeader.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function loadEnvFile() {
  if (!fs.existsSync(".env")) return;
  const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim().replace(/^\uFEFF/, "");
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
