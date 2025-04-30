const http = require('http');
const next = require('next');
const fs = require('fs').promises;
const path = require('path');
const { getPrivateKeyAsync, signRSASHA256 } = require('./common/helpers.cjs');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Expo更新服务端点
const handleExpoUpdate = async (req, res) => {
  try {
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'expo-protocol-version, expo-platform, expo-runtime-version, expo-current-update-id, expo-expect-signature'
    );

    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      return res.end();
    }

    // 返回示例manifest响应
    const manifest = {
      id: '1',
      createdAt: new Date().toISOString(),
      runtimeVersion: '1.0.0', 
      assets: [],
      launchAsset: {
        hash: 'hash',
        key: 'main.jsbundle',
        contentType: 'application/javascript',
        url: `https://${req.headers.host}/recipeUpdate/static/js/main.js`,
      },
    };

    const manifestString = JSON.stringify(manifest);
    res.setHeader('Content-Type', 'application/json');

    // 如果客户端期望签名，尝试生成并添加签名头
    if (req.headers['expo-expect-signature']) {
      try {
        const privateKey = await getPrivateKeyAsync();
        if (privateKey) {
          const signature = signRSASHA256(privateKey, manifestString);
          res.setHeader('expo-signature', signature);
        } else {
          console.warn('No private key available for signing');
        }
      } catch (err) {
        console.error('Signature generation failed:', err);
      }
    }

    res.end(manifestString);
  } catch (err) {
    console.error('Expo update error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
};

app.prepare().then(() => {
  http
    .createServer(async (req, res) => {
      try {
        // 处理Expo更新API
        if (req.url.match(/^\/recipeUpdate\/api\/manifest/i)) {
          return handleExpoUpdate(req, res);
        }

        // 处理静态文件请求
        if (req.url.match(/\/updates\/\d+\/\d+\/(metadata|expoConfig)\.json$/i)) {
          // 规范化路径，去除重复的/recipeUpdate前缀
          const normalizedUrl = req.url.replace(/^\/recipeUpdate/, '');
          const filePath = path.join(__dirname, normalizedUrl);
          try {
            let data = await fs.readFile(filePath, 'utf8');
            if (data.charCodeAt(0) === 0xfeff) {
              data = data.substring(1);
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
            return;
          } catch (err) {
            console.error('File read error:', err);
            res.statusCode = 404;
            return res.end('Not Found');
          }
        }

        // 其他请求交给Next.js处理
        handle(req, res);
      } catch (err) {
        console.error('Server error:', err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    })
    .listen(process.env.PORT || 80, () => {
      console.log(`> Server listening on port ${process.env.PORT || 80}`);
    });
});
