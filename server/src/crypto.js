const crypto = require('crypto');

function getKey() {
  const direct = process.env.DATA_ENC_KEY;
  if (direct && direct.trim().length > 0) {
    const key = Buffer.from(direct.trim(), 'base64');
    if (key.length !== 32) {
      throw new Error('DATA_ENC_KEY must be 32 bytes in base64');
    }
    return key;
  }

  const fallback = process.env.JWT_SECRET;
  if (!fallback) {
    throw new Error('Set DATA_ENC_KEY (preferred) or JWT_SECRET');
  }
  return crypto.createHash('sha256').update(fallback).digest();
}

function encrypt(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') {
    return null;
  }
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(payload) {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = {
  encrypt,
  decrypt,
};

