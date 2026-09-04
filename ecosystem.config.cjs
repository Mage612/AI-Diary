module.exports = {
  apps: [
    {
      name: "ai-diary-web",
      script: "server/index.js",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: process.env.PORT || 8787
      }
    },
    {
      name: "ai-diary-feishu-bot",
      script: "server/feishuLongConnection.js",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
