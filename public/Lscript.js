// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all Lucide icons
    lucide.createIcons();
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    
    
    // Button click handlers
    document.querySelectorAll('.btn').forEach(button => {
        button.addEventListener('click', function(e) {
            // Add click animation
            this.style.transform = 'scale(0.95)';
            
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
            
            // Handle specific button actions
            const text = this.textContent.trim();
            if (text.includes('Start Secure Chat')) {
                window.location.href = 'ITC.html';
            } else if (text.includes('Get Your Secure ID')) {
                // You can redirect to app or show signup modal
                $('registerModal').style.display = 'flex';
                setTimeout(() => {
                    $('name').focus();
                }, 100);
            } else if (text.includes('Download App')) {
                // You can trigger app download
                console.log('Downloading app...');
            } else if (text.includes('Create Group')) {
                // You can show group creation modal
                console.log('Creating group...');
            }
        });
    });
    
    // Intersection Observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe elements for animation
    document.querySelectorAll('.feature-card').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(card);
    });
    
    // Add parallax effect to hero background
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const parallax = document.querySelector('.hero-bg');
        if (parallax) {
            const speed = scrolled * 0.5;
            parallax.style.transform = `translateY(${speed}px)`;
        }
    });
    
    // Add floating animation to security badge
    const securityBadge = document.querySelector('.security-badge');
    if (securityBadge) {
        setInterval(() => {
            securityBadge.style.transform = 'translateY(-2px)';
            setTimeout(() => {
                securityBadge.style.transform = 'translateY(0px)';
            }, 1000);
        }, 2000);
    }
    
    // Mobile menu handling (if needed)
    const handleResize = () => {
        const isMobile = window.innerWidth < 768;
        // Add mobile-specific behavior here if needed
    };
    
    window.addEventListener('resize', handleResize);
    handleResize(); // Call once on load
});

// Utility functions
function generateSecureId() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePhone(phone) {
    const re = /^[\+]?[1-9][\d]{0,15}$/;
    return re.test(phone.replace(/\s/g, ''));
}

// Export functions for use in other scripts if needed
window.EChat = {
    generateSecureId,
    validateEmail,
    validatePhone
};
// Registration Modal Logic
(() => {
    const $ = id => document.getElementById(id);
    let ws = null;

    function setStatus(t, cls) {
        const n = $('status');
        n.textContent = t;
        n.className = 'status ' + cls;
    }

    function connectWS() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        const host = location.hostname || 'localhost';
        const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
        const port = host === 'localhost' ? ':8080' : '';
        ws = new WebSocket(scheme + host + port);

        ws.onopen = () => setStatus('Connected to server', 'ok');
        ws.onclose = () => setStatus('Disconnected from server', 'err');
        ws.onmessage = ev => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            } catch {
                return;
            }

            if (msg.type === 'error') {
                setStatus('Error: ' + msg.message, 'err');
                return;
            }

            if (msg.type === 'registered') {
                const formEl = $('form');
                const resultEl = $('result');
                if (formEl) formEl.style.display = 'none';
                if (resultEl) resultEl.style.display = 'block';
                const myIdInput = $('myId');
                if (myIdInput) myIdInput.value = msg.userId;
                setStatus('Registration successful! Your ID is ready.', 'ok');
                const rememberCheckbox = $('remember');
                if (rememberCheckbox && rememberCheckbox.checked) {
                	alert('Please remember your 8-digit code: ' + msg.userId);
                }
                return;
            }
        };
    }

    // Handle Google Sign-In callback for modal
    window.handleGoogleSignInModal = async (response) => {
        if (response.credential) {
            try {
                setStatus('Verifying your Google account...', 'warn');
                
                // Send token to backend for verification
                const verifyResponse = await fetch('/api/google/verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ token: response.credential })
                });
                
                if (!verifyResponse.ok) {
                    const errorData = await verifyResponse.json();
                    setStatus('Verification failed: ' + (errorData.error || 'Unknown error'), 'err');
                    return;
                }
                
                const verifiedData = await verifyResponse.json();
                const { gmail, name } = verifiedData;
                
                // Register with Gmail automatically
                connectWS();
                setTimeout(() => {
                    try {
                        ws.send(JSON.stringify({ 
                            type: 'register', 
                            name: name, 
                            gmail: gmail 
                        }));
                        setStatus('Creating your account with Gmail...', 'warn');
                    } catch (e) {
                        setStatus('Connection failed. Please try again.', 'err');
                    }
                }, 50);
            } catch (e) {
                setStatus('Failed to process Google Sign-In: ' + e.message, 'err');
            }
        }
    };

    $('btnRegister').onclick = () => {
        const name = $('name').value.trim();
        const mobile = $('mobile').value.trim();
        const gmailModal = $('gmailModal');
        const gmail = gmailModal ? gmailModal.value.trim() : '';

        // Check if registering with Gmail
        if (gmail) {
            if (!name) {
                setStatus('Please enter your full name', 'err');
                return;
            }
            
            const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
            if (!gmailRegex.test(gmail)) {
                setStatus('Please enter a valid Gmail address (@gmail.com)', 'err');
                return;
            }
            
            connectWS();
            setTimeout(() => {
                try {
                    ws.send(JSON.stringify({ type: 'register', name, gmail }));
                    setStatus('Creating your account with Gmail...', 'warn');
                } catch (e) {
                    setStatus('Connection failed. Please try again.', 'err');
                }
            }, 50);
            return;
        }

        // Original mobile registration
        if (!name || !mobile) {
            setStatus('Please enter both name and mobile number, or use Gmail', 'err');
            return;
        }

        if (!/^\+?[0-9]{7,15}$/.test(mobile)) {
            setStatus('Please enter a valid mobile number', 'err');
            return;
        }

        connectWS();
        setTimeout(() => {
            try {
                ws.send(JSON.stringify({
                    type: 'register',
                    name,
                    mobile
                }));
                setStatus('Creating your account...', 'warn');
            } catch (e) {
                setStatus('Connection failed. Please try again.', 'err');
            }
        }, 50);
    };

    $('btnCopy').onclick = async () => {
        const idValue = $('myId').value;
        try {
            await navigator.clipboard.writeText(idValue);
            setStatus('ID copied to clipboard!', 'ok');

            // Visual feedback
            const btn = $('btnCopy');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.style.background = '#10b981';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
            }, 2000);
        } catch (e) {
            setStatus('Copy failed. Please select and copy manually.', 'err');
        }
    };

    // Add enter key support for form submission
    const gmailModal = $('gmailModal');
    if (gmailModal) {
        gmailModal.onkeydown = (e) => {
            if (e.key === 'Enter') {
                $('name').focus();
            }
        };
    }
    
    $('name').onkeydown = (e) => {
        if (e.key === 'Enter') {
            if (gmailModal && gmailModal.value.trim()) {
                $('btnRegister').click();
            } else {
                const mobileInput = $('mobile');
                if (mobileInput) mobileInput.focus();
            }
        }
    };

    const mobileInput = $('mobile');
    if (mobileInput) {
        mobileInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                $('btnRegister').click();
            }
        };
    }

    // Initialize Google Sign-In for modal
    const initGoogleSignInModal = () => {
        // Check if Google API is loaded
        if (typeof google === 'undefined' || !google.accounts) {
            setTimeout(initGoogleSignInModal, 100);
            return;
        }
        
        // Check if Client ID is loaded
        const clientId = window.GOOGLE_CLIENT_ID || '';
        if (!clientId) {
            // If not loaded yet, wait for it
            if (!window.GOOGLE_CLIENT_ID_LOADED) {
                setTimeout(initGoogleSignInModal, 100);
                return;
            } else {
                // Client ID loaded but empty
                console.warn('Client ID is empty after loading');
                showFallbackButtonModal();
                return;
            }
        }
        
        // Both Google API and Client ID are ready
        console.log('✓ Initializing Google Sign-In with Client ID');
        
        try {
            // Update the data attribute
            const onloadDiv = document.getElementById('g_id_onload_modal');
            if (onloadDiv) {
                onloadDiv.setAttribute('data-client_id', clientId);
            }
            
            // Initialize Google Accounts API
            google.accounts.id.initialize({
                client_id: clientId,
                callback: handleGoogleSignInModal,
                auto_select: false,
                cancel_on_tap_outside: true
            });
            console.log('✓ Google Accounts initialized');
            
            // Render the button
            const buttonDiv = document.getElementById('g_id_signin_modal');
            if (buttonDiv) {
                google.accounts.id.renderButton(buttonDiv, {
                    type: 'standard',
                    size: 'large',
                    text: 'sign_in_with',
                    shape: 'rectangular',
                    theme: 'outline',
                    logo_alignment: 'left',
                    width: '100%'
                });
                console.log('✓ Google Sign-In button rendered successfully');
            }
        } catch (e) {
            console.error('Google Sign-In initialization error:', e);
            showFallbackButtonModal();
        }
    };
    
    const showFallbackButtonModal = () => {
        const container = document.querySelector('#registerModal .google-signin-container');
        if (container) {
            console.warn('Google Sign-In not available - Client ID not configured');
            container.innerHTML = '<div style="text-align:center; padding:12px; color:#6b7280; font-size:14px;">Google Sign-In unavailable</div>';
        }
    };

    // Modal open/close logic
    $('btnOpenRegister').onclick = function() {
        // Reset form when opening modal
        const formEl = $('form');
        const resultEl = $('result');
        if (formEl) formEl.style.display = 'block';
        if (resultEl) resultEl.style.display = 'none';
        
        // Clear form fields
        const gmailInput = $('gmailModal');
        const nameInput = $('name');
        const mobileInput = $('mobile');
        if (gmailInput) gmailInput.value = '';
        if (nameInput) nameInput.value = '';
        if (mobileInput) mobileInput.value = '';
        
        // Reset status
        setStatus('Ready to register', 'warn');
        
        // Initialize Google Sign-In when modal opens
        setTimeout(initGoogleSignInModal, 100);
        
        $('registerModal').style.display = 'flex';
        setTimeout(() => {
            if (gmailInput) {
                gmailInput.focus();
            } else if (nameInput) {
                nameInput.focus();
            }
        }, 200);
    };

    $('btnCloseRegister').onclick = function() {
        $('registerModal').style.display = 'none';
    };

    // Close modal if clicking outside of it
    window.onclick = function(event) {
        const modal = $('registerModal');
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
})();