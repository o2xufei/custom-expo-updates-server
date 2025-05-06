// 原有server.js的完整内容，但确保包含以下关键修改：

// 1. 更新导入语句：
const path = require('path');
const fs = require('fs');
const {
  getPrivateKeyAsync,
  getCertificateChainAsync,
  signRSASHA256,
} = require('./common/helpers.cjs');

// 2. 在manifest处理部分：
async function handleManifestRequest(req, res) {
  try {
    // 1. 验证请求头
    const platform = req.headers['expo-platform'];
    const runtimeVersion = req.headers['expo-runtime-version'];
    if (!platform || !runtimeVersion) {
      throw new Error('Missing required headers: expo-platform or expo-runtime-version');
    }

    // 2. 查找对应版本的更新包
    const updatePath = path.join(__dirname, 'updates', runtimeVersion);
    if (!fs.existsSync(updatePath)) {
      throw new Error(`No updates found for runtime version: ${runtimeVersion}`);
    }

    // 3. 读取manifest文件
    const manifestPath = path.join(updatePath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest file not found');
    }
    const manifestString = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestString);

    // 4. 生成签名
    const privateKey = await getPrivateKeyAsync();
    const certChain = await getCertificateChainAsync();
    if (!privateKey || !certChain) {
      throw new Error('Failed to load signing credentials');
    }

    // 5. 准备响应头
    const headers = {
      'expo-protocol-version': '0',
      'expo-sfv-version': '0',
      'content-type': 'multipart/mixed',
    };

    // 6. 生成签名并添加到头
    if (!manifestString || typeof manifestString !== 'string') {
      throw new Error('Invalid manifest content');
    }
    const signature = signRSASHA256(privateKey, manifestString);
    headers['expo-signature'] = `sig="${signature}" keyid="main" certchain="${encodeURIComponent(certChain)}"`;

    // 7. 记录调试信息
    console.log(`Serving update for ${platform} runtime ${runtimeVersion}`);
    console.log('Signature headers:', headers);

    // 8. 发送响应
    res.writeHead(200, headers);
    res.end(manifestString);
  } catch (error) {
    console.error('Manifest request failed:', error);
    res.status(500).json({
      error: error.message,
      code: 'MANIFEST_ERROR',
    });
  }
}

// 保留其他原有路由和功能