module.exports = {
  apps: [
    {
      name: 'RecipeUpdate-app',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002',
      env: {
        EXPO_OTA_ENV: 'production',
        KEY_ROTATION_INTERVAL: '86400', // 24小时轮换密钥
      },
      error_file: 'logs/ota-errors.log',
      out_file: 'logs/ota-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
