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
				return;
			}
		};
	}

	$('btnRegister').onclick = () => {
		const name = $('name').value.trim();
		const mobile = $('mobile').value.trim();
		
		if (!name || !mobile) { 
			setStatus('Please enter both name and mobile number', 'err'); 
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
	$('name').onkeydown = (e) => {
		if (e.key === 'Enter') {
			$('mobile').focus();
		}
	};
	
	$('mobile').onkeydown = (e) => {
		if (e.key === 'Enter') {
			$('btnRegister').click();
		}
	};

	// Auto-focus on name input when page loads
	window.onload = () => {
		$('name').focus();
	};
})();
