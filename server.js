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
const io = new Server(server, { cors: { origin: '*' } });

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

  socket.on('visitor:send', ({ text }) => {
    if (role !== 'visitor' || !visitorId) return;
    if (!text || typeof text !== 'string' || !text.trim()) return;
    if (!messageLimiter(visitorId)) return;
    const msg = store.addMessage(visitorId, 'visitor', text.trim());
    io.to('visitor:' + visitorId).emit('chat:message', msg);
    const convo = store.getConversation(visitorId);
    io.to('owners').emit('owner:conversationUpdated', convo);
    notifyOwners(convo.name || 'Someone', text.trim());
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

  socket.on('owner:send', ({ conversationId, text }) => {
    if (role !== 'owner' || !conversationId) return;
    if (!text || typeof text !== 'string' || !text.trim()) return;
    const msg = store.addMessage(conversationId, 'owner', text.trim());
    io.to('visitor:' + conversationId).emit('chat:message', msg);
    const convo = store.getConversation(conversationId);
    io.to('owners').emit('owner:conversationUpdated', convo);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('KiaanChat listening on ' + PORT));
