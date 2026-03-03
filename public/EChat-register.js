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
		ws = new WebSocket(scheme + host + ':8080');
		
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
				$('form').style.display = 'none';
				$('result').style.display = 'block';
				$('myId').value = msg.userId;
				setStatus('Registration successful! Your ID is ready.', 'ok');
				if ($('remember').checked) {
					alert('Please remember your 8-digit code: ' + msg.userId);
				}
				return;
			}
		};
	}

	// Handle Google Sign-In callback
	window.handleGoogleSignIn = async (response) => {
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
		const gmail = $('gmail').value.trim();
		
		// Check if registering with Gmail
		if (gmail) {
			if (!name) {
				setStatus('Please enter your full name', 'err');
				return;
			}
			
			// Validate Gmail format
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
				ws.send(JSON.stringify({ type: 'register', name, mobile })); 
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
	$('gmail').onkeydown = (e) => {
		if (e.key === 'Enter') {
			$('name').focus();
		}
	};
	
	$('name').onkeydown = (e) => {
		if (e.key === 'Enter') {
			if ($('gmail').value.trim()) {
				$('btnRegister').click();
			} else {
				$('mobile').focus();
			}
		}
	};
	
	$('mobile').onkeydown = (e) => {
		if (e.key === 'Enter') {
			$('btnRegister').click();
		}
	};

	// Initialize Google Sign-In when page loads
	window.onload = () => {
		// Wait for Google Identity Services to load
		const initGoogleSignIn = () => {
			// Check if Google API is loaded
			if (typeof google === 'undefined' || !google.accounts) {
				setTimeout(initGoogleSignIn, 100);
				return;
			}
			
			// Check if Client ID is loaded
			const clientId = window.GOOGLE_CLIENT_ID || '';
			if (!clientId) {
				// If not loaded yet, wait for it
				if (!window.GOOGLE_CLIENT_ID_LOADED) {
					setTimeout(initGoogleSignIn, 100);
					return;
				} else {
					// Client ID loaded but empty
					console.warn('Client ID is empty after loading');
					showFallbackButton();
					return;
				}
			}
			
			// Both Google API and Client ID are ready
			console.log('✓ Initializing Google Sign-In with Client ID');
			
			try {
				// Update the data attribute
				const onloadDiv = document.getElementById('g_id_onload');
				if (onloadDiv) {
					onloadDiv.setAttribute('data-client_id', clientId);
				}
				
				google.accounts.id.initialize({
					client_id: clientId,
					callback: handleGoogleSignIn,
					auto_select: false,
					cancel_on_tap_outside: true
				});
				
				// Render the button
				const buttonDiv = document.getElementById('g_id_signin');
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
					console.log('✓ Google Sign-In button rendered on register page');
				}
			} catch (e) {
				console.error('Google Sign-In button render error:', e);
				showFallbackButton();
			}
		};
		
		const showFallbackButton = () => {
			const container = document.querySelector('.google-signin-container');
			if (container) {
				console.warn('Google Sign-In not available - Client ID not configured');
				container.innerHTML = '<div style="text-align:center; padding:12px; color:#6b7280; font-size:14px;">Google Sign-In unavailable</div>';
			}
		};
		
		initGoogleSignIn();
		
		// Auto-focus on Gmail input if available
		setTimeout(() => {
			if ($('gmail')) {
				$('gmail').focus();
			} else if ($('name')) {
				$('name').focus();
			}
		}, 500);
	};
})();
