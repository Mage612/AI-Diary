import fs from "node:fs";
import * as Lark from "@larksuiteoapi/node-sdk";
import { processFeishuMessageEvent } from "./feishuWebhook.js";

loadEnvFile();

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

if (!appId || !appSecret) {
  console.error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET in .env");
  process.exit(1);
}

const wsClient = new Lark.WSClient({
  appId,
  appSecret,
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
  loggerLevel: Lark.LoggerLevel.info
});

const dispatcher = new Lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    await processFeishuMessageEvent(data);
  }
});

wsClient.start({ eventDispatcher: dispatcher });
console.log("AI&Diary Feishu long-connection bot is running.");

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
