# E-Chat - Secure End-to-End Encrypted Messaging

Deployed - [https://web-production-d1aa3.up.railway.app/](https://web-production-d1aa3.up.railway.app/)

A secure messaging application with military-grade encryption, supporting both mobile and Gmail registration, file transfers up to 500MB, and real-time communication.

## 📋 Requirements

### System Requirements
- **Operating System**: Windows, macOS, or Linux
- **Node.js**: Version 14.x or higher (recommended: 18.x or latest LTS)
- **npm**: Version 6.x or higher (comes with Node.js)
- **Web Browser**: Modern browser with WebRTC support (Chrome, Firefox, Edge, Safari)

### Node.js Installation
- **Windows/Mac**: Download from [nodejs.org](https://nodejs.org/)
- **Linux**: 
  ```bash
  # Ubuntu/Debian
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  
  # Or use package manager
  sudo apt install nodejs npm
  ```

## 📦 Dependencies

### Core Dependencies
The project requires the following npm packages:

```json
{
  "express": "^5.1.0",              // Web server framework
  "ws": "^8.19.0",                  // WebSocket library for real-time communication
  "google-auth-library": "^10.5.0", // Google OAuth authentication
  "dotenv": "^17.2.3"               // Environment variable management
}
```

### Built-in Node.js Modules (No installation needed)
- `http` - HTTP server
- `path` - File path utilities
- `fs` - File system operations
- `crypto` - Used in frontend (browser built-in)

## 🚀 Installation Steps

### 1. Copy Project Files
Copy the entire project folder to the target computer/desktop.

### 2. Install Dependencies
Open terminal/command prompt in the project directory and run:

```bash
npm install
```

This will install:
- `express` (web server)
- `ws` (WebSocket library)
- `google-auth-library` (Google OAuth authentication)
- `dotenv` (environment variable management)
- All their sub-dependencies automatically

### 3. Configure Environment Variables (Required for Google Sign-In)
Create a `.env` file in the project root directory:

```bash
# .env file
GOOGLE_CLIENT_ID=your-google-client-id-here.apps.googleusercontent.com
PORT=8080
ECHAT_DB_FILE=./e_chat_db.json
```

**To get your Google Client ID:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized origins (e.g., `http://localhost:8080`)
6. Copy the Client ID

See [GOOGLE_SIGNIN_SETUP.md](GOOGLE_SIGNIN_SETUP.md) for detailed setup instructions.

### 4. Verify Installation
Check if dependencies are installed correctly:

```bash
npm list
```

You should see:
```
e-chat@1.0.0
├── dotenv@17.2.3
├── express@5.1.0
├── google-auth-library@10.5.0
└── ws@8.19.0
```

## ⚙️ Configuration

### Port Configuration
By default, the server runs on port **8080**. To change it:

**Option 1**: Set environment variable
```bash
# Windows (Command Prompt)
set PORT=3000
node server.js

# Windows (PowerShell)
$env:PORT=3000
node server.js

# Linux/Mac
export PORT=3000
node server.js
```

**Option 2**: Edit `server.js` (line 202)
```javascript
const PORT = process.env.PORT || 3000; // Change 8080 to your preferred port
```

### Environment Variables
The application supports the following environment variables (configure in `.env` file):

- **GOOGLE_CLIENT_ID**: Google OAuth Client ID (required for Google Sign-In)
- **PORT**: Server port (default: 8080)
- **ECHAT_DB_FILE**: Database file path (default: ./e_chat_db.json)

**Example .env file:**
```env
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
PORT=8080
ECHAT_DB_FILE=./e_chat_db.json
```

### Database Configuration
User data is stored in `e_chat_db.json`. Database file location can be configured via environment variable:

```bash
# Windows
set ECHAT_DB_FILE=C:\path\to\your\database.json

# Linux/Mac
export ECHAT_DB_FILE=/path/to/your/database.json
```

Default location: `e_chat_db.json` in project root.

### Google Sign-In Configuration (Optional)
To enable Google Sign-In, edit `public/google-config.js`:

```javascript
window.GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';
```

## 🏃 Running the Application

### Start the Server
```bash
npm start
```

Or directly:
```bash
node server.js
```

You should see:
```
Server running on port 8080
```

### Access the Application
Open your web browser and navigate to:
- **Main Page**: `http://localhost:8080`
- **Registration**: `http://localhost:8080/register`
- **Chat Interface**: `http://localhost:8080/itc`

### For Network Access (Other Devices)
If you want to access from other devices on the same network:

1. Find your computer's IP address:
   - **Windows**: `ipconfig` (look for IPv4 Address)
   - **Linux/Mac**: `ifconfig` or `ip addr`
   
2. Access from other devices:
   ```
   http://YOUR_IP_ADDRESS:8080
   ```

3. **Important**: Make sure firewall allows port 8080 (or your chosen port)

## 📁 Project Structure

```
E-chat/
├── server.js                 # Main server file
├── package.json              # Dependencies configuration
├── package-lock.json         # Locked dependency versions
├── e_chat_db.json           # User database (auto-created)
├── node_modules/            # Installed dependencies (after npm install)
├── public/                  # Frontend files
│   ├── landing_page.html    # Landing page
│   ├── EChat-register.html  # Registration page
│   ├── EChat-register.js    # Registration logic
│   ├── EChat-register.css   # Registration styles
│   ├── ITC.html             # Chat interface
│   ├── ITC.js               # Chat logic
│   ├── ITC.css              # Chat styles
│   ├── Lscript.js           # Landing page scripts
│   ├── Lstyles.css          # Landing page styles
│   └── google-config.js     # Google OAuth configuration
└── README.md                # This file
```

## 🔧 Troubleshooting

### Port Already in Use
If port 8080 is already in use:
```bash
# Windows - Find process using port 8080
netstat -ano | findstr :8080

# Linux/Mac - Find process using port 8080
lsof -i :8080

# Kill the process or use a different port (see Configuration section)
```

### Dependencies Not Installing
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json, then reinstall
rm -rf node_modules package-lock.json  # Linux/Mac
rmdir /s node_modules package-lock.json  # Windows

npm install
```

### Module Not Found Errors
Make sure you've run `npm install` and `node_modules` folder exists.

### Cannot Access from Other Devices
1. Check firewall settings (allow port 8080)
2. Ensure devices are on the same network
3. Verify server is listening on `0.0.0.0` (not just `localhost`)
4. Check if router blocks local connections

## 📝 Environment Variables Summary

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port number | 8080 |
| `ECHAT_DB_FILE` | Path to database JSON file | `e_chat_db.json` |

## 🔒 Security Notes

- All communication is end-to-end encrypted
- User data is stored locally in JSON file
- No external database required
- WebRTC used for peer-to-peer connections
- AES-256-GCM encryption for messages
- ECDH key exchange for secure channels

## 📞 Support

For issues or questions, check:
- Node.js version compatibility
- Browser console for errors (F12)
- Server console output for server-side errors
- Network connectivity and firewall settings

## 📄 License

ISC License

---

**Made with ❤️ for secure communication**

