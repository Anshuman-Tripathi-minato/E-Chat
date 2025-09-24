const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Persistent user database (JSON file) and in-memory sessions
const DB_FILE = process.env.ECHAT_DB_FILE || path.resolve('/home/minato/Desktop/e_chat_db.json');
/**
 * dbUsers: Map of userId -> { id, name, mobile }
 */
let dbUsers = new Map();
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      dbUsers = new Map(arr.map(u => [u.id, u]));
    }
  }
} catch (e) {
  console.error('Failed to load DB file:', e);
}

function saveDb() {
  try {
    const arr = Array.from(dbUsers.values());
    fs.writeFileSync(DB_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('Failed to save DB file:', e);
  }
}

// In-memory online sessions (ephemeral; restarts clear online state)
const users = new Map(); // userId -> { ws: WebSocket|null }

function generateUserId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    id = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (dbUsers.has(id));
  return id;
}

function send(ws, type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcastPresence() {
  const online = Array.from(users.entries())
    .filter(([, v]) => v.ws)
    .map(([id]) => id);
  for (const [, rec] of users) {
    if (rec.ws) send(rec.ws, 'presence', { online });
  }
}

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  let myId = null;

  ws.on('message', msgRaw => {
    let msg;
    try { msg = JSON.parse(msgRaw); } catch {
      return send(ws, 'error', { message: 'Invalid JSON' });
    }

    switch (msg.type) {
      case 'register': {
        const { name, mobile } = msg;
        if (!name || !mobile) return send(ws, 'error', { message: 'name and mobile required' });
        // Basic mobile normalization and uniqueness check on (name,mobile) pair
        const existing = Array.from(dbUsers.values()).find(u => u.mobile === String(mobile).trim());
        if (existing) return send(ws, 'error', { message: 'mobile already registered' });
        const id = generateUserId();
        const user = { id, name: String(name).trim(), mobile: String(mobile).trim() };
        dbUsers.set(id, user);
        saveDb();
        // Prepare online session container
        if (!users.has(id)) users.set(id, { ws: null });
        return send(ws, 'registered', { userId: id, name: user.name });
      }
      case 'login': {
        const { userId } = msg;
        if (!userId) return send(ws, 'error', { message: 'userId required' });
        const user = dbUsers.get(userId);
        if (!user) return send(ws, 'error', { message: 'invalid userId' });
        if (!users.has(userId)) users.set(userId, { ws: null });
        const rec = users.get(userId);
        if (rec.ws && rec.ws !== ws) {
          try { rec.ws.close(); } catch {}
        }
        rec.ws = ws;
        myId = userId;
        send(ws, 'logged_in', { userId, name: user.name });
        broadcastPresence();
        return;
      }
      case 'logout': {
        if (myId && users.has(myId)) {
          const rec = users.get(myId);
          if (rec.ws === ws) rec.ws = null;
        }
        myId = null;
        send(ws, 'logged_out', {});
        broadcastPresence();
        return;
      }
      case 'signal': {
        if (!myId) return send(ws, 'error', { message: 'not logged in' });
        const { to, payload } = msg;
        if (!to || !payload) return send(ws, 'error', { message: 'to and payload required' });
        const rec = users.get(to);
        if (!rec || !rec.ws) return send(ws, 'error', { message: 'recipient offline' });
        return send(rec.ws, 'signal', { from: myId, payload });
      }
      default:
        return send(ws, 'error', { message: 'unknown type' });
    }
  });

  ws.on('close', () => {
    if (myId && users.has(myId)) {
      const rec = users.get(myId);
      if (rec.ws === ws) rec.ws = null;
      broadcastPresence();
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('Signaling server listening on :' + PORT);
}); 