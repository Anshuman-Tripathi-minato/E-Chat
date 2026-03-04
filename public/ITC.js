(async()=>{
  const $=id=>document.getElementById(id);
  const enc=new TextEncoder(), dec=new TextDecoder();
  let ws, myId=null, myName=null;
  const peers = new Map();
  let activePeerId = null; // current DM target or group id
  const conversations = new Map(); // id -> { name, unread, members?: string[] }
  const chatMessages = new Map(); // chatId -> messages
  const pendingSends = new Map();
  const chatKeys = new Map(); // chatId -> encryption key
  const incomingFileChunks = new Map(); // fileId -> { meta, chunks: Map<chunkIndex, ArrayBuffer>, receivedCount, startTime }
  const orphanedChunks = new Map(); // fileId -> Array of chunks received before file_start

	// Light mode only: no theme persistence

  const b64 = {
    enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: str => Uint8Array.from(atob(str), c=>c.charCodeAt(0)).buffer
  };

  // Generate 256-bit encryption key for chat
  async function generateChatKey(chatId) {
    if (chatKeys.has(chatId)) return chatKeys.get(chatId);
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, true, ['encrypt', 'decrypt']);
    const exported = await crypto.subtle.exportKey('raw', key);
    const keyHex = Array.from(new Uint8Array(exported)).map(b => b.toString(16).padStart(2, '0')).join('');
    chatKeys.set(chatId, keyHex);
    return keyHex;
  }

  // Show encryption details modal
  function showEncryptionModal(chatId) {
    const modal = $('encryptionModal');
    const title = $('modalTitle');
    const keyDisplay = $('encryptionKey');
    const groupMembers = $('groupMembers');
    const memberList = $('memberList');
		
		// Set title
    if (chatId && chatId.startsWith('grp:')) {
      const chat = conversations.get(chatId);
      title.textContent = `Group: ${chat ? chat.name : chatId}`;
    } else {
      title.textContent = `Chat with ${chatId || 'Unknown'}`;
    }
		
		// Generate and display key
    generateChatKey(chatId).then(key => {
      keyDisplay.textContent = key;
    });
		
		// Show group members if it's a group
    if (chatId && chatId.startsWith('grp:')) {
      const chat = conversations.get(chatId);
      if (chat && chat.members) {
        groupMembers.style.display = 'block';
        memberList.innerHTML = '';
        chat.members.forEach(memberId => {
          const li = document.createElement('li');
          li.innerHTML = `
            <div class="avatar">${memberId.slice(0,2)}</div>
            <div class="member-info">
              <div class="member-name">${memberId}</div>
              <div class="member-id">ID: ${memberId}</div>
            </div>
          `;
          memberList.appendChild(li);
        });
      }
    } else {
      groupMembers.style.display = 'none';
    }
		
    modal.style.display = 'flex';
  }

  // Close modal
  function closeEncryptionModal() {
    $('encryptionModal').style.display = 'none';
  }

  // Copy key to clipboard
  function copyKeyToClipboard() {
    const keyText = $('encryptionKey').textContent;
    navigator.clipboard.writeText(keyText).then(() => {
      const btn = $('copyKey');
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.background = '#10b981';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = keyText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    });
  }

  function setStatus(t,cls){ $('status').textContent=t; $('status').className="status "+cls; }
  function fmtTime(){ const d=new Date(); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
  function pushStore(chatId, entry){ if(!chatMessages.has(chatId)) chatMessages.set(chatId, []); chatMessages.get(chatId).push(entry); }
  function renderChatLog(){ const log=$('log'); if(!log) return; log.innerHTML=''; const cid=activePeerId; if(!cid) return; const arr=chatMessages.get(cid)||[]; for(const m of arr){ if(m.kind==='file') renderFileBubble(m, true); else addMsg(m.text, m.mine, m.sys, {noStore:true, chatId: cid}); } }
  function addMsg(txt,mine=false,sys=false,opts={}){
    const chatId = opts.chatId || activePeerId || null;
    const d=document.createElement("div");
    d.className="bubble "+(sys?"sys":mine?"me":"them");
		const t = sys ? txt : `[${fmtTime()}] ${txt}`;
		d.textContent = t;
    if(!sys && mine){ const rc=document.createElement('div'); rc.className='receipt'; rc.innerHTML=`<span class='tick'>✓</span>`; d.appendChild(rc); }
    if(chatId===activePeerId || opts.noStore){ $('log').appendChild(d); $('log').scrollTop=$('log').scrollHeight; }
    if(!opts.noStore && chatId){ pushStore(chatId,{ kind:'text', mine, sys, text: txt, time: Date.now() }); }
    if(!mine && chatId && activePeerId!==chatId){ const chat = conversations.get(chatId) || { name: chatId, unread: 0 }; chat.unread=(chat.unread||0)+1; conversations.set(chatId, chat); renderChats(); }
  }
  function clearChat(){ $('log').innerHTML=''; $('msg').value=''; }
  function enableChat(enabled){ $('msg').disabled=!enabled; $('send').disabled=!enabled; ['btnAttach','btnEmoji','btnMic'].forEach(id=>{ const el=$(id); if(el) el.disabled=!enabled; }); }

  function ensureDmConversation(peerId){ if(!conversations.has(peerId)) conversations.set(peerId,{ name: peerId, unread: 0 }); renderChats(); }

  // Crypto
  const genKey=()=>crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const expJwk=k=>crypto.subtle.exportKey('jwk',k);
  const impJwk=jwk=>crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const randomSalt=()=>{let u=new Uint8Array(16);crypto.getRandomValues(u);return u.buffer;}
  const derive=async(priv,pub,s)=>{let bits=await crypto.subtle.deriveBits({name:'ECDH',public:pub},priv,256);let base=await crypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:s,info:enc.encode("e-chat")},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  const iv=()=>crypto.getRandomValues(new Uint8Array(12));
	const encrypt=async (key,m)=>{let i=iv();let c=await crypto.subtle.encrypt({name:'AES-GCM',iv:i},key,enc.encode(m));return{iv:b64.enc(i),ct:b64.enc(c)}}
  const decrypt=async (key,o)=>dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64.dec(o.iv)},key,b64.dec(o.ct)));
  const encBuf=async (key,buf)=>{ const i=iv(); const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:i},key,buf); return {iv:b64.enc(i), ct:b64.enc(ct)} };
  const decBuf=async (key,pkt)=>crypto.subtle.decrypt({name:'AES-GCM',iv:b64.dec(pkt.iv)},key,b64.dec(pkt.ct));

  function flushPending(peerId){ const queue=pendingSends.get(peerId)||[]; while(queue.length){ try{ queue.shift()(); }catch{} } pendingSends.set(peerId,[]); }

  function wireDC(peerId,c){
    const state = peers.get(peerId);
    state.dc=c;
		c.onopen=()=>{ setStatus("✅ Connected","ok"); enableChat(true); addMsg("Connected to "+peerId,false,true,{chatId: peerId}); flushPending(peerId); };
    c.onmessage=async e=>{
      let m=JSON.parse(e.data);
			if(m.type==="cipher"){
				const chatId = m.chatId || peerId;
				const text = "["+peerId+"] "+await decrypt(state.sharedKey,m);
				addMsg(text,false,false,{chatId});
				try{ state.dc.send(JSON.stringify({type:'delivered', chatId})); }catch{}
				if(activePeerId===chatId && document.hasFocus()){
					try{ state.dc.send(JSON.stringify({type:'read', chatId})); }catch{}
				}
			} else if(m.type==='file'){
				// Old format: single chunk file (backward compatibility)
				const chatId=m.chatId||peerId; 
				const buf=await decBuf(state.sharedKey,m.payload);
				renderIncomingFile(chatId, m.meta, buf, false);
				try{ state.dc.send(JSON.stringify({type:'delivered', chatId})); }catch{}
				if(activePeerId===chatId && document.hasFocus()){
					try{ state.dc.send(JSON.stringify({type:'read', chatId})); }catch{}
				}
			} else if(m.type==='file_start'){
				// New format: start of chunked file transfer
				const fileId = m.meta.fileId;
				if (!fileId) {
					console.error('file_start missing fileId');
					return;
				}
				
				// Initialize file transfer tracking
				const fileData = {
					meta: m.meta,
					chunks: new Map(),
					receivedCount: 0,
					chatId: m.chatId || peerId,
					startTime: Date.now()
				};
				incomingFileChunks.set(fileId, fileData);
				
				// Check if we have any orphaned chunks for this fileId and process them
				const orphaned = orphanedChunks.get(fileId);
				if (orphaned && orphaned.length > 0) {
					console.log(`Processing ${orphaned.length} orphaned chunks for fileId: ${fileId}`);
					// Process orphaned chunks asynchronously
					(async () => {
						for (const orphanChunk of orphaned) {
							try {
								const chunkBuf = await decBuf(state.sharedKey, orphanChunk.payload);
								const updatedFileData = incomingFileChunks.get(fileId);
								if (updatedFileData && !updatedFileData.chunks.has(orphanChunk.chunkIndex)) {
									updatedFileData.chunks.set(orphanChunk.chunkIndex, chunkBuf);
									updatedFileData.receivedCount++;
									
									// Check if we now have all chunks
									if (updatedFileData.receivedCount >= updatedFileData.meta.totalChunks) {
										// Reassemble and render (reuse the logic from file_chunk handler)
										const chunks = [];
										for (let i = 0; i < updatedFileData.meta.totalChunks; i++) {
											const chunk = updatedFileData.chunks.get(i);
											if (!chunk) {
												setStatus(`File transfer incomplete - missing chunk ${i + 1}/${updatedFileData.meta.totalChunks}`, 'err');
												return;
											}
											chunks.push(chunk);
										}
										const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
										const combined = new Uint8Array(totalSize);
										let offset = 0;
										for (const chunk of chunks) {
											const chunkArray = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
											combined.set(chunkArray, offset);
											offset += chunkArray.byteLength;
										}
										renderIncomingFile(updatedFileData.chatId, updatedFileData.meta, combined.buffer, false);
										incomingFileChunks.delete(fileId);
										setStatus(`File received: ${updatedFileData.meta.name} (${(updatedFileData.meta.size / (1024 * 1024)).toFixed(2)}MB)`, 'ok');
										try{ state.dc.send(JSON.stringify({type:'delivered', chatId: updatedFileData.chatId})); }catch{}
										if(activePeerId===updatedFileData.chatId && document.hasFocus()){
											try{ state.dc.send(JSON.stringify({type:'read', chatId: updatedFileData.chatId})); }catch{}
										}
										return;
									}
								}
							} catch (e) {
								console.error(`Failed to decrypt orphaned chunk ${orphanChunk.chunkIndex}:`, e);
							}
						}
						orphanedChunks.delete(fileId);
					})();
				}
				
				setStatus(`Receiving file: ${m.meta.name} (${(m.meta.size / (1024 * 1024)).toFixed(2)}MB, ${m.meta.totalChunks} chunks)...`, 'warn');
				
				// Set timeout to cleanup stuck transfers (5 minutes)
				setTimeout(() => {
					const stuckFile = incomingFileChunks.get(fileId);
					if (stuckFile && stuckFile.receivedCount < stuckFile.meta.totalChunks) {
						console.warn(`File transfer timeout for ${fileId}: ${stuckFile.receivedCount}/${stuckFile.meta.totalChunks} chunks`);
						setStatus(`File transfer timeout: ${stuckFile.meta.name} (only ${stuckFile.receivedCount}/${stuckFile.meta.totalChunks} chunks received)`, 'err');
						incomingFileChunks.delete(fileId);
						orphanedChunks.delete(fileId);
					}
				}, 5 * 60 * 1000); // 5 minutes
			} else if(m.type==='file_chunk'){
				// New format: file chunk
				const fileId = m.fileId;
				if (!fileId) {
					console.error('file_chunk missing fileId');
					return;
				}
				
				let fileData = incomingFileChunks.get(fileId);
				
				// If we haven't received file_start yet, buffer this chunk
				if (!fileData) {
					console.log(`Received chunk ${m.chunkIndex} before file_start for fileId: ${fileId}, buffering...`);
					if (!orphanedChunks.has(fileId)) {
						orphanedChunks.set(fileId, []);
					}
					orphanedChunks.get(fileId).push({
						chunkIndex: m.chunkIndex,
						payload: m.payload
					});
					
					// Wait a bit for file_start to arrive (max 2 seconds)
					setTimeout(() => {
						fileData = incomingFileChunks.get(fileId);
						if (!fileData) {
							console.error(`file_start never arrived for fileId: ${fileId} after buffering chunk ${m.chunkIndex}`);
							orphanedChunks.delete(fileId);
							setStatus('File transfer failed: metadata not received', 'err');
						}
					}, 2000);
					return;
				}
				
				try {
					// Decrypt the chunk
					const chunkBuf = await decBuf(state.sharedKey, m.payload);
					
					// Store the chunk (overwrite if duplicate)
					if (!fileData.chunks.has(m.chunkIndex)) {
						fileData.chunks.set(m.chunkIndex, chunkBuf);
						fileData.receivedCount++;
					} else {
						console.warn(`Duplicate chunk ${m.chunkIndex} received for fileId: ${fileId}`);
					}
					
					// Check if all chunks received
					if (fileData.receivedCount >= fileData.meta.totalChunks) {
						// Reassemble file
						const chunks = [];
						let allPresent = true;
						for (let i = 0; i < fileData.meta.totalChunks; i++) {
							const chunk = fileData.chunks.get(i);
							if (!chunk) {
								console.error(`Missing chunk ${i} for fileId: ${fileId}`);
								setStatus(`File transfer incomplete - missing chunk ${i + 1}/${fileData.meta.totalChunks}`, 'err');
								allPresent = false;
								// Don't delete yet, wait for missing chunks
								return;
							}
							chunks.push(chunk);
						}
						
						if (!allPresent) return;
						
						// Combine all chunks into single ArrayBuffer
						const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
						
						// Verify total size matches expected
						if (totalSize !== fileData.meta.size) {
							console.warn(`File size mismatch: expected ${fileData.meta.size}, got ${totalSize}`);
						}
						
						const combined = new Uint8Array(totalSize);
						let offset = 0;
						for (const chunk of chunks) {
							const chunkArray = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
							combined.set(chunkArray, offset);
							offset += chunkArray.byteLength;
						}
						
						// Render the file
						renderIncomingFile(fileData.chatId, fileData.meta, combined.buffer, false);
						
						// Cleanup
						incomingFileChunks.delete(fileId);
						setStatus(`File received: ${fileData.meta.name} (${(fileData.meta.size / (1024 * 1024)).toFixed(2)}MB)`, 'ok');
						
						try{ state.dc.send(JSON.stringify({type:'delivered', chatId: fileData.chatId})); }catch{}
						if(activePeerId===fileData.chatId && document.hasFocus()){
							try{ state.dc.send(JSON.stringify({type:'read', chatId: fileData.chatId})); }catch{}
						}
					} else {
						// Update progress
						const progress = ((fileData.receivedCount / fileData.meta.totalChunks) * 100).toFixed(0);
						setStatus(`Receiving file: ${fileData.meta.name} (${progress}% - ${fileData.receivedCount}/${fileData.meta.totalChunks} chunks)`, 'warn');
					}
				} catch (e) {
					console.error(`Failed to decrypt chunk ${m.chunkIndex}:`, e);
					setStatus(`Failed to decrypt file chunk ${m.chunkIndex + 1}: ${e.message}`, 'err');
					// Don't delete immediately - might be a temporary decryption error
				}
			} else if(m.type==='file_end'){
				// File transfer complete signal
				const fileId = m.fileId;
				const fileData = incomingFileChunks.get(fileId);
				if (fileData) {
					// Check if we have all chunks
					if (fileData.receivedCount < fileData.meta.totalChunks) {
						setStatus(`File transfer ended - received ${fileData.receivedCount}/${fileData.meta.totalChunks} chunks. Waiting for remaining chunks...`, 'warn');
						// Wait a bit more for any delayed chunks
						setTimeout(() => {
							const delayedFileData = incomingFileChunks.get(fileId);
							if (delayedFileData && delayedFileData.receivedCount < delayedFileData.meta.totalChunks) {
								setStatus(`File transfer incomplete - only ${delayedFileData.receivedCount}/${delayedFileData.meta.totalChunks} chunks received`, 'err');
								incomingFileChunks.delete(fileId);
							}
						}, 2000);
					}
				} else {
					console.warn(`file_end received for unknown fileId: ${fileId}`);
				}
			}
			if(m.type==='delivered'){
				const ticks=[...document.querySelectorAll('.bubble.me .receipt .tick')];
				if(ticks.length){ const el=ticks[ticks.length-1]; el.textContent='✓✓'; el.style.color='#9aa7b0'; }
			}
			if(m.type==='read'){
				const ticks=[...document.querySelectorAll('.bubble.me .receipt .tick')];
				if(ticks.length){ const el=ticks[ticks.length-1]; el.textContent='✓✓'; el.style.color='#34b7f1'; }
			}
    };
    c.onclose=()=>cleanupPeer(peerId);
  }

  function renderFileBubble(entry, restore=false){
    const cid=activePeerId; if(entry.chatId!==cid && !restore) return;
    const d=document.createElement('div'); d.className='bubble '+(entry.mine?'me':'them');
    const url=URL.createObjectURL(new Blob([entry.blob],{type:entry.meta.type}));

    if(entry.meta.type && entry.meta.type.startsWith('image/')){
      const img=new Image(); img.src=url; img.style.maxWidth='260px'; img.style.borderRadius='12px'; d.appendChild(img);
    } else if(entry.meta.type && entry.meta.type.startsWith('audio/') || entry.meta.isVoiceNote){
      // Voice note or audio file
      d.classList.add('voice-note-bubble');
      const audio=document.createElement('audio'); 
      audio.controls=true; 
      audio.src=url;
      audio.style.width='100%';
      audio.style.maxWidth='300px';
      
      // Add voice note styling
      const voiceContainer = document.createElement('div');
      voiceContainer.style.display='flex';
      voiceContainer.style.alignItems='center';
      voiceContainer.style.gap='12px';
      voiceContainer.style.padding='8px';
      
      const voiceIcon = document.createElement('div');
      voiceIcon.innerHTML = '🎤';
      voiceIcon.style.fontSize='24px';
      
      const voiceInfo = document.createElement('div');
      voiceInfo.style.flex='1';
      
      const voiceLabel = document.createElement('div');
      voiceLabel.textContent = entry.meta.isVoiceNote ? 'Voice Note' : 'Audio';
      voiceLabel.style.fontWeight='600';
      voiceLabel.style.fontSize='14px';
      voiceLabel.style.marginBottom='4px';
      voiceLabel.style.color='var(--text)';
      
      if (entry.meta.duration) {
        const duration = document.createElement('div');
        duration.textContent = formatTime(entry.meta.duration);
        duration.style.fontSize='12px';
        duration.style.color='var(--muted)';
        voiceInfo.appendChild(voiceLabel);
        voiceInfo.appendChild(duration);
      } else {
        voiceInfo.appendChild(voiceLabel);
      }
      
      voiceContainer.appendChild(voiceIcon);
      voiceContainer.appendChild(voiceInfo);
      voiceContainer.appendChild(audio);
      
      d.appendChild(voiceContainer);
    } else {
      d.classList.add('file-bubble');
      let icon = '📄'; // Generic file icon
      if (entry.meta.type === 'application/pdf') {
        icon = '📕'; // PDF icon
      } else if (entry.meta.type && entry.meta.type.startsWith('video/')) {
        icon = '🎥'; // Video icon
      }
      const sizeMB = entry.meta.size / (1024 * 1024);
      const sizeText = sizeMB >= 1 
        ? `${sizeMB.toFixed(2)} MB` 
        : `${(entry.meta.size / 1024).toFixed(2)} KB`;
      d.innerHTML = `
        <a href="${url}" download="${entry.meta.name || 'file'}" class="file-link">
          <div class="file-icon">${icon}</div>
          <div class="file-info">
            <div class="file-name">${entry.meta.name || 'download'}</div>
            <div class="file-size">${sizeText}</div>
          </div>
        </a>
      `;
    }
    $('log').appendChild(d); $('log').scrollTop=$('log').scrollHeight;
  }

  function renderIncomingFile(chatId, meta, buf, mine){ 
    const blob = new Blob([buf], { type: meta.type||'application/octet-stream' }); 
    // Detect if it's a voice note by name or type
    const isVoiceNote = meta.name && (
      meta.name.toLowerCase().includes('voice') || 
      meta.name.toLowerCase().includes('voice_note') ||
      (meta.type && meta.type.startsWith('audio/') && meta.size < 5 * 1024 * 1024) // Audio files < 5MB are likely voice notes
    );
    
    const entry = { 
      kind:'file', 
      mine: !!mine, 
      chatId, 
      meta: {
        ...meta,
        isVoiceNote: isVoiceNote
      }, 
      blob, 
      time: Date.now() 
    }; 
    pushStore(chatId, entry); 
    if(activePeerId===chatId){ 
      renderFileBubble(entry); 
    } else { 
      const chat = conversations.get(chatId) || { name: chatId, unread: 0 }; 
      chat.unread = (chat.unread||0)+1; 
      conversations.set(chatId, chat); 
      renderChats(); 
    } 
  }

  // Chunk size for WebRTC DataChannel 
  // After encryption (~same size) and base64 encoding (+33%), plus JSON overhead, we need smaller chunks
  // DataChannel max message size varies by browser but is typically 16KB-64KB
  // Using 32KB raw = ~43KB base64 + JSON overhead = ~45-50KB total (safe for most browsers)
  const CHUNK_SIZE = 32 * 1024; // 32KB raw chunks (will be ~45KB after encoding)
  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max file size

  async function sendFileToPeer(peerId, file, chatId) {
    await ensureConnection(peerId);
    const st = peers.get(peerId);
    if (!st || !st.sharedKey) {
      setStatus('Connection not established for file transfer', 'err');
      return;
    }
    
    if (!st.dc || st.dc.readyState !== 'open') {
      setStatus('DataChannel not ready for file transfer', 'err');
      return;
    }
    
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      setStatus(`File too large. Maximum size is ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB`, 'err');
      addMsg(`File "${file.name}" is too large (max ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB)`, true, true, {chatId});
      return;
    }
    
    const buf = await file.arrayBuffer();
    const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const totalChunks = Math.ceil(buf.byteLength / CHUNK_SIZE);
    const meta = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', fileId, totalChunks };
    
    // If file is small enough, send in one chunk (backward compatibility)
    if (buf.byteLength <= CHUNK_SIZE) {
      try {
        const payload = await encBuf(st.sharedKey, buf);
        const fileMsg = JSON.stringify({type: 'file', chatId, meta, payload, chunkIndex: 0, totalChunks: 1});
        st.dc.send(fileMsg);
        setStatus(`File sent: ${file.name}`, 'ok');
      } catch (e) {
        console.error('Failed to send file:', e);
        setStatus('Failed to send file: ' + e.message, 'err');
      }
      return;
    }
    
    // For larger files, send in chunks
    setStatus(`Sending file: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB, ${meta.totalChunks} chunks)...`, 'warn');
    
    // Send file metadata first
    try {
      const startMsg = JSON.stringify({type: 'file_start', chatId, meta});
      if (st.dc.readyState !== 'open') {
        setStatus('DataChannel not ready for file transfer', 'err');
        return;
      }
      st.dc.send(startMsg);
    } catch (e) {
      console.error('Failed to send file_start:', e);
      setStatus('Failed to start file transfer: ' + e.message, 'err');
      return;
    }
    
    // Wait a bit for the start message to be processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Send chunks sequentially with error handling
    let sentChunks = 0;
    for (let offset = 0; offset < buf.byteLength; offset += CHUNK_SIZE) {
      const chunk = buf.slice(offset, offset + CHUNK_SIZE);
      const chunkIndex = Math.floor(offset / CHUNK_SIZE);
      
      try {
        // Check DataChannel is still open
        if (st.dc.readyState !== 'open') {
          setStatus(`DataChannel closed during file transfer (sent ${sentChunks}/${meta.totalChunks} chunks)`, 'err');
          return;
        }
        
        const encryptedChunk = await encBuf(st.sharedKey, chunk);
        const chunkMsg = JSON.stringify({
          type: 'file_chunk',
          chatId,
          fileId,
          chunkIndex,
          totalChunks: meta.totalChunks,
          payload: encryptedChunk
        });
        
        // Check if message is too large (shouldn't happen with our chunk size, but safety check)
        if (chunkMsg.length > 262144) { // 256KB max
          console.error(`Chunk ${chunkIndex} too large: ${chunkMsg.length} bytes`);
          setStatus(`Chunk ${chunkIndex + 1} too large to send`, 'err');
          return;
        }
        
        st.dc.send(chunkMsg);
        sentChunks++;
        
        // Update progress
        if (sentChunks % 10 === 0 || sentChunks === meta.totalChunks) {
          const progress = ((sentChunks / meta.totalChunks) * 100).toFixed(0);
          setStatus(`Sending file: ${file.name} (${progress}%)...`, 'warn');
        }
        
        // Small delay between chunks to avoid overwhelming the channel
        await new Promise(resolve => setTimeout(resolve, 20));
      } catch (e) {
        console.error(`Failed to send chunk ${chunkIndex}:`, e);
        setStatus(`Failed to send chunk ${chunkIndex + 1}/${meta.totalChunks}: ${e.message}`, 'err');
        return;
      }
    }
    
    // Wait a bit before sending end signal
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send completion signal
    try {
      if (st.dc.readyState === 'open') {
        st.dc.send(JSON.stringify({type: 'file_end', chatId, fileId}));
        setStatus(`File sent successfully (${sentChunks} chunks)`, 'ok');
      } else {
        setStatus(`File transfer interrupted (sent ${sentChunks}/${meta.totalChunks} chunks)`, 'warn');
      }
    } catch (e) {
      console.error('Failed to send file_end:', e);
      setStatus(`File sent but completion signal failed (${sentChunks} chunks)`, 'warn');
    }
  }

  function cleanupPeer(peerId){ const st = peers.get(peerId); if(!st) return; try{ if(st.dc) st.dc.close(); }catch{} try{ if(st.pc) st.pc.close(); }catch{} peers.delete(peerId); if(peers.size===0){ enableChat(false); setStatus("Session ended. History cleared.","warn"); } if($('activeTitle').textContent===peerId){ $('activeTitle').textContent='No chat'; $('activeSubtitle').textContent='—'; $('activeAvatar').textContent='--'; activePeerId=null; } }

	function cleanupAll(){ const ids = Array.from(peers.keys()); ids.forEach(id=>cleanupPeer(id)); enableChat(false); clearChat(); }

  // WebSocket signaling
	function connectWS(){ if(ws && ws.readyState===WebSocket.OPEN) return; const host = location.hostname || 'localhost'; const scheme = location.protocol==='https:' ? 'wss://' : 'ws://'; const port = host === 'localhost' ? ':8080' : ''; ws=new WebSocket(scheme+host+port); ws.onopen=()=>setStatus('Connected to signaling','ok'); ws.onclose=()=>{ setStatus('Signaling disconnected','err'); }; ws.onmessage=async ev=>{ const msg=JSON.parse(ev.data); if(msg.type==='error'){ addMsg('Error: '+msg.message,false,true); return; } if(msg.type==='logged_in'){ myId=msg.userId; myName=msg.name; $('meId').textContent=myId; $('auth').style.display='none'; $('presence').style.display='block'; return; } if(msg.type==='logged_out'){ myId=null; $('auth').style.display='block'; $('presence').style.display='none'; cleanupAll(); setStatus('Logged out','warn'); return; } if(msg.type==='presence'){ renderOnline(msg.online); return; } if(msg.type==='signal'){ await onSignal(msg.from, msg.payload); return; } }; }

  function renderOnline(list){
		const ul=$('online');
		ul.innerHTML='';
    $('onlineCount').textContent=String(list.length);
    list.filter(id=>id!==myId).forEach(id=>{
      const li=document.createElement('li');
      li.className='user';
			li.innerHTML=`
				<div class="avatar">
					${id.slice(0,2)}
					<div class="status-dot"></div>
				</div>
				<div style="font-weight:600;">${id}</div>
			`;
			li.onclick=()=>{
				setActivePeer(id);
				startCall(id);
				// Add active class for visual feedback
				document.querySelectorAll('#online .user').forEach(el => el.classList.remove('active'));
				li.classList.add('active');
			};
      ul.appendChild(li);
    });
  }

	function renderChats(){
		const ul=$('chats');
		if(!ul) return;
		ul.innerHTML='';
		for(const [cid, chat] of conversations){
			const li=document.createElement('li');
			li.className='chatItem';
			if (cid === activePeerId) {
				li.classList.add('active');
			}
			const lastMessage = (chatMessages.get(cid) || []).slice(-1)[0];
			li.innerHTML=`
				<div class="avatar">
					${chat.name.slice(0,2)}
					<div class="status-dot"></div>
				</div>
				<div class="chat-info">
					<div class="chat-name">${chat.name}</div>
					<div class="chat-preview">${lastMessage ? (lastMessage.kind === 'file' ? (lastMessage.meta && lastMessage.meta.isVoiceNote ? '<em>🎤 Voice note</em>' : '<em>📎 File</em>') : lastMessage.text.substring(0, 25) + '...') : 'No messages yet'}</div>
				</div>
				<div class="chat-meta">
					<div class="chat-time">${lastMessage ? new Date(lastMessage.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</div>
					${chat.unread ? `<div class='unread'>${chat.unread}</div>` : ''}
				</div>
			`;
			li.onclick=()=>{
				setActivePeer(cid);
				if(conversations.has(cid)){
					conversations.get(cid).unread=0;
				}
				renderChats(); // Re-render to update active state and unread count
				renderChatLog();
				// Mark messages as read
				const peerId = cid.startsWith('grp:') ? (conversations.get(cid).members || []).find(m => m !== myId) : cid;
				if (peerId) {
					const st = peers.get(peerId);
					if(st && st.dc){
						try{ st.dc.send(JSON.stringify({type:'read', chatId: cid})); }catch{}
					}
				}
			};
			ul.appendChild(li);
		}
	}

	// Signaling helpers
  function sendSignal(to,payload){ ws.send(JSON.stringify({type:'signal', to, payload})); }

	function setActivePeer(id){ $('activeTitle').textContent=id||'No chat'; $('activeSubtitle').textContent=id? 'Online' : '—'; $('activeAvatar').textContent=(id&&id.slice(0,2))||'--'; activePeerId = id || null; renderChatLog(); }

	async function ensureConnection(peerId){ if(peers.has(peerId)){ const st=peers.get(peerId); if(st.dc && st.dc.readyState==='open' && st.sharedKey) return; } startCall(peerId); await new Promise(res=>{ const check=()=>{ const st=peers.get(peerId); if(st && st.dc && st.dc.readyState==='open' && st.sharedKey){ res(); } else { setTimeout(check,100); } }; check(); }); }

	async function startCall(targetId){ if(!myId) return; if(peers.has(targetId)) return; const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); const state={ pc, dc:null, keyPair:await genKey(), sharedKey:null, salt:randomSalt() }; peers.set(targetId,state); wireDC(targetId, pc.createDataChannel('chat', { ordered: true, maxRetransmits: 0 })); const pub=await expJwk(state.keyPair.publicKey); pc.onicecandidate=e=>{ if(e.candidate) sendSignal(targetId,{kind:'ice',candidate:e.candidate}); }; const offer=await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal(targetId,{kind:'offer', sdp:pc.localDescription, crypto:{pub,salt:b64.enc(state.salt)}}); setActivePeer(targetId); setStatus('Offer sent…','warn'); ensureDmConversation(targetId); }

	async function onSignal(from, payload){ if(payload.kind==='offer'){ const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); const state={ pc, dc:null, keyPair:await genKey(), sharedKey:null, salt:b64.dec(payload.crypto.salt) }; peers.set(from,state); pc.ondatachannel=e=>wireDC(from,e.channel); state.sharedKey=await derive(state.keyPair.privateKey, await impJwk(payload.crypto.pub), state.salt); pc.onicecandidate=e=>{ if(e.candidate) sendSignal(from,{kind:'ice',candidate:e.candidate}); }; await pc.setRemoteDescription(payload.sdp); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); const pub=await expJwk(state.keyPair.publicKey); sendSignal(from,{kind:'answer', sdp:pc.localDescription, crypto:{pub,salt:payload.crypto.salt}}); setActivePeer(from); setStatus('Answer sent…','warn'); ensureDmConversation(from); } else if(payload.kind==='answer'){ const st = peers.get(from); if(!st) return; st.sharedKey=await derive(st.keyPair.privateKey, await impJwk(payload.crypto.pub), b64.dec(payload.crypto.salt)); await st.pc.setRemoteDescription(payload.sdp); setActivePeer(from); } else if(payload.kind==='ice'){ const st = peers.get(from); if(!st) return; try{ await st.pc.addIceCandidate(payload.candidate); }catch{} } else if(payload.kind==='group_invite'){ const { id, name, members } = payload.group||{}; if(!id || !name) return; if(members && !members.includes(myId)) return; conversations.set(id,{ name, unread:0, members:members||[] }); renderChats(); } }

	async function send(){ let txt=$('msg').value.trim(); if(!txt) return; const cid = activePeerId; if(!cid){ return; } if(cid.startsWith('grp:')){ const chat = conversations.get(cid); if(chat && Array.isArray(chat.members)){ for(const pid of chat.members){ if(pid===myId) continue; await ensureConnection(pid); const st=peers.get(pid); if(st && st.dc && st.sharedKey){ let pkt=await encrypt(st.sharedKey, txt); pkt.type="cipher"; pkt.chatId=cid; try{ st.dc.send(JSON.stringify(pkt)); }catch{} } } } } else { await ensureConnection(cid); const st=peers.get(cid); if(st && st.dc && st.dc.readyState==='open' && st.sharedKey){ let pkt=await encrypt(st.sharedKey, txt); pkt.type="cipher"; st.dc.send(JSON.stringify(pkt)); } } addMsg(txt,true,false,{chatId: cid}); $('msg').value=""; }
  $('send').onclick=send;
  $('msg').onkeydown=e=>{ if(e.key==="Enter"){e.preventDefault();send();} };

	// Attachment handlers
	const btnAttach=$('btnAttach'), fileInput=$('fileInput'); 
	if(btnAttach&&fileInput){ 
		btnAttach.onclick=()=>fileInput.click(); 
		fileInput.onchange=async()=>{ 
			const cid=activePeerId; 
			if(!cid) {
				setStatus('Please select a chat first', 'err');
				return;
			}
			const files=[...fileInput.files]; 
			for(const f of files){
				// Check file size before processing
				if(f.size > MAX_FILE_SIZE){
					setStatus(`File "${f.name}" is too large (max ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB)`, 'err');
					addMsg(`File "${f.name}" is too large (max ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB)`, true, true, {chatId: cid});
					continue;
				}
				
				// Store file entry for display
				const fileBuf = await f.arrayBuffer();
				const entry={ 
					kind:'file', 
					mine:true, 
					chatId: cid, 
					meta:{ name:f.name, type:f.type, size:f.size }, 
					blob:new Blob([fileBuf],{type:f.type}) 
				}; 
				pushStore(cid, entry); 
				renderFileBubble(entry);
				
				// Send file to peer(s)
				if(cid.startsWith('grp:')){ 
					const chat=conversations.get(cid); 
					if(chat && chat.members){ 
						for(const pid of chat.members){ 
							if(pid===myId) continue; 
							await sendFileToPeer(pid, f, cid); 
						} 
					} 
				} else { 
					await sendFileToPeer(cid, f, cid); 
				}
			} 
			fileInput.value=''; 
		} 
	}

	// Emoji quick insert
	const btnEmoji=$('btnEmoji'); if(btnEmoji){ btnEmoji.onclick=()=>{ const m=$('msg'); m.value += ' 🙂'; m.focus(); } }

	// Voice recording
	let mediaRecorder=null, chunks=[], recordingStream=null, recordingTimer=null, recordingStartTime=null;
	const btnMic=$('btnMic');
	const voiceIndicator=$('voiceRecordingIndicator');
	const recordingTime=$('recordingTime');
	
	function formatTime(seconds) {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}
	
	function updateRecordingTime() {
		if (recordingStartTime && mediaRecorder && mediaRecorder.state === 'recording') {
			const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
			recordingTime.textContent = formatTime(elapsed);
		}
	}
	
	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state === 'recording') {
			mediaRecorder.stop();
		}
		if (recordingStream) {
			recordingStream.getTracks().forEach(track => track.stop());
			recordingStream = null;
		}
		if (recordingTimer) {
			clearInterval(recordingTimer);
			recordingTimer = null;
		}
		if (voiceIndicator) {
			voiceIndicator.style.display = 'none';
		}
		if (btnMic) {
			btnMic.classList.remove('recording');
		}
		recordingStartTime = null;
	}
	
	if(btnMic) {
		btnMic.onclick = async () => {
			const cid = activePeerId;
			if (!cid) {
				setStatus('Please select a chat first', 'err');
				return;
			}
			
			// Stop recording if already recording
			if (mediaRecorder && mediaRecorder.state === 'recording') {
				stopRecording();
				return;
			}
			
			// Start recording
			try {
				const stream = await navigator.mediaDevices.getUserMedia({audio: true});
				recordingStream = stream;
				
				// Check for supported MIME types
				const options = { mimeType: 'audio/webm' };
				if (!MediaRecorder.isTypeSupported('audio/webm')) {
					options.mimeType = 'audio/mp4';
					if (!MediaRecorder.isTypeSupported('audio/mp4')) {
						options.mimeType = ''; // Use browser default
					}
				}
				
				mediaRecorder = new MediaRecorder(stream, options);
				chunks = [];
				
				mediaRecorder.ondataavailable = e => {
					if (e.data && e.data.size > 0) {
						chunks.push(e.data);
					}
				};
				
				mediaRecorder.onstop = async () => {
					stopRecording();
					
					if (chunks.length === 0) {
						setStatus('Recording was empty', 'warn');
						return;
					}
					
					const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
					
					// Check minimum duration (0.5 seconds)
					if (blob.size < 1000) {
						setStatus('Recording too short', 'warn');
						return;
					}
					
					const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
					const fileName = `voice_note_${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
					const file = new File([blob], fileName, { type: blob.type });
					
					setStatus('Sending voice note...', 'warn');
					
					// Send voice note
					if (cid.startsWith('grp:')) {
						const chat = conversations.get(cid);
						if (chat && chat.members) {
							for (const pid of chat.members) {
								if (pid === myId) continue;
								await sendFileToPeer(pid, file, cid);
							}
						}
					} else {
						await sendFileToPeer(cid, file, cid);
					}
					
					// Store and render voice note
					const entry = {
						kind: 'file',
						mine: true,
						chatId: cid,
						meta: {
							name: `Voice Note (${formatTime(duration)})`,
							type: blob.type,
							size: blob.size,
							isVoiceNote: true,
							duration: duration
						},
						blob: blob
					};
					pushStore(cid, entry);
					renderFileBubble(entry);
					
					setStatus('Voice note sent', 'ok');
				};
				
				mediaRecorder.onerror = (e) => {
					console.error('MediaRecorder error:', e);
					setStatus('Recording error occurred', 'err');
					stopRecording();
				};
				
				// Start recording
				recordingStartTime = Date.now();
				mediaRecorder.start(100); // Collect data every 100ms
				
				// Show UI feedback
				if (voiceIndicator) {
					voiceIndicator.style.display = 'flex';
				}
				if (btnMic) {
					btnMic.classList.add('recording');
				}
				
				// Update timer
				recordingTimer = setInterval(updateRecordingTime, 100);
				updateRecordingTime();
				
				setStatus('Recording voice note... Click mic to stop', 'warn');
				
			} catch (err) {
				console.error('Microphone access error:', err);
				if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
					setStatus('Microphone access denied. Please allow microphone access in browser settings.', 'err');
				} else if (err.name === 'NotFoundError') {
					setStatus('No microphone found', 'err');
				} else {
					setStatus('Failed to access microphone: ' + err.message, 'err');
				}
				stopRecording();
			}
		};
		
		// Cleanup on page unload
		window.addEventListener('beforeunload', () => {
			stopRecording();
		});
	}

	// WebSocket auth
	$('btnLogin').onclick=()=>{ const id=$('logUser').value.trim(); if(!/^[A-Z0-9]{8}$/.test(id)){ setStatus('Enter valid 8-char ID','err'); return; } connectWS(); const sendLogin = () => { try { ws.send(JSON.stringify({type:'login', userId:id})); setStatus('Logging in…','warn'); } catch(e){} }; if(ws && ws.readyState===WebSocket.OPEN){ sendLogin(); } else { ws.addEventListener('open', function once(){ ws.removeEventListener('open', once); sendLogin(); }); } };
  $('btnLogout').onclick=()=>{ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'logout'})); };

  // Start via search box (single or group)
	$('btnStart').onclick=()=>{ const val=$('searchBox').value.trim(); if(!val) return; val.split(',').map(s=>s.trim()).filter(Boolean).forEach(id=>startCall(id)); };

	// Mobile menu button - toggle sidebar visibility
	const menuBtn = $('menuBtn');
	const sidebar = $('sidebar');
	if (menuBtn && sidebar) {
		menuBtn.onclick = () => {
			sidebar.classList.toggle('mobile-visible');
		};
		// Close sidebar when selecting a chat on mobile
		const sidebars = $('sidebar');
		if (sidebars) {
			sidebars.addEventListener('click', (e) => {
				// Check if clicked element is a chat item
				const chatItem = e.target.closest('li.user');
				if (chatItem && window.innerWidth <= 480) {
					// Close sidebar after selecting chat on mobile
					setTimeout(() => {
						sidebar.classList.remove('mobile-visible');
					}, 100);
				}
			});
		}
	}

	// Modal event listeners
	const chatHeader = $('chatHeader');
	const closeModal = $('closeModal');
	const copyKey = $('copyKey');
	const encryptionModal = $('encryptionModal');

	if (chatHeader) {
		chatHeader.onclick = () => {
			if (activePeerId) {
				showEncryptionModal(activePeerId);
			}
		};
	}

	if (closeModal) {
		closeModal.onclick = closeEncryptionModal;
	}

	if (copyKey) {
		copyKey.onclick = copyKeyToClipboard;
	}

	// Close modal when clicking outside
	if (encryptionModal) {
		encryptionModal.onclick = (e) => {
			if (e.target === encryptionModal) {
				closeEncryptionModal();
			}
		};
	}

	// Close modal with Escape key
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && encryptionModal.style.display === 'flex') {
			closeEncryptionModal();
		}
	});

	// --- New Group Modal Logic ---
const btnNewGroup = $('btnNewGroup');
const newGroupModal = $('newGroupModal');
const closeNewGroupModal = $('closeNewGroupModal');
const cancelNewGroup = $('cancelNewGroup');
const createNewGroup = $('createNewGroup');
const groupNameInput = $('groupNameInput');
const groupMembersInput = $('groupMembersInput');
const groupIconInput = $('groupIconInput');

if (btnNewGroup) {
  btnNewGroup.onclick = () => {
    groupNameInput.value = '';
    groupMembersInput.value = '';
    if (groupIconInput) groupIconInput.value = '';
    newGroupModal.style.display = 'flex';
  };
}
if (closeNewGroupModal) closeNewGroupModal.onclick = () => newGroupModal.style.display = 'none';
if (cancelNewGroup) cancelNewGroup.onclick = () => newGroupModal.style.display = 'none';

// Optional: close modal when clicking outside content
if (newGroupModal) {
  newGroupModal.onclick = (e) => {
    if (e.target === newGroupModal) newGroupModal.style.display = 'none';
  };
}

// Handle group creation
if (createNewGroup) {
  createNewGroup.onclick = () => {
    const name = groupNameInput.value.trim();
    const members = groupMembersInput.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!name || members.length < 2) {
      alert('Enter a group name and at least two member IDs.');
      return;
    }
    const gid = 'grp:' + name.replace(/\s+/g, '_') + '_' + Date.now();
    conversations.set(gid, { name, unread: 0, members: [myId, ...members] });
    renderChats();
    setActivePeer(gid);
    // Send group invite to members
    for (const m of members) {
      if (m === myId) continue;
      try {
        sendSignal(m, { kind: 'group_invite', group: { id: gid, name, members: [myId, ...members] } });
      } catch {}
    }
    newGroupModal.style.display = 'none';
    setStatus('Group "' + name + '" created', 'ok');
  };
}
})();


