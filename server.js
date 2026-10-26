'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { create: createStore } = require('./store.js');

const store = createStore();
const OWNER_PIN = process.env.OWNER_PIN || '';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:gshetty1978@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

function notifyOwners(title, body) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const payload = JSON.stringify({ title, body });
  store.listPushSubscriptions().forEach((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        store.removePushSubscription(sub.endpoint);
      }
    });
  });
}

const app = express();
app.set('trust proxy', 1);
/* /api/* is called cross-origin from kiaanreply.onrender.com, which needs
   its own CORS headers — the socket.io CORS setting below only covers the
   socket connection, not these plain HTTP routes. */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

app.post('/api/owner/subscribe', (req, res) => {
  const { token, subscription } = req.body || {};
  if (!token || !store.isOwnerToken(token) || !subscription || !subscription.endpoint) {
    return res.status(401).json({ ok: false });
  }
  store.addPushSubscription(subscription);
  res.json({ ok: true });
});

app.post('/api/owner/login', (req, res) => {
  const pin = String((req.body && req.body.pin) || '');
  if (!OWNER_PIN || pin !== OWNER_PIN) {
    return res.status(401).json({ ok: false, error: 'Wrong PIN.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  store.addOwnerToken(token);
  res.json({ ok: true, token });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 3e6 });

function validImage(image) {
  return typeof image === 'string' && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(image) && image.length < 2.5e6;
}

/* Very small per-socket rate limit: visitors shouldn't be able to flood. */
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= max;
  };
}
const messageLimiter = makeLimiter(20, 60000);

/* A plain word-list profanity check on visitor messages — not perfect, but
   catches the obvious stuff without pulling in a heavy dependency. */
const BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'piss', 'cunt',
  'slut', 'whore', 'fag', 'retard', 'nigger', 'nigga'
];
const BAD_WORDS_RE = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\b', 'i');
function containsProfanity(text) {
  return BAD_WORDS_RE.test(text);
}

io.on('connection', (socket) => {
  let role = null;
  let visitorId = null;

  socket.on('visitor:init', ({ visitorId: vid, name }) => {
    if (!vid || typeof vid !== 'string') return;
    role = 'visitor';
    visitorId = vid.slice(0, 64);
    socket.join('visitor:' + visitorId);
    if (name) store.setName(visitorId, name);
    const convo = store.getConversation(visitorId);
    socket.emit('visitor:history', convo.messages);
  });

  socket.on('visitor:send', ({ text, image }) => {
    if (role !== 'visitor' || !visitorId) return;
    const hasImage = image && validImage(image);
    const clean = (text || '').toString();
    if (!hasImage && !clean.trim()) return;
    if (!messageLimiter(visitorId)) return;
    if (clean && containsProfanity(clean)) {
      socket.emit('visitor:blocked', { reason: 'profanity' });
      return;
    }
    const msg = store.addMessage(visitorId, 'visitor', clean.trim(), hasImage ? image : null);
    io.to('visitor:' + visitorId).emit('chat:message', msg);
    const convo = store.getConversation(visitorId);
    io.to('owners').emit('owner:conversationUpdated', convo);
    notifyOwners(convo.name || 'Someone', clean.trim() || 'Sent a photo');
  });

  socket.on('visitor:editMessage', ({ messageId, text }) => {
    if (role !== 'visitor' || !visitorId || !messageId) return;
    if (!text || typeof text !== 'string' || !text.trim()) return;
    if (containsProfanity(text)) {
      socket.emit('visitor:blocked', { reason: 'profanity' });
      return;
    }
    const msg = store.editMessage(visitorId, messageId, 'visitor', text.trim());
    if (!msg) return;
    io.to('visitor:' + visitorId).emit('chat:messageEdited', msg);
    const convo = store.getConversation(visitorId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });

  socket.on('visitor:deleteMessage', ({ messageId }) => {
    if (role !== 'visitor' || !visitorId || !messageId) return;
    const ok = store.deleteMessage(visitorId, messageId, 'visitor');
    if (!ok) return;
    io.to('visitor:' + visitorId).emit('chat:messageDeleted', { id: messageId });
    const convo = store.getConversation(visitorId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });

  socket.on('owner:auth', ({ token }) => {
    if (!token || !store.isOwnerToken(token)) {
      socket.emit('owner:authResult', { ok: false });
      return;
    }
    role = 'owner';
    socket.join('owners');
    socket.emit('owner:authResult', { ok: true });
    socket.emit('owner:conversations', store.listConversations());
  });

  socket.on('owner:open', ({ conversationId }) => {
    if (role !== 'owner' || !conversationId) return;
    const convo = store.getConversation(conversationId);
    socket.emit('owner:history', convo);
  });

  socket.on('owner:send', ({ conversationId, text, image }) => {
    if (role !== 'owner' || !conversationId) return;
    const hasImage = image && validImage(image);
    const clean = (text || '').toString();
    if (!hasImage && !clean.trim()) return;
    const msg = store.addMessage(conversationId, 'owner', clean.trim(), hasImage ? image : null);
    io.to('visitor:' + conversationId).emit('chat:message', msg);
    const convo = store.getConversation(conversationId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });

  socket.on('owner:editMessage', ({ conversationId, messageId, text }) => {
    if (role !== 'owner' || !conversationId || !messageId) return;
    if (!text || typeof text !== 'string' || !text.trim()) return;
    const msg = store.editMessage(conversationId, messageId, 'owner', text.trim());
    if (!msg) return;
    io.to('visitor:' + conversationId).emit('chat:messageEdited', msg);
    const convo = store.getConversation(conversationId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });

  socket.on('owner:deleteMessage', ({ conversationId, messageId }) => {
    if (role !== 'owner' || !conversationId || !messageId) return;
    const ok = store.deleteMessage(conversationId, messageId, 'owner');
    if (!ok) return;
    io.to('visitor:' + conversationId).emit('chat:messageDeleted', { id: messageId });
    const convo = store.getConversation(conversationId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });

  socket.on('owner:delete', ({ conversationId }) => {
    if (role !== 'owner' || !conversationId) return;
    store.deleteConversation(conversationId);
    io.to('owners').emit('owner:conversationDeleted', { id: conversationId });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('KiaanChat listening on ' + PORT));
