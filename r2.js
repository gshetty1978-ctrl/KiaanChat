'use strict';
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || '';
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

const enabled = !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_URL);

const client = enabled
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }
    })
  : null;

/* Uploads a data: URL image to R2 and returns its public URL. If R2 isn't
   configured yet (env vars missing), returns the original data URL
   unchanged so attachments keep working, just stored inline, until the
   env vars are set. */
async function persistImage(dataUrl) {
  if (!enabled) return dataUrl;
  const match = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const key = 'chat/' + crypto.randomUUID() + '.' + ext;
  try {
    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'image/' + ext
    }));
    return PUBLIC_URL + '/' + key;
  } catch (e) {
    console.error('R2 upload failed:', e.message);
    return dataUrl;
  }
}

module.exports = { persistImage, enabled };
