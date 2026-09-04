const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

let tenantToken = "";
let tenantTokenExpiresAt = 0;
let resolvedBitableAppToken = "";

export function verifyFeishuToken(payload) {
  const expected = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!expected) return true;
  return payload?.token === expected || payload?.header?.token === expected;
}

export function hasFeishuAppConfig() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

export function hasFeishuBitableConfig() {
  return Boolean(
    process.env.FEISHU_BITABLE_TABLE_ID &&
    (process.env.FEISHU_BITABLE_APP_TOKEN || process.env.FEISHU_WIKI_NODE_TOKEN)
  );
}

export async function sendFeishuText(chatId, text) {
  if (!chatId || !hasFeishuAppConfig()) return null;
  return feishuRequest("/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    body: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text })
    }
  });
}

export async function createFeishuBitableRecord(fields) {
  if (!hasFeishuBitableConfig()) return null;
  const appToken = encodeURIComponent(await getBitableAppToken());
  const tableId = encodeURIComponent(process.env.FEISHU_BITABLE_TABLE_ID);
  return feishuRequest(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
    method: "POST",
    body: { fields }
  });
}

async function getBitableAppToken() {
  if (process.env.FEISHU_BITABLE_APP_TOKEN) return process.env.FEISHU_BITABLE_APP_TOKEN;
  if (resolvedBitableAppToken) return resolvedBitableAppToken;

  const wikiNodeToken = process.env.FEISHU_WIKI_NODE_TOKEN;
  if (!wikiNodeToken) throw new Error("Missing FEISHU_BITABLE_APP_TOKEN or FEISHU_WIKI_NODE_TOKEN");

  const query = new URLSearchParams({ token: wikiNodeToken }).toString();
  const data = await feishuRequest(`/wiki/v2/spaces/get_node?${query}`);
  const node = data.node || data;

  if (node.obj_type && node.obj_type !== "bitable") {
    throw new Error(`Wiki node is ${node.obj_type}, not bitable`);
  }

  if (!node.obj_token) {
    throw new Error("Unable to resolve bitable app token from wiki node");
  }

  resolvedBitableAppToken = node.obj_token;
  return resolvedBitableAppToken;
}

async function feishuRequest(pathname, { method = "GET", body } = {}) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    const message = data.msg || data.message || response.statusText;
    throw new Error(`Feishu API failed: ${response.status} ${message}`);
  }
  return data.data || data;
}

async function getTenantAccessToken() {
  if (!hasFeishuAppConfig()) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET");
  }

  const now = Date.now();
  if (tenantToken && tenantTokenExpiresAt > now + 60_000) return tenantToken;

  const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    const message = data.msg || data.message || response.statusText;
    throw new Error(`Unable to get Feishu tenant token: ${response.status} ${message}`);
  }

  tenantToken = data.tenant_access_token;
  tenantTokenExpiresAt = now + Number(data.expire || 0) * 1000;
  return tenantToken;
}
