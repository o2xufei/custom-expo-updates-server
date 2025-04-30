module.exports = {
  apps: [{
    name: "RecipeUpdate-app",
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3002",
    cwd: "C:/TestSite/RecipeUpdate",
    interpreter: "none",
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PRIVATE_KEY_PATH: "./code-signing-keys/private-key.pem",
      PORT: 3002  // 显式指定端口
    },
    error_file: "logs/err.log",
    out_file: "logs/out.log",
    time: true
  }]
}