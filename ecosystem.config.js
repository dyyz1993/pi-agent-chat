/* PiAgentChat pm2 ecosystem config
 *
 * 用法: pm2 start ecosystem.config.js
 *       pm2 restart pi-chat
 *       pm2 logs pi-chat
 */
module.exports = {
  apps: [
    {
      name: "pi-chat",
      script: "./dist-server/server.js",
      cwd: __dirname,
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3100",
        AUTH_TOKEN: process.env.AUTH_TOKEN || "",
        PI_CLI_PATH: process.env.PI_CLI_PATH || "/usr/bin/pi",
        SANDBOX_ENABLED: process.env.SANDBOX_ENABLED || "false",
        LOG_DIR: process.env.LOG_DIR || "./logs",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
