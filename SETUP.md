# Quick Setup Guide

## 🚀 Quick Start (5 Minutes)

### Step 1: Install Node.js
If Node.js is not installed:
- Download from: https://nodejs.org/
- Install the LTS version (recommended)
- Verify installation:
  ```bash
  node --version   # Should show v14.x or higher
  npm --version    # Should show 6.x or higher
  ```

### Step 2: Copy Project Files
Copy the entire `E-chat` folder to your new computer.

### Step 3: Install Dependencies
Open terminal/command prompt in the project folder:

```bash
# Navigate to project folder
cd /path/to/E-chat

# Install all required packages
npm install
```

**Expected output:**
```
added 150 packages in 30s
```

### Step 4: Start the Server
```bash
npm start
```

**Expected output:**
```
Server running on port 8080
```

### Step 5: Open in Browser
Open your web browser and go to:
```
http://localhost:8080
```

## ✅ Verification Checklist

- [ ] Node.js installed (v14+)
- [ ] npm installed
- [ ] Project files copied
- [ ] Dependencies installed (`node_modules` folder exists)
- [ ] Server starts without errors
- [ ] Browser can access `http://localhost:8080`

## 📋 Required Files Checklist

Make sure these files/folders are present:
- [ ] `server.js`
- [ ] `package.json`
- [ ] `public/` folder with all HTML/CSS/JS files
- [ ] `node_modules/` folder (after npm install)

## 🆘 Common Issues

### "command not found: node" or "command not found: npm"
**Solution**: Node.js is not installed or not in PATH. Install Node.js and restart terminal.

### "Cannot find module 'express'"
**Solution**: Run `npm install` in the project folder.

### "Port 8080 already in use"
**Solution**: 
- Change port: `set PORT=3000` (Windows) or `export PORT=3000` (Linux/Mac)
- Or close the application using port 8080

### "EACCES: permission denied"
**Solution**: On Linux/Mac, you might need sudo. Better solution: Fix npm permissions.

## 🌐 Accessing from Other Devices

### On Same Network:
1. Find your computer's IP:
   - Windows: `ipconfig` → Look for "IPv4 Address"
   - Linux/Mac: `ifconfig` or `ip addr`
2. On other device's browser: `http://YOUR_IP:8080`
3. Make sure firewall allows port 8080

### Example:
```
Your computer IP: 192.168.1.100
Other device URL: http://192.168.1.100:8080
```

## 📦 What Gets Installed

When you run `npm install`, it installs:

**Direct Dependencies:**
- `express` - Web server framework (handles HTTP requests)
- `ws` - WebSocket library (handles real-time connections)

**Sub-dependencies** (installed automatically):
- Various utility packages needed by express and ws
- Total: ~150 packages (all managed automatically)

**You don't need to install these manually** - npm handles everything!

## 🔄 Updating Dependencies

To update packages to latest compatible versions:
```bash
npm update
```

## 📝 Minimal Setup (Copy These Files Only)

**Minimum required files to transfer:**
```
E-chat/
├── server.js
├── package.json
└── public/
    ├── *.html
    ├── *.js
    └── *.css
```

**Don't need to copy:**
- `node_modules/` (will be recreated with `npm install`)
- `package-lock.json` (optional, helps with consistent installs)
- `e_chat_db.json` (will be created automatically)

---

**That's it! You're ready to go!** 🎉

