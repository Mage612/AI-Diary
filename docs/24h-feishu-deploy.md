# AI-Diary 24h Feishu Bot Deployment

这份教程用于把 AI-Diary 从“本地电脑长连接”升级为“24 小时在线的个人飞书日记机器人”。

## 结论

最稳的个人方案：

1. 手机端入口：飞书机器人聊天框。
2. AI 能力：DeepSeek / OpenAI 等大模型 API。
3. 数据存储：飞书多维表格。
4. 24h 后端：云服务器上常驻 Node.js 进程。

这种方式不要求你的电脑一直开着；只要云服务器在线，飞书机器人就能持续工作。

## 三种方案对比

| 方案 | 是否 24h | 是否需要公网域名 | 成本 | 适合谁 |
| --- | --- | --- | --- | --- |
| 本地电脑长连接 | 否 | 否 | 基本免费 | 先跑通功能 |
| 云服务器长连接 | 是 | 否 | 通常需要云服务器费用 | 个人长期使用，最省心 |
| HTTPS Webhook | 是 | 是 | 可低成本或免费 | 想部署成标准线上服务 |

当前项目已经同时支持：

- 长连接：`npm run feishu:bot`
- HTTP 回调：`/api/feishu-webhook`
- 网页服务：`npm start`

## 推荐方案：云服务器长连接

优点：

- 飞书后台继续选择“使用长连接接收事件”。
- 不需要配置公网回调 URL。
- 不需要域名和 HTTPS 证书。
- 云服务器只要能访问互联网即可。

缺点：

- 云服务器通常需要付费。
- 需要做一次服务器初始化。

## 服务器准备

建议配置：

- 系统：Ubuntu 22.04 LTS 或 Debian 12
- CPU：1 核即可
- 内存：1 GB 起步，2 GB 更舒服
- 地域：中国大陆、香港、新加坡都可以
- 带宽：1 Mbps 对个人日记机器人足够

如果只跑飞书机器人，不打开网页，安全组不需要开放业务端口。

如果也想访问网页 App：

- 开放 `8787` 端口，或
- 用 Nginx / Caddy 反向代理到 `8787`

## 第 1 步：安装 Node.js

登录服务器后执行：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v
npm -v
```

## 第 2 步：上传项目

方式一：用 GitHub 拉取。

```bash
git clone https://github.com/Mage612/AI-Diary.git
cd AI-Diary
```

方式二：如果代码还没同步到 GitHub，可以把本地 `AgentProject` 文件夹压缩上传到服务器。

上传后进入项目目录：

```bash
cd AI-Diary
```

## 第 3 步：安装依赖并构建前端

```bash
npm ci
npm run build
```

## 第 4 步：配置环境变量

在服务器项目目录创建 `.env`：

```bash
nano .env
```

填入这些内容，值从你本地 `.env` 复制过去：

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

APP_ACCESS_PASSWORD=

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFICATION_TOKEN=
FEISHU_WIKI_NODE_TOKEN=
FEISHU_BITABLE_TABLE_ID=
FEISHU_DEFAULT_MODE=SUMMARY
FEISHU_ALLOWED_OPEN_IDS=
```

推荐把 `FEISHU_ALLOWED_OPEN_IDS` 设置成你自己的 open_id，避免别人误用你的机器人。

## 第 5 步：安装 PM2

PM2 用来让 Node.js 进程后台常驻，并在异常退出时自动重启。

```bash
sudo npm install -g pm2
```

## 第 6 步：启动 24h 服务

如果只要飞书机器人：

```bash
pm2 start server/feishuLongConnection.js --name ai-diary-feishu-bot
```

如果同时要网页 App 和飞书机器人：

```bash
npm run pm2:start
```

查看状态：

```bash
pm2 status
pm2 logs ai-diary-feishu-bot
```

## 第 7 步：设置开机自启

```bash
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条带 `sudo env PATH=...` 的命令，把那条命令复制执行一次。

然后服务器重启后，机器人会自动恢复。

## 第 8 步：飞书后台确认

飞书开放平台里保持：

- 事件订阅方式：使用长连接接收事件
- 已添加事件：接收消息 `im.message.receive_v1`
- 权限：消息接收、发消息、多维表格编辑、Wiki 节点读取
- 版本管理与发布：已发布最新版本

## 第 9 步：手机端测试

在飞书手机 App 里给机器人发：

```text
今天上午整理了文献，下午配置了飞书机器人，有点累但终于快跑通了
```

期待结果：

1. 飞书聊天框收到 AI 整理后的回复。
2. 飞书多维表格新增一条记录。

## 常见问题

### 电脑关了还能用吗？

如果机器人跑在云服务器上，可以。

如果机器人只跑在你本地电脑上，不可以。

### 云服务器要一直开着吗？

要。飞书机器人消息是实时事件，后端必须一直在线。

### 一定要付费吗？

不一定。功能本身不强制付费，但 24h 稳定在线通常需要一个云端运行环境。大模型 API 也可能按量收费，个人日记的用量一般很小。

### 表格同步失败，但 AI 回复成功，正常吗？

正常。项目现在把“AI 回复”和“表格同步”拆开了。表格失败时，聊天框仍会返回 AI 回复，并提示同步错误。

### 如果改用 HTTPS Webhook 呢？

可以。把服务部署到有公网 HTTPS 的平台后，在飞书开放平台把订阅方式改成“将事件发送至开发者服务器”，请求地址填：

```text
https://你的域名/api/feishu-webhook
```

Webhook 版更标准，但需要公网域名和 HTTPS；云服务器长连接版更适合个人快速稳定使用。

## 参考链接

- 飞书开放平台：事件订阅支持开发者服务器回调和长连接两种方式。https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN
- 飞书开放平台：事件订阅概览。https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
- 阿里云轻量应用服务器：适合个人开发者和轻量 Web 应用。https://help.aliyun.com/zh/simple-application-server/product-overview/what-is-simple-application-server
- 阿里云轻量应用服务器计费项：套餐、数据盘、超额流量等。https://help.aliyun.com/zh/simple-application-server/product-overview/billable-items
