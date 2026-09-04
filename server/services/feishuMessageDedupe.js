import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const memoryClaims = new Map();

export function claimFeishuMessage(event = {}) {
  const key = getFeishuMessageKey(event);
  if (!key) return { claimed: true, key: "" };

  const now = Date.now();
  const ttlMs = getTtlMs();
  pruneMemory(now);

  const memoryExpiresAt = memoryClaims.get(key);
  if (memoryExpiresAt && memoryExpiresAt > now) {
    return { claimed: false, key, reason: "memory" };
  }
  memoryClaims.set(key, now + ttlMs);

  const directory = getDedupeDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    cleanupExpiredMarkers(directory, now);
    return claimMarkerFile(directory, key, now, ttlMs);
  } catch (error) {
    console.warn(`[feishu] dedupe file cache unavailable: ${error.message}`);
    return { claimed: true, key, reason: "memory_only" };
  }
}

function getFeishuMessageKey(event) {
  return String(
    event.message?.message_id ||
    event.message_id ||
    event._feishu_event_id ||
    event.header?.event_id ||
    event.event_id ||
    ""
  ).trim();
}

function claimMarkerFile(directory, key, now, ttlMs) {
  const markerPath = path.join(directory, `${hashKey(key)}.json`);
  try {
    writeMarker(markerPath, key, now, ttlMs);
    return { claimed: true, key, reason: "file" };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    if (isMarkerExpired(markerPath, now)) {
      try {
        fs.unlinkSync(markerPath);
        writeMarker(markerPath, key, now, ttlMs);
        return { claimed: true, key, reason: "file_stale" };
      } catch (retryError) {
        if (retryError.code === "EEXIST") {
          return { claimed: false, key, reason: "file" };
        }
        throw retryError;
      }
    }

    return { claimed: false, key, reason: "file" };
  }
}

function writeMarker(markerPath, key, now, ttlMs) {
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(markerPath, "wx");
    fs.writeFileSync(fileDescriptor, JSON.stringify({
      key,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString()
    }, null, 2));
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
  }
}

function isMarkerExpired(markerPath, now) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const expiresAt = Date.parse(marker.expires_at || "");
    return Number.isFinite(expiresAt) && expiresAt <= now;
  } catch {
    return false;
  }
}

function cleanupExpiredMarkers(directory, now) {
  if (memoryClaims.size % 100 !== 0) return;

  for (const fileName of fs.readdirSync(directory)) {
    if (!fileName.endsWith(".json")) continue;
    const markerPath = path.join(directory, fileName);
    if (isMarkerExpired(markerPath, now)) {
      try {
        fs.unlinkSync(markerPath);
      } catch {
        // Another process may have claimed or removed it first.
      }
    }
  }
}

function pruneMemory(now) {
  for (const [key, expiresAt] of memoryClaims.entries()) {
    if (expiresAt <= now) memoryClaims.delete(key);
  }
}

function getTtlMs() {
  const value = Number(process.env.FEISHU_DEDUPE_TTL_MS || "");
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_MS;
}

function getDedupeDirectory() {
  return process.env.FEISHU_DEDUPE_DIR || path.join(os.tmpdir(), "ai-diary-feishu-dedupe");
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}
