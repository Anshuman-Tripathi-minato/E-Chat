require('dotenv').config();
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const { OAuth2Client } = require("google-auth-library");

// --- Database Setup ---
const DB_FILE = process.env.ECHAT_DB_FILE || path.resolve("e_chat_db.json");
let dbUsers = new Map();
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      dbUsers = new Map(arr.map((u) => [u.id, u]));
    }
  }
} catch (e) {
  console.error("Failed to load DB file:", e);
}
function saveDb() {
  try {
    const arr = Array.from(dbUsers.values());
    fs.writeFileSync(DB_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error("Failed to save DB file:", e);
  }
}

// --- Express App to serve frontend ---
const app = express();

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json()); // Parse JSON bodies

// Set COOP/COEP headers to allow Google OAuth postMessage
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// Initialize Google OAuth2Client
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

console.log("🔐 Google Client ID configured:", GOOGLE_CLIENT_ID ? '✓ Yes' : '✗ No');

// Endpoint to serve Google Client ID to frontend
app.get("/api/google-client-id", (req, res) => {
  if (GOOGLE_CLIENT_ID) {
    res.json({ clientId: GOOGLE_CLIENT_ID });
  } else {
    res.status(500).json({ error: "Google Client ID not configured" });
  }
});

// Debug endpoint to check configuration
app.get("/api/config", (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.substring(0, 20) + '...' : 'NOT SET',
    isConfigured: !!GOOGLE_CLIENT_ID
  });
});

// Google Token Verification Endpoint
app.post("/api/google/verify", async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }
    
    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "Google Client ID not configured on server" });
    }
    
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const gmail = payload.email;
    const name = payload.name || payload.given_name || 'User';
    
    // Verify it's a Gmail account
    if (!gmail || !gmail.toLowerCase().endsWith('@gmail.com')) {
      return res.status(400).json({ error: "Please use a Gmail account" });
    }
    
    return res.status(200).json({
      success: true,
      gmail: gmail,
      name: name
    });
  } catch (error) {
    console.error("Token verification error:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
});

// Default → landing_page.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing_page.html"));
});

// /register → EChat-register.html
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "EChat-register.html"));
});

// /itc → ITC.html
app.get("/itc", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ITC.html"));
});

// --- HTTP + WebSocket Server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory online sessions
const users = new Map(); // userId -> { ws }
function generateUserId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  do {
    id = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
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
    if (rec.ws) send(rec.ws, "presence", { online });
  }
}

// --- WebSocket Handling ---
wss.on("connection", (ws) => {
  let myId = null;

  ws.on("message", (msgRaw) => {
    let msg;
    try {
      msg = JSON.parse(msgRaw);
    } catch {
      return send(ws, "error", { message: "Invalid JSON" });
    }

    switch (msg.type) {
      case "register": {
        const { name, mobile, gmail } = msg;
        if (!name) return send(ws, "error", { message: "name is required" });
        
        // Register with Gmail
        if (gmail) {
          const gmailLower = String(gmail).trim().toLowerCase();
          if (!gmailLower.endsWith('@gmail.com')) {
            return send(ws, "error", { message: "Please use a valid Gmail address (@gmail.com)" });
          }
          
          // Check if Gmail already exists
          const existing = Array.from(dbUsers.values()).find((u) => u.gmail && u.gmail.toLowerCase() === gmailLower);
          if (existing) {
            return send(ws, "registered", { userId: existing.id, name: existing.name });
          }
          
          const id = generateUserId();
          const user = { id, name: String(name).trim(), gmail: gmailLower };
          dbUsers.set(id, user);
          saveDb();
          if (!users.has(id)) users.set(id, { ws: null });
          return send(ws, "registered", { userId: id, name: user.name });
        }
        
        // Register with mobile (original flow)
        if (!mobile) return send(ws, "error", { message: "mobile or gmail is required" });
        const existing = Array.from(dbUsers.values()).find((u) => u.mobile === String(mobile).trim());
        if (existing) return send(ws, "error", { message: "mobile already registered" });
        const id = generateUserId();
        const user = { id, name: String(name).trim(), mobile: String(mobile).trim() };
        dbUsers.set(id, user);
        saveDb();
        if (!users.has(id)) users.set(id, { ws: null });
        return send(ws, "registered", { userId: id, name: user.name });
      }
      case "login": {
        const { userId: providedUserId, gmail } = msg;
        
        // Login with Gmail
        if (gmail) {
          const gmailLower = String(gmail).trim().toLowerCase();
          const user = Array.from(dbUsers.values()).find((u) => u.gmail && u.gmail.toLowerCase() === gmailLower);
          if (!user) return send(ws, "error", { message: "Gmail not registered. Please register first." });
          
          const foundUserId = user.id;
          if (!users.has(foundUserId)) users.set(foundUserId, { ws: null });
          const rec = users.get(foundUserId);
          if (rec.ws && rec.ws !== ws) {
            try {
              rec.ws.close();
            } catch {}
          }
          rec.ws = ws;
          myId = foundUserId;
          send(ws, "logged_in", { userId: foundUserId, name: user.name });
          broadcastPresence();
          return;
        }
        
        // Login with userId (original flow)
        if (!providedUserId) return send(ws, "error", { message: "userId or gmail required" });
        const user = dbUsers.get(providedUserId);
        if (!user) return send(ws, "error", { message: "invalid userId" });
        if (!users.has(providedUserId)) users.set(providedUserId, { ws: null });
        const rec = users.get(providedUserId);
        if (rec.ws && rec.ws !== ws) {
          try {
            rec.ws.close();
          } catch {}
        }
        rec.ws = ws;
        myId = providedUserId;
        send(ws, "logged_in", { userId: providedUserId, name: user.name });
        broadcastPresence();
        return;
      }
      case "logout": {
        if (myId && users.has(myId)) {
          const rec = users.get(myId);
          if (rec.ws === ws) rec.ws = null;
        }
        myId = null;
        send(ws, "logged_out", {});
        broadcastPresence();
        return;
      }
      case "signal": {
        if (!myId) return send(ws, "error", { message: "not logged in" });
        const { to, payload } = msg;
        if (!to || !payload) return send(ws, "error", { message: "to and payload required" });
        const rec = users.get(to);
        if (!rec || !rec.ws) return send(ws, "error", { message: "recipient offline" });
        return send(rec.ws, "signal", { from: myId, payload });
      }
      default:
        return send(ws, "error", { message: "unknown type" });
    }
  });

  ws.on("close", () => {
    if (myId && users.has(myId)) {
      const rec = users.get(myId);
      if (rec.ws === ws) rec.ws = null;
      broadcastPresence();
    }
  });
});

// --- Start server on Render's PORT ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});