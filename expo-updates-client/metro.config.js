const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 确保使用标准配置
config.serializer = {
  ...config.serializer,
  // 移除可能导致警告的自定义配置
};

module.exports = config;