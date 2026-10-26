'use strict';
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || '';

const enabled = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY && BUCKET);

const client = enabled ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

/* Uploads a data: URL image to Supabase Storage and returns its public URL.
   If Supabase isn't configured yet (env vars missing), returns the original
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
    const { error } = await client.storage.from(BUCKET).upload(key, buffer, {
      contentType: 'image/' + ext
    });
    if (error) throw error;
    const { data } = client.storage.from(BUCKET).getPublicUrl(key);
    return data.publicUrl;
  } catch (e) {
    console.error('Supabase upload failed:', e.message);
    return dataUrl;
  }
}

module.exports = { persistImage, enabled };
