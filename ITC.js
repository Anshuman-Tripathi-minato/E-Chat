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
				const chatId=m.chatId||peerId; const buf=await decBuf(state.sharedKey,m.payload);
				renderIncomingFile(chatId, m.meta, buf, false);
				try{ state.dc.send(JSON.stringify({type:'delivered', chatId})); }catch{}
				if(activePeerId===chatId && document.hasFocus()){
					try{ state.dc.send(JSON.stringify({type:'read', chatId})); }catch{}
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

    if(entry.meta.type.startsWith('image/')){
      const img=new Image(); img.src=url; img.style.maxWidth='260px'; img.style.borderRadius='12px'; d.appendChild(img);
    } else if(entry.meta.type.startsWith('audio/')){
      const audio=document.createElement('audio'); audio.controls=true; audio.src=url; d.appendChild(audio);
    } else {
      d.classList.add('file-bubble');
      let icon = '📄'; // Generic file icon
      if (entry.meta.type === 'application/pdf') {
        icon = '📕'; // PDF icon
      }
      d.innerHTML = `
        <a href="${url}" download="${entry.meta.name || 'file'}" class="file-link">
          <div class="file-icon">${icon}</div>
          <div class="file-info">
            <div class="file-name">${entry.meta.name || 'download'}</div>
            <div class="file-size">${(entry.meta.size / 1024).toFixed(2)} KB</div>
          </div>
        </a>
      `;
    }
    $('log').appendChild(d); $('log').scrollTop=$('log').scrollHeight;
  }

  function renderIncomingFile(chatId, meta, buf, mine){ const blob = new Blob([buf], { type: meta.type||'application/octet-stream' }); const entry = { kind:'file', mine: !!mine, chatId, meta, blob, time: Date.now() }; pushStore(chatId, entry); if(activePeerId===chatId){ renderFileBubble(entry); } else { const chat = conversations.get(chatId) || { name: chatId, unread: 0 }; chat.unread = (chat.unread||0)+1; conversations.set(chatId, chat); renderChats(); } }

  async function sendFileToPeer(peerId, file, chatId){ await ensureConnection(peerId); const st=peers.get(peerId); if(!st||!st.sharedKey||!st.dc) return; const buf=await file.arrayBuffer(); const payload=await encBuf(st.sharedKey, buf); const meta={ name:file.name, size:file.size, type:file.type }; st.dc.send(JSON.stringify({type:'file', chatId, meta, payload})); }

  function cleanupPeer(peerId){ const st = peers.get(peerId); if(!st) return; try{ if(st.dc) st.dc.close(); }catch{} try{ if(st.pc) st.pc.close(); }catch{} peers.delete(peerId); if(peers.size===0){ enableChat(false); setStatus("Session ended. History cleared.","warn"); } if($('activeTitle').textContent===peerId){ $('activeTitle').textContent='No chat'; $('activeSubtitle').textContent='—'; $('activeAvatar').textContent='--'; activePeerId=null; } }

	function cleanupAll(){ const ids = Array.from(peers.keys()); ids.forEach(id=>cleanupPeer(id)); enableChat(false); clearChat(); }

  // WebSocket signaling
	function connectWS(){ if(ws && ws.readyState===WebSocket.OPEN) return; const host = location.hostname || 'localhost'; const scheme = location.protocol==='https:' ? 'wss://' : 'ws://'; ws=new WebSocket(scheme+host+':8080'); ws.onopen=()=>setStatus('Connected to signaling','ok'); ws.onclose=()=>{ setStatus('Signaling disconnected','err'); }; ws.onmessage=async ev=>{ const msg=JSON.parse(ev.data); if(msg.type==='error'){ addMsg('Error: '+msg.message,false,true); return; } if(msg.type==='logged_in'){ myId=msg.userId; myName=msg.name; $('meId').textContent=myId; $('auth').style.display='none'; $('presence').style.display='block'; return; } if(msg.type==='logged_out'){ myId=null; $('auth').style.display='block'; $('presence').style.display='none'; cleanupAll(); setStatus('Logged out','warn'); return; } if(msg.type==='presence'){ renderOnline(msg.online); return; } if(msg.type==='signal'){ await onSignal(msg.from, msg.payload); return; } }; }

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
					<div class="chat-preview">${lastMessage ? (lastMessage.kind === 'file' ? '<em>File received</em>' : lastMessage.text.substring(0, 25) + '...') : 'No messages yet'}</div>
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

	async function startCall(targetId){ if(!myId) return; if(peers.has(targetId)) return; const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); const state={ pc, dc:null, keyPair:await genKey(), sharedKey:null, salt:randomSalt() }; peers.set(targetId,state); wireDC(targetId, pc.createDataChannel('chat')); const pub=await expJwk(state.keyPair.publicKey); pc.onicecandidate=e=>{ if(e.candidate) sendSignal(targetId,{kind:'ice',candidate:e.candidate}); }; const offer=await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal(targetId,{kind:'offer', sdp:pc.localDescription, crypto:{pub,salt:b64.enc(state.salt)}}); setActivePeer(targetId); setStatus('Offer sent…','warn'); ensureDmConversation(targetId); }

	async function onSignal(from, payload){ if(payload.kind==='offer'){ const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]}); const state={ pc, dc:null, keyPair:await genKey(), sharedKey:null, salt:b64.dec(payload.crypto.salt) }; peers.set(from,state); pc.ondatachannel=e=>wireDC(from,e.channel); state.sharedKey=await derive(state.keyPair.privateKey, await impJwk(payload.crypto.pub), state.salt); pc.onicecandidate=e=>{ if(e.candidate) sendSignal(from,{kind:'ice',candidate:e.candidate}); }; await pc.setRemoteDescription(payload.sdp); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); const pub=await expJwk(state.keyPair.publicKey); sendSignal(from,{kind:'answer', sdp:pc.localDescription, crypto:{pub,salt:payload.crypto.salt}}); setActivePeer(from); setStatus('Answer sent…','warn'); ensureDmConversation(from); } else if(payload.kind==='answer'){ const st = peers.get(from); if(!st) return; st.sharedKey=await derive(st.keyPair.privateKey, await impJwk(payload.crypto.pub), b64.dec(payload.crypto.salt)); await st.pc.setRemoteDescription(payload.sdp); setActivePeer(from); } else if(payload.kind==='ice'){ const st = peers.get(from); if(!st) return; try{ await st.pc.addIceCandidate(payload.candidate); }catch{} } else if(payload.kind==='group_invite'){ const { id, name, members } = payload.group||{}; if(!id || !name) return; if(members && !members.includes(myId)) return; conversations.set(id,{ name, unread:0, members:members||[] }); renderChats(); } }

	async function send(){ let txt=$('msg').value.trim(); if(!txt) return; const cid = activePeerId; if(!cid){ return; } if(cid.startsWith('grp:')){ const chat = conversations.get(cid); if(chat && Array.isArray(chat.members)){ for(const pid of chat.members){ if(pid===myId) continue; await ensureConnection(pid); const st=peers.get(pid); if(st && st.dc && st.sharedKey){ let pkt=await encrypt(st.sharedKey, txt); pkt.type="cipher"; pkt.chatId=cid; try{ st.dc.send(JSON.stringify(pkt)); }catch{} } } } } else { await ensureConnection(cid); const st=peers.get(cid); if(st && st.dc && st.dc.readyState==='open' && st.sharedKey){ let pkt=await encrypt(st.sharedKey, txt); pkt.type="cipher"; st.dc.send(JSON.stringify(pkt)); } } addMsg(txt,true,false,{chatId: cid}); $('msg').value=""; }
  $('send').onclick=send;
  $('msg').onkeydown=e=>{ if(e.key==="Enter"){e.preventDefault();send();} };

	// Attachment handlers
	const btnAttach=$('btnAttach'), fileInput=$('fileInput'); if(btnAttach&&fileInput){ btnAttach.onclick=()=>fileInput.click(); fileInput.onchange=async()=>{ const cid=activePeerId; if(!cid) return; const files=[...fileInput.files]; for(const f of files){ if(cid.startsWith('grp:')){ const chat=conversations.get(cid); if(chat && chat.members){ for(const pid of chat.members){ if(pid===myId) continue; await sendFileToPeer(pid, f, cid); } } } else { await sendFileToPeer(cid, f, cid); } const entry={ kind:'file', mine:true, chatId: cid, meta:{ name:f.name, type:f.type, size:f.size }, blob:new Blob([await f.arrayBuffer()],{type:f.type}) }; pushStore(cid, entry); renderFileBubble(entry); } fileInput.value=''; } }

	// Emoji quick insert
	const btnEmoji=$('btnEmoji'); if(btnEmoji){ btnEmoji.onclick=()=>{ const m=$('msg'); m.value += ' 🙂'; m.focus(); } }

	// Voice recording
	let mediaRecorder=null, chunks=[]; const btnMic=$('btnMic'); if(btnMic){ btnMic.onclick=async()=>{ if(mediaRecorder && mediaRecorder.state==='recording'){ mediaRecorder.stop(); return; } try{ const stream=await navigator.mediaDevices.getUserMedia({audio:true}); mediaRecorder=new MediaRecorder(stream); chunks=[]; mediaRecorder.ondataavailable=e=>{ if(e.data.size>0) chunks.push(e.data); }; mediaRecorder.onstop=async()=>{ const blob=new Blob(chunks,{type:'audio/webm'}); const file=new File([blob], 'voice.webm', {type:'audio/webm'}); const cid=activePeerId; if(!cid) return; if(cid.startsWith('grp:')){ const chat=conversations.get(cid); if(chat && chat.members){ for(const pid of chat.members){ if(pid===myId) continue; await sendFileToPeer(pid,file,cid); } } } else { await sendFileToPeer(cid,file,cid); } const entry={ kind:'file', mine:true, chatId: cid, meta:{ name:'voice.webm', type:'audio/webm', size:blob.size }, blob}; pushStore(cid, entry); renderFileBubble(entry); }; mediaRecorder.start(); setStatus('Recording… click mic to stop','warn'); } catch { setStatus('Microphone access denied','err'); } } }

	// WebSocket auth
	$('btnLogin').onclick=()=>{ const id=$('logUser').value.trim(); if(!/^[A-Z0-9]{8}$/.test(id)){ setStatus('Enter valid 8-char ID','err'); return; } connectWS(); const sendLogin = () => { try { ws.send(JSON.stringify({type:'login', userId:id})); setStatus('Logging in…','warn'); } catch(e){} }; if(ws && ws.readyState===WebSocket.OPEN){ sendLogin(); } else { ws.addEventListener('open', function once(){ ws.removeEventListener('open', once); sendLogin(); }); } };
  $('btnLogout').onclick=()=>{ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'logout'})); };

  // Start via search box (single or group)
	$('btnStart').onclick=()=>{ const val=$('searchBox').value.trim(); if(!val) return; val.split(',').map(s=>s.trim()).filter(Boolean).forEach(id=>startCall(id)); };

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


