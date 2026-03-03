# Google Sign-In Debug & Setup Checklist

## ✅ What Has Been Fixed

1. **Backend Token Verification** (`server.js`)
   - ✅ Added `oauth2-client` initialization  
   - ✅ Created `/api/google/verify` endpoint
   - ✅ Server reads `GOOGLE_CLIENT_ID` from environment variable
   - ✅ Falls back to hardcoded ID in `server.js` line 44

2. **Frontend Token Submission**
   - ✅ **Landing Page Modal** (`Lscript.js` line 182+): Uses `handleGoogleSignInModal` with server verification
   - ✅ **Register Page** (`EChat-register.js` line 47+): Uses `handleGoogleSignIn` with server verification
   - ✅ Both send token to `/api/google/verify` endpoint instead of decoding locally

3. **Configuration**
   - ✅ `google-config.js`: Sets `window.GOOGLE_CLIENT_ID` from environment
   - ✅ Server uses environment variable `GOOGLE_CLIENT_ID`

---

## 🔍 Verification Steps

### Step 1: Check Server Configuration
```bash
# Make sure your server has the Client ID configured
echo $GOOGLE_CLIENT_ID
```

If empty, set it:
```bash
export GOOGLE_CLIENT_ID="30620890774-lfh29b08bh0c8jdci4s0i0ls7n5geej1.apps.googleusercontent.com"
```

### Step 2: Start Your Server
```bash
npm start
```

You should see:
```
Server running on port 8080
```

### Step 3: Open Browser DevTools (F12)
1. Go to `http://localhost:8080`
2. Click **"Register Yourself"** button in CTA section OR **"Get Your Secure ID"**
3. A modal should appear with "Sign in with Google" button
4. Open **Network** tab in DevTools

### Step 4: Test Google Sign-In Flow
1. Click "Sign in with Google" button in modal
2. Complete Google authentication
3. **Watch the Network tab** - you should see:
   - ✅ Request to `/api/google/verify` (POST)
   - ✅ Response with `{ success: true, gmail: "...", name: "..." }`

### Step 5: Check Console for Errors
1. Open **Console** tab in DevTools
2. Look for any red error messages
3. Common errors and solutions below

---

## 🐛 Troubleshooting

### Error: "Invalid or expired token"
**Cause**: Token verification failed on backend
- Check `GOOGLE_CLIENT_ID` environment variable is set correctly
- Ensure Client ID matches the one in Google Cloud Console
- Token may have expired (shouldn't happen in same session)

### Error: "Google Client ID not configured on server"
**Cause**: `process.env.GOOGLE_CLIENT_ID` is undefined
- Set environment variable before starting server:
  ```bash
  export GOOGLE_CLIENT_ID="your-client-id"
  npm start
  ```

### Error: "Please use a Gmail account"
**Cause**: Non-Gmail account was used
- Only @gmail.com addresses are allowed
- Edit `server.js` line 60 to allow other domains if needed

### Google Sign-In Button Doesn't Appear
**Cause**: `window.GOOGLE_CLIENT_ID` is empty
- Verify `google-config.js` has the Client ID set
- Check that `/api/google/verify` endpoint exists
- In console, type: `console.log(window.GOOGLE_CLIENT_ID)` - should not be empty

### CORS Error: "No 'Access-Control-Allow-Origin'"
**Cause**: Domain not in Google Cloud Console authorized origins
- Go to Google Cloud Console
- Add your domain to "Authorized JavaScript origins"
- For local: `http://localhost:8080`
- For production: `https://yourdomain.com`

---

## 📝 API Endpoint Reference

### `/api/google/verify` (POST)

**Request:**
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ..."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "gmail": "user@gmail.com",
  "name": "User Name"
}
```

**Error Response (400/401):**
```json
{
  "error": "Invalid or expired token"
}
```

---

## 🧪 Manual Testing Without Browser

### Test Backend Token Verification
```bash
# Get a valid token from Google (manual process)
# Then test with curl:

curl -X POST http://localhost:8080/api/google/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN_HERE"}'
```

---

## 📋 Files Modified

| File | Change | Line |
|------|--------|------|
| `server.js` | Added `OAuth2Client` import | 6 |
| `server.js` | Added `/api/google/verify` endpoint | 44-68 |
| `public/Lscript.js` | Updated `handleGoogleSignInModal` to use backend verification | 182+ |
| `public/EChat-register.js` | Updated `handleGoogleSignIn` to use backend verification | 47+ |
| `public/google-config.js` | Updated comments to explain server-side flow | 1+ |

---

## ✨ Next Steps

1. ✅ Verify `GOOGLE_CLIENT_ID` environment variable is set
2. ✅ Start the server: `npm start`
3. ✅ Test on landing page: http://localhost:8080
4. ✅ Test on register page: http://localhost:8080/register
5. ✅ Check DevTools Network tab to confirm `/api/google/verify` requests succeed
