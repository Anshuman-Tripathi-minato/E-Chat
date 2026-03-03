// Google OAuth Client ID Configuration
// The Client ID is fetched from the server's .env file
// To configure: Add GOOGLE_CLIENT_ID to .env file in project root

// Initialize as empty
window.GOOGLE_CLIENT_ID = '';
window.GOOGLE_CLIENT_ID_LOADED = false;

// Fetch Client ID from server
(async function() {
    try {
        const response = await fetch('/api/google-client-id');
        if (response.ok) {
            const data = await response.json();
            window.GOOGLE_CLIENT_ID = data.clientId;
            window.GOOGLE_CLIENT_ID_LOADED = true;
            console.log('✓ Google Client ID loaded from server');
            
            // Dispatch event to notify that Client ID is loaded
            window.dispatchEvent(new Event('googleClientIdLoaded'));
        } else {
            console.error('✗ Failed to load Google Client ID from server');
            window.GOOGLE_CLIENT_ID = '';
            window.GOOGLE_CLIENT_ID_LOADED = true;
        }
    } catch (error) {
        console.error('✗ Error loading Google Client ID:', error);
        window.GOOGLE_CLIENT_ID = '';
        window.GOOGLE_CLIENT_ID_LOADED = true;
    }
})();
