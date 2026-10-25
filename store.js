'use strict';
const fs = require('fs');
const path = require('path');

/* A plain JSON file as the datastore. Fine for a small personal chat app —
   just know that Render's free tier wipes local disk on every redeploy, so
   conversation history survives restarts but not a new deploy. */
const DATA_FILE = path.join(__dirname, 'data.json');

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!d.pushSubscriptions) d.pushSubscriptions = [];
    return d;
  } catch (e) {
    return { conversations: {}, ownerTokens: [], pushSubscriptions: [] };
  }
}

function create() {
  let data = load();
  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.writeFile(DATA_FILE, JSON.stringify(data), () => {});
    }, 200);
  }

  return {
    getConversation(id) {
      if (!data.conversations[id]) {
        data.conversations[id] = { id, name: '', messages: [], updatedAt: Date.now() };
        save();
      }
      return data.conversations[id];
    },
    setName(id, name) {
      const c = this.getConversation(id);
      c.name = name.slice(0, 40);
      save();
    },
    addMessage(id, from, text) {
      const c = this.getConversation(id);
      const msg = { from, text: text.slice(0, 2000), at: Date.now() };
      c.messages.push(msg);
      c.updatedAt = msg.at;
      save();
      return msg;
    },
    listConversations() {
      return Object.values(data.conversations).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    deleteConversation(id) {
      delete data.conversations[id];
      save();
    },
    addOwnerToken(token) {
      data.ownerTokens.push(token);
      save();
    },
    isOwnerToken(token) {
      return data.ownerTokens.includes(token);
    },
    addPushSubscription(sub) {
      const exists = data.pushSubscriptions.some((s) => s.endpoint === sub.endpoint);
      if (!exists) {
        data.pushSubscriptions.push(sub);
        save();
      }
    },
    removePushSubscription(endpoint) {
      data.pushSubscriptions = data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
      save();
    },
    listPushSubscriptions() {
      return data.pushSubscriptions;
    }
  };
}

module.exports = { create };
