import { handleFeishuWebhook } from "../server/feishuWebhook.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const result = await handleFeishuWebhook(payload);
  res.status(result.status).json(result.body);
}
