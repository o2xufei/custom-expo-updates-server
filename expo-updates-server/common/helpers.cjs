const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

async function getPrivateKeyAsync() {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH || 'code-signing-keys/private-key.pem';
  try {
    const key = await fs.readFile(path.resolve(privateKeyPath), 'utf8');
    return key;
  } catch (err) {
    console.error('Error reading private key:', err);
    return null;
  }
}

function signRSASHA256(privateKey, data) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  return sign.sign(privateKey, 'base64');
}

module.exports = {
  getPrivateKeyAsync,
  signRSASHA256
};