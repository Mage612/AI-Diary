import { handleChat } from "./apiHandlers.js";
import { claimFeishuMessage } from "./services/feishuMessageDedupe.js";
import {
  createFeishuBitableRecord,
  hasFeishuBitableConfig,
  sendFeishuText,
  verifyFeishuToken
} from "./services/feishuClient.js";

const FIELD = {
  date: "\u65e5\u671f",
  type: "\u7c7b\u578b",
  raw: "\u539f\u59cb\u8bb0\u5f55",
  aiSummary: "AI\u4eca\u65e5\u603b\u7ed3",
  nextSuggestion: "\u660e\u65e5\u5efa\u8bae",
  research: "\u79d1\u7814\u5b66\u4e60",
  work: "\u5de5\u4f5c\u6c42\u804c",
  growth: "\u6280\u80fd\u6210\u957f",
  happiness: "\u5e78\u798f\u5c0f\u4e8b",
  emotion: "\u60c5\u7eea",
  others: "\u5176\u4ed6",
  source: "\u6765\u6e90",
  openId: "\u98de\u4e66OpenID"
};

export async function handleFeishuWebhook(payload = {}) {
  if (payload.challenge) return { status: 200, body: { challenge: payload.challenge } };

  if (!verifyFeishuToken(payload)) {
    return { status: 401, body: { message: "Invalid Feishu verification token" } };
  }

  const eventType = payload.header?.event_type || "";
  if (eventType !== "im.message.receive_v1") {
    return { status: 200, body: { ok: true, ignored: eventType || "unknown_event" } };
  }

  const event = {
    ...(payload.event || {}),
    _feishu_event_id: payload.header?.event_id || ""
  };

  if (!shouldProcessWebhookAsync()) {
    await processFeishuMessageEvent(event);
    return { status: 200, body: { ok: true } };
  }

  enqueueFeishuMessageEvent(event);
  return { status: 200, body: { ok: true, accepted: true } };
}

export function enqueueFeishuMessageEvent(event = {}) {
  setTimeout(() => {
    processFeishuMessageEvent(event).catch((error) => {
      console.error("[feishu] background processing failed", error);
    });
  }, 0);
}

export async function processFeishuMessageEvent(event = {}) {
  const message = event.message || {};
  const chatId = message.chat_id;
  const senderOpenId = event.sender?.sender_id?.open_id || "";
  console.log(`[feishu] received ${message.message_type || "unknown"} message from ${senderOpenId || "unknown"} in ${chatId || "unknown"}`);

  if (!isAllowedSender(senderOpenId)) {
    console.log(`[feishu] ignored sender ${senderOpenId}`);
    return { ok: true, ignored: "sender_not_allowed" };
  }

  const dedupe = claimFeishuMessage(event);
  if (!dedupe.claimed) {
    console.log(`[feishu] duplicate message skipped (${dedupe.reason}): ${dedupe.key}`);
    return { ok: true, duplicate: true };
  }

  if (message.message_type !== "text") {
    await sendFeishuText(chatId, "\u6211\u73b0\u5728\u5148\u652f\u6301\u6587\u5b57\u65e5\u8bb0\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u53d1\u4e00\u53e5\u4eca\u5929\u53d1\u751f\u4e86\u4ec0\u4e48\u3002");
    return { ok: true };
  }

  const text = extractTextMessage(message.content);
  console.log(`[feishu] text: ${text || "<empty>"}`);
  if (!text) {
    await sendFeishuText(chatId, "\u6211\u6ca1\u8bfb\u5230\u6587\u5b57\u5185\u5bb9\uff0c\u518d\u53d1\u4e00\u6b21\u8bd5\u8bd5\u3002");
    return { ok: true };
  }

  if (/^\/?help$/i.test(text)) {
    await sendFeishuText(chatId, buildHelpText(senderOpenId));
    return { ok: true };
  }

  try {
    const { mode, content } = resolveMessageMode(text);
    console.log(`[feishu] mode=${mode}`);
    const result = await handleChat({ text: content, mode });
    const fields = toFeishuFields(result, content, senderOpenId);
    const sync = { configured: hasFeishuBitableConfig(), ok: false, error: "" };

    if (sync.configured) {
      console.log("[feishu] syncing to bitable");
      try {
        await createFeishuBitableRecord(fields);
        sync.ok = true;
        console.log("[feishu] bitable sync ok");
      } catch (error) {
        sync.error = error.message || "\u672a\u77e5\u9519\u8bef";
        console.error(error);
      }
    }

    await sendFeishuText(chatId, buildReply(result, sync));
    console.log("[feishu] reply sent");
  } catch (error) {
    console.error(error);
    await sendFeishuText(chatId, `\u5206\u6790\u5931\u8d25\uff1a${error.message || "\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528"}`);
  }

  return { ok: true };
}

function resolveMessageMode(text) {
  const trimmed = text.trim();
  const command = trimmed.match(/^\/(summary|plan|chat)\s+([\s\S]+)/i);
  if (!command) return { mode: process.env.FEISHU_DEFAULT_MODE || "SUMMARY", content: trimmed };
  return { mode: command[1].toUpperCase(), content: command[2].trim() };
}

function shouldProcessWebhookAsync() {
  if (String(process.env.FEISHU_ASYNC_PROCESSING || "").toLowerCase() === "false") return false;
  return !process.env.VERCEL;
}

function extractTextMessage(content) {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return String(parsed?.text || "").trim();
  } catch {
    return "";
  }
}

function isAllowedSender(openId) {
  const allowed = String(process.env.FEISHU_ALLOWED_OPEN_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(openId);
}

function toFeishuFields(result, rawText, senderOpenId) {
  const baseFields = {
    [FIELD.date]: toFeishuDateValue(result.date || result.week_start || todayText()),
    [FIELD.type]: normalizeType(result.type),
    [FIELD.raw]: rawText,
    [FIELD.aiSummary]: buildTableSummary(result),
    [FIELD.nextSuggestion]: buildNextSuggestion(result),
    [FIELD.research]: result.research || "",
    [FIELD.work]: result.work || "",
    [FIELD.growth]: result.growth || "",
    [FIELD.happiness]: result.happiness || "",
    [FIELD.emotion]: result.emotion || "",
    [FIELD.others]: result.others || "",
    [FIELD.source]: "\u98de\u4e66\u673a\u5668\u4eba",
    [FIELD.openId]: senderOpenId
  };

  const fieldMap = readFieldMap();
  return Object.fromEntries(Object.entries(baseFields).map(([key, value]) => [fieldMap[key] || key, value]));
}

function normalizeType(type) {
  return ["SUMMARY", "PLAN", "CHAT"].includes(type) ? type : "SUMMARY";
}

function toFeishuDateValue(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateText;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function buildTableSummary(result) {
  if (result.type === "PLAN") {
    const tasks = (result.tasks || result.task_pool || []).slice(0, 5);
    return [
      result.main_goal ? `\u4e3b\u7ebf\uff1a${result.main_goal}` : "",
      ...tasks.map((task, index) => `${index + 1}. ${task.name}${task.priority ? `\uff08${task.priority}\uff09` : ""}\uff1a${task.next_action || task.reason || ""}`)
    ].filter(Boolean).join("\n");
  }

  if (result.type === "CHAT") {
    return result.reply || "";
  }

  return result.summary || "";
}

function buildNextSuggestion(result) {
  if (result.type === "PLAN") {
    const firstTask = (result.tasks || result.task_pool || [])[0];
    return firstTask?.next_action || result.priority_rationale?.first_action || "";
  }

  if (result.type === "CHAT") {
    return "\u9700\u8981\u65f6\u7ee7\u7eed\u548c\u6211\u804a\uff0c\u6216\u53d1 /summary \u8bb0\u5f55\u6210\u4eca\u65e5\u603b\u7ed3\u3002";
  }

  return result.tomorrow_plan || "";
}

function readFieldMap() {
  if (!process.env.FEISHU_BITABLE_FIELDS_JSON) return {};
  try {
    return JSON.parse(process.env.FEISHU_BITABLE_FIELDS_JSON);
  } catch {
    return {};
  }
}

function buildReply(result, sync) {
  if (result.type === "SUMMARY") {
    return [
      "\u6536\u5230\uff0c\u6211\u5df2\u7ecf\u5e2e\u4f60\u628a\u8fd9\u6761\u65e5\u8bb0\u6574\u7406\u597d\u4e86\u3002",
      `\u65e5\u671f\uff1a${result.date}`,
      result.summary ? `\u603b\u7ed3\uff1a${result.summary}` : "",
      result.research ? `\u79d1\u7814\u5b66\u4e60\uff1a${result.research}` : "",
      result.work ? `\u5de5\u4f5c\u6c42\u804c\uff1a${result.work}` : "",
      result.growth ? `\u6280\u80fd\u6210\u957f\uff1a${result.growth}` : "",
      result.happiness ? `\u5e78\u798f\u5c0f\u4e8b\uff1a${result.happiness}` : "",
      result.emotion ? `\u60c5\u7eea\uff1a${result.emotion}` : "",
      result.others ? `\u5176\u4ed6\uff1a${result.others}` : "",
      result.reflection ? `\u590d\u76d8\uff1a${result.reflection}` : "",
      result.tomorrow_plan ? `\u660e\u65e5\u5efa\u8bae\uff1a${result.tomorrow_plan}` : "",
      syncLine(sync)
    ].filter(Boolean).join("\n");
  }

  if (result.type === "CLARIFY_DATE") {
    return [
      result.reply || "\u8fd9\u6761\u8bb0\u5f55\u9700\u8981\u5148\u786e\u8ba4\u65e5\u671f\u3002",
      syncLine(sync)
    ].filter(Boolean).join("\n");
  }

  if (result.type === "PLAN") {
    return [
      "\u597d\uff0c\u6211\u628a\u8fd9\u4e2a\u8ba1\u5212\u62c6\u6210\u4e86\u4e00\u4e2a\u66f4\u5bb9\u6613\u6267\u884c\u7684\u7248\u672c\u3002",
      `\u4e3b\u7ebf\uff1a${result.main_goal}`,
      ...(result.success_criteria || []).slice(0, 3).map((item) => `\u5b8c\u6210\u6807\u51c6\uff1a${item}`),
      ...(result.tasks || []).slice(0, 4).map((task, index) => `${index + 1}. ${task.name}${task.priority ? `\uff08${task.priority}\uff09` : ""}\uff1a${task.next_action || task.reason || ""}`),
      result.explanation ? `\u4e3a\u4ec0\u4e48\u8fd9\u6837\u5b89\u6392\uff1a${result.explanation}` : "",
      syncLine(sync)
    ].filter(Boolean).join("\n");
  }

  return [
    result.reply || "\u6211\u6536\u5230\u5566\u3002",
    syncLine(sync)
  ].filter(Boolean).join("\n");
}

function syncLine(sync) {
  if (!sync?.configured) return "\u540c\u6b65\uff1a\u8fd8\u6ca1\u6709\u914d\u7f6e\u98de\u4e66\u591a\u7ef4\u8868\u683c\u3002";
  if (sync.ok) return "\u540c\u6b65\uff1a\u5df2\u5199\u5165\u98de\u4e66\u591a\u7ef4\u8868\u683c\u3002";
  return `\u540c\u6b65\uff1a\u5199\u5165\u8868\u683c\u5931\u8d25\uff0c\u4f46 AI \u56de\u590d\u5df2\u751f\u6210\u3002${sync.error ? ` ${sync.error}` : ""}`;
}

function buildHelpText(senderOpenId) {
  return [
    "\u76f4\u63a5\u53d1\u4e00\u53e5\u65e5\u8bb0\uff0c\u6211\u4f1a\u6574\u7406\u5e76\u540c\u6b65\u5230\u591a\u7ef4\u8868\u683c\u3002",
    "\u53ef\u7528\u547d\u4ee4\uff1a",
    "/summary \u4eca\u5929\u5b8c\u6210\u4e86\u5b9e\u9a8c\uff0c\u4e5f\u6709\u70b9\u7d2f",
    "/plan \u660e\u5929\u6539\u8bba\u6587 intro",
    "/chat \u6211\u73b0\u5728\u6709\u70b9\u7126\u8651",
    senderOpenId ? `\u4f60\u7684 open_id\uff1a${senderOpenId}` : ""
  ].filter(Boolean).join("\n");
}

function todayText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
