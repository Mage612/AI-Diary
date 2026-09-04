# AI&Diary Deployment

## 1. Supabase

Open Supabase SQL Editor and run:

```sql
-- see supabase/schema.sql
```

This creates `public.daily_records`, one row per `user_id + date`.

## 2. Vercel Environment Variables

Set these in Vercel Project Settings:

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
APP_USER_ID=single-user
```

## 3. Deploy

```bash
npm run build
```

Then import the project into Vercel. Vercel uses:

- Frontend: Vite React, output `dist`
- API: serverless functions in `api/`
- Local dev: `npm run dev`

## Feishu Bot Mode

The project also exposes a Feishu event callback:

```text
/api/feishu-webhook
```

Configure these environment variables on the deployment platform:

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_BITABLE_APP_TOKEN=
FEISHU_WIKI_NODE_TOKEN=
FEISHU_BITABLE_TABLE_ID=
FEISHU_DEFAULT_MODE=SUMMARY
FEISHU_ALLOWED_OPEN_IDS=
```

Create a Feishu Bitable table with these text fields for the MVP:

```text
日期, 类型, 原始记录, AI今日总结, 明日建议, 科研学习, 工作求职, 技能成长, 幸福小事, 情绪, 其他, 来源, 飞书OpenID
```
