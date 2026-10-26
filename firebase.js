'use strict';
const crypto = require('crypto');
const admin = require('firebase-admin');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || '';

const enabled = !!(PROJECT_ID && CLIENT_EMAIL && PRIVATE_KEY && BUCKET_NAME);

let bucket = null;
if (enabled) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
      privateKey: PRIVATE_KEY
    }),
    storageBucket: BUCKET_NAME
  });
  bucket = admin.storage().bucket();
}

/* Uploads a data: URL image to Firebase Storage and returns its public URL.
   If Firebase isn't configured yet (env vars missing), returns the original
   data URL unchanged so attachments keep working, just stored inline, until
   the env vars are set. */
async function persistImage(dataUrl) {
  if (!enabled) return dataUrl;
  const match = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const key = 'chat/' + crypto.randomUUID() + '.' + ext;
  try {
    const file = bucket.file(key);
    await file.save(buffer, { contentType: 'image/' + ext, public: true });
    return `https://storage.googleapis.com/${BUCKET_NAME}/${key}`;
  } catch (e) {
    console.error('Firebase upload failed:', e.message);
    return dataUrl;
  }
}

module.exports = { persistImage, enabled };
