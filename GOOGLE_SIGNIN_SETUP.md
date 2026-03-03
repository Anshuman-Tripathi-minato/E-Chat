# Google Sign-In Setup Guide

This application now uses secure server-side token verification for Google Sign-In.

## Prerequisites
- `google-auth-library` package installed (run: `npm install google-auth-library`)

## Steps to Configure

### 1. Get Your Google OAuth Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Search for "Google+ API" in the search bar
   - Click "Enable"
4. Navigate to "Credentials" in the left sidebar
5. Click "Create Credentials" → "OAuth client ID"
6. Choose "Web application"
7. Add your authorized origins:
   - For local development: `http://localhost:8080`
   - For production: `https://yourdomain.com`
8. Copy your Client ID (it looks like: `123456789-abcdefghijklmnop.apps.googleusercontent.com`)

### 2. Configure the Server

Set the `GOOGLE_CLIENT_ID` environment variable:

**For local development:**
```bash
export GOOGLE_CLIENT_ID="your-client-id-here"
npm start
```

**For production (e.g., Render):**
1. Add `GOOGLE_CLIENT_ID` as an environment variable in your deployment settings
2. The server will automatically read it from `process.env.GOOGLE_CLIENT_ID`

### 3. Frontend Configuration (Optional)

The `public/google-config.js` file can optionally store the Client ID if needed, but the server's environment variable is the primary source.

## How It Works

1. **Frontend**: User clicks "Sign in with Google"
2. **Google**: Issues an ID token to the frontend
3. **Frontend**: Sends the token to `/api/google/verify` endpoint
4. **Backend**: Verifies the token using `OAuth2Client` and Google's public keys
5. **Backend**: Extracts user email and name, then registers/logs in the user
6. **Response**: Frontend receives verified user info and proceeds with registration

## Security Benefits

- ✅ Token verification happens on trusted server, not in browser
- ✅ Uses Google's official `google-auth-library`
- ✅ Prevents token tampering
- ✅ Validates token signature and expiration
- ✅ Email domain verification (ensures Gmail addresses)

## Testing

1. Start your server with the `GOOGLE_CLIENT_ID` environment variable set
2. Go to `http://localhost:8080/register`
3. Click "Sign in with Google" button
4. Complete the Google authentication flow
5. Your account should be created and registered

## Troubleshooting

- **"Invalid or expired token"**: Token may have expired or Client ID is misconfigured
- **"Google Client ID not configured"**: Set the `GOOGLE_CLIENT_ID` environment variable on the server
- **"Please use a Gmail account"**: Only @gmail.com addresses are allowed (configurable in code)
- **CORS errors**: Ensure your domain is added to authorized origins in Google Cloud Console
