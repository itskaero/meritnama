// ── Chat photo lightbox ──────────────────────────────────────────────

function showChatPhoto(imgEl) {
  var lightbox = document.getElementById('chatPhotoLightbox');
  var lightboxImg = document.getElementById('chatPhotoLightboxImg');
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = imgEl.src;
  lightbox.classList.add('open');
}

function closeChatPhoto(event) {
  var lightbox = document.getElementById('chatPhotoLightbox');
  if (!lightbox) return;
  if (event && event.target !== lightbox && event.target.id !== 'chatPhotoLightboxImg') return;
  lightbox.classList.remove('open');
  var img = document.getElementById('chatPhotoLightboxImg');
  if (img) img.src = '';
}

// ═══════════════════════════════════════════════════════════════════
// END COMMUNITY CHAT
// ═══════════════════════════════════════════════════════════════════

const CHAT = {
  unsubscribe:        null,
  typingUnsubscribe:  null,
  pinUnsubscribe:     null,
  messages:           [],
  _legacy:            [],
  typingUsers:        [],
  pinned:             null,
  unreadCount:        0,
  popupOpen:          false,
  tabActive:          false,
  uid:                null,
  displayName:        null,
  pendingAttach:      {},
  replyingTo:         {},
  sending:            false,
  typingDebounce:     null,
  typingClearTimer:   null,
  COLLECTION:         'sim21_chat',
  TYPING_COLLECTION:  'sim21_chat_typing',
  PIN_DOC:            'chat_pin',
  ROOM_PINS_DOC:      'chat_room_pins',
  roomPins:           {},
  roomPinsUnsubscribe: null,
  EVERYONE_TOKEN:     '@everyone',
  MUTE_EVERYONE_KEY:  'mn_chat_mute_everyone',
  _chatInitialized:   false,
  TYPING_TTL_MS:      4500,
  TYPING_DEBOUNCE_MS: 400,
  CHAR_LIMIT:     500,
  MAX_MESSAGES:   80,
  MAX_IMAGE_INPUT: 12 * 1024 * 1024,
  MAX_IMAGE_STORED: 300 * 1024,
  MAX_FILE_SIZE:  300 * 1024,
  MAX_DOC_BYTES:  950 * 1024,
  ROOMS: [
    { id: 'general', label: 'General', icon: '\u{1F4AC}', desc: 'Open applicant discussion and quick help.' },
    { id: 'announcements', label: 'Announcements', icon: '\u{1F4E3}', desc: 'Important updates and pinned notices.' },
    { id: 'preference-strategy', label: 'Preference Strategy', icon: '\u{1F3AF}', desc: 'Choice filling, safe/target/reach planning.' },
    { id: 'documents', label: 'Documents', icon: '\u{1F4C4}', desc: 'Eligibility, joining paperwork, certificates.' },
    { id: 'mentor-qa', label: 'Mentor Q&A', icon: '\u{1F91D}', desc: 'Ask seniors and verified trainees.' },
    { id: 'fcps', label: 'FCPS', icon: '\u{1FA7A}', desc: 'FCPS-specific questions.' },
    { id: 'ms-md', label: 'MS / MD', icon: '\u{1F3E5}', desc: 'MS and MD-specific discussion.' },
    { id: 'medicine-allied', label: 'Medicine & Allied', icon: '\u{1F48A}', desc: 'Medicine, Paeds, Cardio, allied specialties.' },
    { id: 'surgery-allied', label: 'Surgery & Allied', icon: '\u{1F52C}', desc: 'Surgery, Gynae, Ortho, allied specialties.' },
    { id: 'hospitals', label: 'Hospitals', icon: '\u{1F3E8}', desc: 'Training environment and hospital life.' },
  ],
  ROOM_KEY: 'mn_chat_room',
  activeRoomId: null,
  roomCounts: {},
  onlineCounts: {},
  presenceUnsubscribe: null,
  presenceTimer: null,
  presenceUnloadBound: false,
  PRESENCE_COLLECTION: 'sim21_room_presence',
  PRESENCE_HEARTBEAT_MS: 30000,
  PRESENCE_TTL_MS: 50000,
  typingByUid: new Map(),
  memberProfiles: {},
  onlineMembers: [],
  EMOJIS: ['😊','😂','🙏','❤️','🎉','👍','🔥','💪','🤔','😅',
            '✅','⚡','🌟','💡','😢','🥺','😍','🙌','✨','🎯',
            '🏥','🩺','📚','💊','🧬','😎','🤝','👏','💯','🫡'],
  REACTION_EMOJIS: ['👍','❤️','😂','😮','😢','🙏','🔥','🎉','👏','💯'],
  IMAGE_TYPES: new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  FILE_TYPES: new Set([
    'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'application/x-zip-compressed',
  ]),
};

function _chatUID() {
  if (CHAT.uid) return CHAT.uid;
  let uid = localStorage.getItem('_chat_uid');
  if (!uid) {
    uid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('_chat_uid', uid);
  }
  CHAT.uid = uid;
  return uid;
}

function _chatName() {
  if (CHAT.displayName) return CHAT.displayName;
  const saved = localStorage.getItem('_chat_name');
  CHAT.displayName = saved || null;
  return CHAT.displayName;
}

function _relTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)  return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString('en-PK', { day:'numeric', month:'short' });
}

function _chatRoomById(roomId) {
  return CHAT.ROOMS.find(r => r.id === roomId) || CHAT.ROOMS[0];
}

function _chatRoomId(roomId) {
  return _chatRoomById(String(roomId || '').trim()).id;
}

function _chatActiveRoom() {
  if (!CHAT.activeRoomId) {
    CHAT.activeRoomId = _chatRoomId(localStorage.getItem(CHAT.ROOM_KEY) || 'general');
  }
  return _chatRoomById(CHAT.activeRoomId);
}

function _chatMessageRoomId(msg) {
  return _chatRoomId(msg?.roomId || 'general');
}

function _chatVisibleMessages() {
  const roomId = _chatActiveRoom().id;
  return CHAT.messages.filter(msg => _chatMessageRoomId(msg) === roomId);
}

function _chatAuthEmail() {
  try {
    const session = JSON.parse(localStorage.getItem('meritnama_auth_session') || 'null');
    return String(session?.email || '').toLowerCase().trim();
  } catch (_) {
    return '';
  }
}

function _chatRoomPresenceDocId(roomId, uid) {
  return `${_chatRoomId(roomId)}_${String(uid || '').replace(/[^\w-]/g, '_').slice(0, 80)}`;
}

function setupChat() {
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    setTimeout(setupChat, 100);
    return;
  }
  // Pre-populate display name from Firestore profile if not already set
  if (!_chatName()) {
    try {
      const session = JSON.parse(localStorage.getItem('meritnama_auth_session') || 'null');
      const email   = session?.email;
      if (email) {
        const db = firebase.firestore();
        db.collection('user_profiles').doc(email).get().then(doc => {
          if (doc.exists && doc.data().name && !_chatName()) {
            const profileName = doc.data().name.trim().slice(0, 40);
            localStorage.setItem('_chat_name', profileName);
            CHAT.displayName = profileName;
            ['chatTabNameBar', 'chatPopupNameBar'].forEach(id => {
              const el = document.getElementById(id);
              if (el) _renderChatNameBar(el, id.includes('Tab') ? 'chatTabInput' : 'chatPopupInput');
            });
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Setup bubble toggle
  const bubble = document.getElementById('chatBubbleBtn');
  const popup  = document.getElementById('chatPopup');
  if (bubble) {
    bubble.addEventListener('click', () => {
      const isHidden = popup?.classList.contains('hidden');
      if (isHidden) {
        popup?.classList.remove('hidden');
        CHAT.popupOpen = true;
        _resetUnread();
        _chatScrollBottom('chatPopupMessages');
      } else {
        popup?.classList.add('hidden');
        CHAT.popupOpen = false;
      }
    });
  }

  // Close popup when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.chat-react-add-btn') && !e.target.closest('.chat-react-picker')) {
      document.querySelectorAll('.chat-react-picker').forEach(p => p.classList.add('hidden'));
    }
    if (!CHAT.popupOpen) return;
    if (popup?.contains(e.target) || bubble?.contains(e.target)) return;
    popup?.classList.add('hidden');
    CHAT.popupOpen = false;
  });

  // Wire both chat UIs (tab and popup)
  _wireChatInput({
    prefix: 'Tab',
    inputId: 'chatTabInput',
    sendBtnId: 'chatTabSendBtn',
    msgsId: 'chatTabMessages',
    charCountId: 'chatTabCharCount',
    emojiBtnId: 'chatTabEmojiBtn',
    emojiPickerId: 'chatTabEmojiPicker',
    nameBarId: 'chatTabNameBar',
    replyBarId: 'chatTabReplyBar',
    everyoneBarId: 'chatTabEveryoneBar',
    imageBtnId: 'chatTabImageBtn',
    imageInputId: 'chatTabImageInput',
    attachPreviewId: 'chatTabAttachPreview',
  });
  _wireChatInput({
    prefix: 'Popup',
    inputId: 'chatPopupInput',
    sendBtnId: 'chatPopupSendBtn',
    msgsId: 'chatPopupMessages',
    charCountId: 'chatPopupCharCount',
    emojiBtnId: 'chatPopupEmojiBtn',
    emojiPickerId: 'chatPopupEmojiPicker',
    nameBarId: 'chatPopupNameBar',
    replyBarId: 'chatPopupReplyBar',
    everyoneBarId: 'chatPopupEveryoneBar',
    imageBtnId: 'chatPopupImageBtn',
    imageInputId: 'chatPopupImageInput',
    attachPreviewId: 'chatPopupAttachPreview',
  });

  _initChatRoomsUI();
  _startChatListener();
  _startTypingListener();
  _startChatPinListener();
  _startRoomPinsListener();
  _startRoomPresence();
}

function _chatPrefixKey(prefix) {
  return prefix || 'Tab';
}

function _formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _chatCompressImage(file, maxPx = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('compress failed')); return; }
          resolve(new File([blob], (file.name || 'image.jpg').replace(/\.\w+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function _chatPrepareImage(file) {
  const steps = [
    { maxPx: 1000, quality: 0.78 },
    { maxPx: 800, quality: 0.7 },
    { maxPx: 640, quality: 0.62 },
    { maxPx: 480, quality: 0.55 },
    { maxPx: 360, quality: 0.48 },
  ];
  let last = file;
  for (const step of steps) {
    last = await _chatCompressImage(file, step.maxPx, step.quality);
    if (last.size <= CHAT.MAX_IMAGE_STORED) return last;
  }
  return last;
}

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function _estimateDocBytes(payload) {
  try { return new Blob([JSON.stringify(payload)]).size; } catch { return 0; }
}

function _renderChatAttachPreview(prefix) {
  const key = _chatPrefixKey(prefix);
  const previewEl = document.getElementById(key === 'Tab' ? 'chatTabAttachPreview' : 'chatPopupAttachPreview');
  if (!previewEl) return;

  const pending = CHAT.pendingAttach[key];
  if (!pending) {
    previewEl.classList.add('hidden');
    previewEl.innerHTML = '';
    return;
  }

  const isImage = pending.kind === 'image';
  const thumb = isImage && pending.previewUrl
    ? `<img class="chat-attach-thumb" src="${pending.previewUrl}" alt="Preview" />`
    : `<div class="chat-attach-file-icon">&#128206;</div>`;

  previewEl.innerHTML = `
    ${thumb}
    <div class="chat-attach-meta">
      <div class="chat-attach-name">${esc(pending.name)}</div>
      <div class="chat-attach-size">${_formatFileSize(pending.size)}${isImage ? ' · image' : ' · file'}</div>
    </div>
    <button class="chat-attach-remove" type="button" data-prefix="${key}" title="Remove attachment">&times;</button>
  `;
  previewEl.classList.remove('hidden');
  previewEl.querySelector('.chat-attach-remove')?.addEventListener('click', () => {
    _clearChatAttachment(key);
  });
}

function _clearChatAttachment(prefix) {
  const key = _chatPrefixKey(prefix);
  const pending = CHAT.pendingAttach[key];
  if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
  delete CHAT.pendingAttach[key];
  const imageInput = document.getElementById(key === 'Tab' ? 'chatTabImageInput' : 'chatPopupImageInput');
  const fileInput  = document.getElementById(key === 'Tab' ? 'chatTabFileInput' : 'chatPopupFileInput');
  if (imageInput) imageInput.value = '';
  if (fileInput) fileInput.value = '';
  _renderChatAttachPreview(key);
}

async function _setChatAttachment(prefix, file, kind) {
  const key = _chatPrefixKey(prefix);
  if (!file) return;

  const isImage = kind === 'image';
  const maxInput = isImage ? CHAT.MAX_IMAGE_INPUT : CHAT.MAX_FILE_SIZE;
  if (file.size > maxInput) {
    showToast(
      isImage ? 'Image too large. Try a smaller photo.' : `File too large (max ${_formatFileSize(CHAT.MAX_FILE_SIZE)})`,
      'warning'
    );
    return;
  }

  const mime = file.type || '';
  if (isImage) {
    if (!CHAT.IMAGE_TYPES.has(mime) && !file.name.match(/\.(jpe?g|png|gif|webp)$/i)) {
      showToast('Unsupported image type. Use JPG, PNG, GIF, or WebP.', 'warning');
      return;
    }
  } else if (!CHAT.FILE_TYPES.has(mime) && !file.name.match(/\.(pdf|txt|docx?|xlsx?|zip)$/i)) {
    showToast('Unsupported file type. Use PDF, TXT, DOC, XLS, or ZIP.', 'warning');
    return;
  }

  let uploadFile = file;
  if (isImage) {
    try { uploadFile = await _chatPrepareImage(file); } catch (_) { uploadFile = file; }
    if (uploadFile.size > CHAT.MAX_IMAGE_STORED) {
      showToast(`Image too large after compression (max ${_formatFileSize(CHAT.MAX_IMAGE_STORED)}). Try a smaller photo.`, 'warning');
      return;
    }
  }

  _clearChatAttachment(key);
  CHAT.pendingAttach[key] = {
    kind,
    file: uploadFile,
    name: uploadFile.name || file.name,
    size: uploadFile.size,
    mime: uploadFile.type || mime,
    previewUrl: isImage ? URL.createObjectURL(uploadFile) : null,
  };
  _renderChatAttachPreview(key);
}

function _wireChatInput(cfg) {
  const input     = document.getElementById(cfg.inputId);
  const sendBtn   = document.getElementById(cfg.sendBtnId);
  const charCount = document.getElementById(cfg.charCountId);
  const emojiBtn  = document.getElementById(cfg.emojiBtnId);
  const emojiPkr  = document.getElementById(cfg.emojiPickerId);
  const namBar    = document.getElementById(cfg.nameBarId);
  const prefix    = _chatPrefixKey(cfg.prefix);

  if (!input || !sendBtn) return;

  // Character counter + typing signal
  input.addEventListener('input', () => {
    const len = input.value.length;
    if (charCount) {
      charCount.textContent = `${len}/${CHAT.CHAR_LIMIT}`;
      charCount.style.color = len > CHAT.CHAR_LIMIT * 0.9 ? 'var(--neon-gold)' : '';
      charCount.style.fontWeight = len > CHAT.CHAR_LIMIT * 0.9 ? '700' : '';
    }
    _chatSignalTyping();
  });
  input.addEventListener('blur', () => _chatClearTyping());

  // Send on Enter (Shift+Enter = newline)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _sendChatMessage(cfg.inputId, cfg.msgsId, prefix);
    }
  });

  sendBtn.addEventListener('click', () => _sendChatMessage(cfg.inputId, cfg.msgsId, prefix));

  // Image upload (files disabled)
  const imageBtn   = document.getElementById(cfg.imageBtnId);
  const imageInput = document.getElementById(cfg.imageInputId);
  imageBtn?.addEventListener('click', () => imageInput?.click());
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (file) _setChatAttachment(prefix, file, 'image');
    imageInput.value = '';
  });

  // @everyone + mute toolbar (built once on Tab bar only)
  const everyoneBar = document.getElementById(cfg.everyoneBarId);
  if (everyoneBar && !everyoneBar.dataset.built) {
    everyoneBar.innerHTML = `
      <button type="button" class="chat-everyone-btn" data-input="${cfg.inputId}" title="Notify everyone in chat">@everyone</button>
      <button type="button" class="chat-mute-everyone-btn" title="Mute @everyone notifications">&#128263; @everyone</button>`;
    everyoneBar.dataset.built = '1';
    everyoneBar.querySelector('.chat-everyone-btn')?.addEventListener('click', () => {
      const inp = document.getElementById(cfg.inputId);
      if (!inp) return;
      const token = CHAT.EVERYONE_TOKEN;
      if (!new RegExp(`${token}\\b`, 'i').test(inp.value)) {
        const sep = inp.value.length && !/\s$/.test(inp.value) ? ' ' : '';
        inp.value = inp.value + sep + token + ' ';
      }
      inp.focus();
      inp.dispatchEvent(new Event('input'));
    });
    everyoneBar.querySelector('.chat-mute-everyone-btn')?.addEventListener('click', () => {
      _toggleEveryoneMute();
      _syncEveryoneMuteButtons();
    });
    _syncEveryoneMuteButtons();
  }

  // Emoji picker
  if (emojiBtn && emojiPkr) {
    // Build emoji grid once
    if (!emojiPkr.dataset.built) {
      emojiPkr.innerHTML = CHAT.EMOJIS.map(em =>
        `<button class="chat-emoji-item" type="button">${em}</button>`
      ).join('');
      emojiPkr.dataset.built = '1';
      emojiPkr.querySelectorAll('.chat-emoji-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const pos = input.selectionStart ?? input.value.length;
          input.value = input.value.slice(0, pos) + btn.textContent + input.value.slice(pos);
          input.focus();
          input.dispatchEvent(new Event('input'));
          emojiPkr.classList.add('hidden');
        });
      });
    }
    emojiBtn.addEventListener('click', e => {
      e.stopPropagation();
      emojiPkr.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!emojiPkr.contains(e.target) && e.target !== emojiBtn) {
        emojiPkr.classList.add('hidden');
      }
    });
  }

  // Display name bar
  if (namBar) _renderChatNameBar(namBar, cfg.inputId);
}

function _isEveryoneMuted() {
  return localStorage.getItem(CHAT.MUTE_EVERYONE_KEY) === '1';
}

function _toggleEveryoneMute() {
  const next = !_isEveryoneMuted();
  if (next) localStorage.setItem(CHAT.MUTE_EVERYONE_KEY, '1');
  else localStorage.removeItem(CHAT.MUTE_EVERYONE_KEY);
  showToast(next ? '@everyone notifications muted' : '@everyone notifications enabled', 'info');
}

function _syncEveryoneMuteButtons() {
  const muted = _isEveryoneMuted();
  document.querySelectorAll('.chat-mute-everyone-btn').forEach(btn => {
    btn.classList.toggle('chat-mute-active', muted);
    btn.title = muted ? 'Unmute @everyone notifications' : 'Mute @everyone notifications';
    btn.textContent = muted ? '\u{1F507} muted' : '\u{1F50A} @everyone';
  });
}

function _renderChatNameBar(container, inputId) {
  const name = _chatName();
  container.innerHTML = name
    ? `<span style="font-size:0.75rem;color:var(--text-muted)">Chatting as <strong style="color:var(--neon-cyan)">${esc(name)}</strong></span>
       <button class="chat-name-change-btn" data-input="${inputId}" style="font-size:0.72rem;background:none;border:none;color:var(--text-muted);cursor:pointer;text-decoration:underline;padding:0">change</button>`
    : `<span style="font-size:0.75rem;color:var(--neon-gold)">&#9888; Set your display name to chat</span>
       <button class="chat-name-set-btn" data-input="${inputId}" style="font-size:0.72rem;padding:3px 10px;background:rgba(77,184,217,0.12);border:1px solid rgba(77,184,217,0.3);color:var(--neon-cyan);border-radius:100px;cursor:pointer;">Set name</button>`;

  container.querySelectorAll('.chat-name-set-btn, .chat-name-change-btn').forEach(btn => {
    btn.addEventListener('click', () => _promptChatName(btn.dataset.input));
  });
}

function _promptChatName(returnInputId) {
  const current = _chatName() || '';
  const input   = document.getElementById(returnInputId);
  const name    = window.prompt('Enter your display name for community chat:', current);
  if (name === null) return; // cancelled
  const cleaned = name.trim().slice(0, 40);
  if (!cleaned) {
    showToast('Display name cannot be empty.', 'warning');
    return;
  }
  localStorage.setItem('_chat_name', cleaned);
  CHAT.displayName = cleaned;
  showToast(`Name set to "${cleaned}"`, 'success');
  // Refresh name bars
  ['chatTabNameBar', 'chatPopupNameBar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) _renderChatNameBar(el, id.includes('Tab') ? 'chatTabInput' : 'chatPopupInput');
  });
  _chatWriteRoomPresence(_chatActiveRoom().id, true);
  input?.focus();
}

async function _encodeChatAttachment(pending) {
  const dataUrl = await _fileToDataUrl(pending.file);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('encode failed');
  }
  return {
    name: pending.name,
    size: pending.size,
    mime: pending.mime,
    dataUrl,
  };
}

function _sendChatMessage(inputId, msgsId, prefix) {
  if (CHAT.sending) return;
  const input = document.getElementById(inputId);
  if (!input) return;
  const text = input.value.trim();
  const key = _chatPrefixKey(prefix);
  const pending = CHAT.pendingAttach[key] || null;
  if (!text && !pending) return;
  if (text.length > CHAT.CHAR_LIMIT) {
    showToast(`Message too long (max ${CHAT.CHAR_LIMIT} chars)`, 'warning');
    return;
  }
  const name = _chatName();
  if (!name) {
    showToast('Please set a display name first.', 'warning');
    _promptChatName(inputId);
    return;
  }
  if (_chatHasEveryoneMention(text)) {
    const ok = window.confirm(`Send @everyone to ${_chatActiveRoom().label}? Others in this room will get a notification.`);
    if (!ok) return;
  }

  let db;
  try { db = firebase.firestore(); } catch { showToast('Chat unavailable.', 'error'); return; }

  const uid = _chatUID();
  const sendBtn = document.getElementById(inputId.replace('Input', 'SendBtn'));
  CHAT.sending = true;
  if (sendBtn) sendBtn.disabled = true;

  (async () => {
    const room = _chatActiveRoom();
    const payload = {
      text: text || '',
      name,
      uid,
      email: _chatAuthEmail(),
      roomId: room.id,
      roomLabel: room.label,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const reply = CHAT.replyingTo[key];
    if (reply) {
      payload.replyTo = {
        id: reply.id,
        name: reply.name,
        text: (reply.text || '').slice(0, 140),
      };
    }
    if (_chatHasEveryoneMention(text)) payload.mentionsEveryone = true;
    const mentions = _chatExtractMentions(text);
    if (mentions.length) payload.mentions = mentions;

    if (pending) {
      const encoded = await _encodeChatAttachment(pending);
      payload.type = pending.kind;
      payload.fileName = encoded.name;
      payload.fileSize = encoded.size;
      payload.mimeType = encoded.mime;
      if (pending.kind === 'image') payload.imageData = encoded.dataUrl;
      else payload.fileData = encoded.dataUrl;

      if (_estimateDocBytes(payload) > CHAT.MAX_DOC_BYTES) {
        throw new Error('Attachment too large for Firestore. Try a smaller file or shorter caption.');
      }
    }

    await db.collection(CHAT.COLLECTION).add(payload);
    _chatClearTyping();
    input.value = '';
    const cc = document.getElementById(inputId.replace('Input', 'CharCount'));
    if (cc) cc.textContent = `0/${CHAT.CHAR_LIMIT}`;
    _clearChatAttachment(key);
    _clearChatReply(key);
    _chatScrollBottom(msgsId);
  })().catch(err => {
    showToast(err?.message || 'Could not send message.', 'error');
    console.error('Chat send error:', err);
  }).finally(() => {
    CHAT.sending = false;
    if (sendBtn) sendBtn.disabled = false;
  });
}

function _startChatListener() {
  let db;
  try { db = firebase.firestore(); } catch { return; }

  if (CHAT.unsubscribe) CHAT.unsubscribe();

  // Also load legacy applicant_chat messages (one-time fetch, ordered by createdAt)
  const LEGACY = 'applicant_chat';
  db.collection(LEGACY).orderBy('createdAt', 'asc').limitToLast(CHAT.MAX_MESSAGES).get()
    .then(snap => {
      CHAT._legacy = snap.docs.map(d => {
        const data = d.data();
        return {
          id:   '_legacy_' + d.id,
          text: data.text,
          name: data.sender || 'Anonymous',
          uid:  '_legacy',
          ts:   data.createdAt,
        };
      });
    })
    .catch(() => { CHAT._legacy = []; });

  CHAT.unsubscribe = db.collection(CHAT.COLLECTION)
    .orderBy('ts', 'asc')
    .limitToLast(CHAT.MAX_MESSAGES)
    .onSnapshot(snap => {
      const fresh = snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, roomId: _chatRoomId(data.roomId || 'general') };
      });
      const prevIds = new Set(CHAT.messages.map(m => m.id));
      const uid = _chatUID();
      // Merge legacy + new, dedup by id, keep sorted by ts
      const legacy = (CHAT._legacy || []).filter(l =>
        !fresh.some(f => f.text === l.text && f.name === l.name)
      );
      CHAT.messages = [...legacy, ...fresh].sort((a, b) => {
        const ta = a.ts?.toMillis?.() ?? a.ts ?? 0;
        const tb = b.ts?.toMillis?.() ?? b.ts ?? 0;
        return ta - tb;
      });
      CHAT.roomCounts = CHAT.messages.reduce((acc, msg) => {
        const roomId = _chatMessageRoomId(msg);
        acc[roomId] = (acc[roomId] || 0) + 1;
        return acc;
      }, {});
      if (CHAT._chatInitialized) {
        const activeRoomId = _chatActiveRoom().id;
        for (const msg of CHAT.messages) {
          if (prevIds.has(msg.id)) continue;
          if (msg.uid === uid) continue;
          if (_chatMessageRoomId(msg) !== activeRoomId) continue;
          if (_chatHasEveryoneMention(msg)) _notifyEveryoneMention(msg);
          if (_chatMentionsCurrentUser(msg)) _notifyUserMention(msg);
        }
      }
      CHAT._chatInitialized = true;
      const isVisible = CHAT.popupOpen || CHAT.tabActive;
      const hasNewInActiveRoom = CHAT.messages.some(msg =>
        !prevIds.has(msg.id) && msg.uid !== uid && _chatMessageRoomId(msg) === _chatActiveRoom().id
      );
      if (!isVisible && hasNewInActiveRoom) {
        CHAT.unreadCount++;
        _updateBadge();
      }
      _renderAllChatMessages();
      _renderRoomCounts();
      if (isVisible) _chatScrollBottom('chatTabMessages');
      if (CHAT.popupOpen) _chatScrollBottom('chatPopupMessages');
    }, err => {
      console.warn('Chat listener error:', err);
    });
}

function _renderAllChatMessages() {
  _renderChatMessages('chatTabMessages');
  _renderChatMessages('chatPopupMessages');
}

function _chatReactionHtml(msg, uid) {
  const reactions = msg.reactions || {};
  const entries = Object.entries(reactions).filter(([, users]) => Array.isArray(users) && users.length);
  const chips = entries.map(([emoji, users]) => {
    const count = users.length;
    const own = users.includes(uid);
    return `<button class="chat-reaction-btn ${own ? 'chat-reaction-btn-own' : ''}" type="button"
      data-id="${msg.id}" data-emoji="${emoji}" title="React with ${emoji}">${emoji}<span>${count}</span></button>`;
  }).join('');
  const pickerItems = CHAT.REACTION_EMOJIS.map(em =>
    `<button class="chat-react-picker-item" type="button" data-id="${msg.id}" data-emoji="${em}">${em}</button>`
  ).join('');
  return `<div class="chat-reactions">
    ${chips}
    <div class="chat-msg-body-wrap">
      <button class="chat-react-add-btn" type="button" data-id="${msg.id}" title="Add reaction">+</button>
      <div class="chat-react-picker hidden" data-for="${msg.id}">${pickerItems}</div>
    </div>
  </div>`;
}

function _chatHasEveryoneMention(msgOrText) {
  const text = typeof msgOrText === 'string' ? msgOrText : (msgOrText?.text || '');
  if (/@everyone\b/i.test(text)) return true;
  return !!(typeof msgOrText === 'object' && msgOrText?.mentionsEveryone);
}

function _notifyEveryoneMention(msg) {
  if (_isEveryoneMuted()) return;
  const who = msg.name || 'Someone';
  const body = (msg.text || '').replace(/@everyone/gi, '').trim().slice(0, 140) || 'New community chat message';
  const title = `${who} mentioned @everyone`;
  showToast(`${title}${body ? ': ' + body : ''}`, 'info');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'mn_chat_everyone_' + msg.id });
    } catch (_) {}
  }
}

function _chatMentionToken(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.includes(' ') ? `@"${n}"` : `@${n.replace(/\s+/g, '')}`;
}

function _chatExtractMentions(text) {
  const found = new Set();
  const t = String(text || '');
  const re = /@everyone\b|@"([^"]{1,40})"|@([\w][\w.-]{0,38})/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (/everyone/i.test(m[0])) continue;
    const name = (m[1] || m[2] || '').trim();
    if (name) found.add(name);
  }
  return [...found];
}

function _chatNameMatchesMention(myName, mention) {
  if (!myName || !mention) return false;
  const a = myName.toLowerCase().trim();
  const b = mention.toLowerCase().trim();
  if (a === b) return true;
  if (a.startsWith(b + ' ')) return true;
  if (a.split(/\s+/)[0] === b) return true;
  return false;
}

function _chatMentionsCurrentUser(msg) {
  const myName = _chatName();
  if (!myName) return false;
  const list = msg.mentions || _chatExtractMentions(msg.text);
  return list.some(m => _chatNameMatchesMention(myName, m));
}

function _notifyUserMention(msg) {
  const who = msg.name || 'Someone';
  const body = (msg.text || '').trim().slice(0, 140) || 'New community chat message';
  const title = `${who} mentioned you`;
  showToast(`${title}${body ? ': ' + body : ''}`, 'info');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'mn_chat_mention_' + msg.id });
    } catch (_) {}
  }
}

function _chatFormatMessageText(text) {
  const myName = _chatName();
  const parts = [];
  const re = /@everyone\b|@"([^"]{1,40})"|@([\w][\w.-]{0,38})/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    if (m.index > last) {
      parts.push(esc(text.slice(last, m.index)).replace(/\n/g, '<br>'));
    }
    if (/everyone/i.test(m[0])) {
      parts.push('<span class="chat-mention-everyone">@everyone</span>');
    } else {
      const mentionName = m[1] || m[2] || '';
      const isMe = _chatNameMatchesMention(myName, mentionName);
      parts.push(`<span class="${isMe ? 'chat-mention-me' : 'chat-mention-user'}">@${esc(mentionName)}</span>`);
    }
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) {
    parts.push(esc(text.slice(last)).replace(/\n/g, '<br>'));
  }
  return parts.join('') || '';
}

function _chatSignalTyping() {
  if (!_chatName()) return;
  clearTimeout(CHAT.typingDebounce);
  CHAT.typingDebounce = setTimeout(_chatWriteTyping, CHAT.TYPING_DEBOUNCE_MS);
}

async function _chatWriteTyping() {
  let db;
  try { db = firebase.firestore(); } catch { return; }
  const uid = _chatUID();
  const name = _chatName();
  if (!name) return;
  try {
    await db.collection(CHAT.TYPING_COLLECTION).doc(uid).set({
      uid, name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (_) {}
  clearTimeout(CHAT.typingClearTimer);
  CHAT.typingClearTimer = setTimeout(_chatClearTyping, CHAT.TYPING_TTL_MS);
}

async function _chatClearTyping() {
  clearTimeout(CHAT.typingDebounce);
  clearTimeout(CHAT.typingClearTimer);
  let db;
  try { db = firebase.firestore(); } catch { return; }
  try {
    await db.collection(CHAT.TYPING_COLLECTION).doc(_chatUID()).delete();
  } catch (_) {}
}

function _startTypingListener() {
  let db;
  try { db = firebase.firestore(); } catch { return; }
  if (CHAT.typingUnsubscribe) CHAT.typingUnsubscribe();
  const uid = _chatUID();
  const cutoff = () => Date.now() - CHAT.TYPING_TTL_MS;

  CHAT.typingUnsubscribe = db.collection(CHAT.TYPING_COLLECTION)
    .onSnapshot(snap => {
      const users = [];
      const typingSet = new Set();
      const roomId = _chatActiveRoom().id;
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.name || d.uid === uid) continue;
        if (_chatRoomId(d.roomId || 'general') !== roomId) continue;
        const ts = d.updatedAt?.toMillis?.() ?? 0;
        if (ts && ts < cutoff()) continue;
        users.push({ uid: d.uid || doc.id, name: d.name });
        typingSet.add(d.uid || doc.id);
      }
      CHAT.typingUsers = users.slice(0, 4);
      CHAT.typingByUid = typingSet;
      _renderTypingIndicators();
      _renderOnlineMembers();
    }, err => console.warn('Typing listener error:', err));
}

function _renderTypingIndicators() {
  const names = CHAT.typingUsers.map(u => u.name || 'Someone');
  const text = names.length
    ? (names.length === 1
        ? `${names[0]} is typing…`
        : `${names.slice(0, 2).join(', ')}${names.length > 2 ? ' +' + (names.length - 2) : ''} typing…`)
    : '';
  ['chatTabTyping', 'chatPopupTyping'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  });
}

function _startChatPinListener() {
  let db;
  try { db = firebase.firestore(); } catch { return; }
  if (CHAT.pinUnsubscribe) CHAT.pinUnsubscribe();
  CHAT.pinUnsubscribe = db.collection('notifications').doc(CHAT.PIN_DOC)
    .onSnapshot(snap => {
      CHAT.pinned = snap.exists && snap.data()?.active ? snap.data() : null;
      _renderChatPinBanners();
    }, err => console.warn('Chat pin listener error:', err));
}

function _startRoomPinsListener() {
  let db;
  try { db = firebase.firestore(); } catch { return; }
  if (CHAT.roomPinsUnsubscribe) CHAT.roomPinsUnsubscribe();
  CHAT.roomPinsUnsubscribe = db.collection('notifications').doc(CHAT.ROOM_PINS_DOC)
    .onSnapshot(snap => {
      CHAT.roomPins = snap.exists ? (snap.data()?.rooms || {}) : {};
      _renderChatPinBanners();
    }, err => console.warn('Room pins listener error:', err));
}

function _chatActivePins() {
  const pins = [];
  const roomId = _chatActiveRoom().id;
  const roomPin = CHAT.roomPins?.[roomId];
  if (roomPin?.active !== false && roomPin?.text) {
    pins.push({ ...roomPin, label: `${_chatActiveRoom().label} pinned post`, scope: 'room' });
  }
  if (CHAT.pinned?.text) {
    pins.push({ ...CHAT.pinned, label: 'Portal pinned post', scope: 'global' });
  }
  return pins;
}

function _renderChatPinBanners() {
  const pins = _chatActivePins();
  ['chatTabPin', 'chatPopupPin'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!pins.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.innerHTML = pins.map(pin => {
      const by = pin.pinnedBy ? ` — ${esc(pin.pinnedBy)}` : '';
      return `
      <div class="chat-pin-inner">
        <span class="chat-pin-label">&#128204; ${esc(pin.label || 'Pinned')}</span>
        <span class="chat-pin-text">${esc(pin.text).replace(/\n/g, '<br>')}</span>
        ${by ? `<span class="chat-pin-by">${by}</span>` : ''}
      </div>`;
    }).join('');
    el.classList.remove('hidden');
  });
}

function _chatReplyQuoteHtml(replyTo) {
  if (!replyTo) return '';
  const snippet = (replyTo.text || '').slice(0, 100);
  return `<div class="chat-reply-quote" data-reply-id="${esc(replyTo.id || '')}">
    <span class="chat-reply-name">${esc(replyTo.name || 'Anonymous')}</span>
    <span class="chat-reply-snippet">${esc(snippet)}${(replyTo.text || '').length > 100 ? '…' : ''}</span>
  </div>`;
}

function _chatMessageBodyHtml(msg) {
  const parts = [];
  if (msg.replyTo) parts.push(_chatReplyQuoteHtml(msg.replyTo));
  if (msg.text) parts.push(_chatFormatMessageText(msg.text));
  const imageSrc = msg.imageData || msg.imageUrl;
  if (imageSrc) {
    const imgId = 'cimg_' + String(Math.random()).slice(2, 10);
    parts.push(`<img class="chat-msg-image" src="${esc(imageSrc)}" alt="Shared image" loading="lazy" onclick="showChatPhoto(this)" id="${imgId}" />`);
  }
  const fileSrc = msg.fileData || msg.fileUrl;
  if (fileSrc) {
    const label = esc(msg.fileName || 'Download file');
    const size = msg.fileSize ? ` (${_formatFileSize(msg.fileSize)})` : '';
    const download = msg.fileName ? ` download="${esc(msg.fileName)}"` : '';
    parts.push(`<a class="chat-msg-file" href="${esc(fileSrc)}"${download} target="_blank" rel="noopener">&#128206; ${label}${size}</a>`);
  }
  if (!parts.length) parts.push('<span style="opacity:0.6">(empty message)</span>');
  return parts.join('');
}

function _renderChatMessages(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const uid = _chatUID();
  const visible = _chatVisibleMessages();
  if (!visible.length) {
    container.innerHTML = `<div class="chat-empty">No messages in ${esc(_chatActiveRoom().label)} yet. Say hello! 👋</div>`;
    return;
  }
  container.innerHTML = visible.map(msg => {
    const isOwn  = msg.uid === uid;
    const relTm  = _relTime(msg.ts);
    const canReact = !String(msg.id).startsWith('_legacy_');
    return `<div class="chat-msg ${isOwn ? 'chat-msg-own' : ''}" data-msg-id="${msg.id}">
      <div class="chat-msg-meta">
        <span class="chat-msg-name ${isOwn ? 'chat-msg-name-own' : ''}">${esc(msg.name || 'Anonymous')}</span>
        <span class="chat-msg-time">${relTm}</span>
        ${canReact ? `<button class="chat-mention-btn" data-id="${msg.id}" data-prefix="${containerId.includes('Popup') ? 'Popup' : 'Tab'}" title="Mention @${esc(msg.name || 'user')}">@</button>` : ''}
        ${canReact ? `<button class="chat-reply-btn" data-id="${msg.id}" title="Reply">&#8617;</button>` : ''}
        ${isOwn && canReact ? `<button class="chat-del-btn" data-id="${msg.id}" title="Delete message">&times;</button>` : ''}
      </div>
      <div class="chat-msg-bubble ${isOwn ? 'chat-msg-bubble-own' : ''}">${_chatMessageBodyHtml(msg)}</div>
      ${canReact ? _chatReactionHtml(msg, uid) : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.chat-del-btn').forEach(btn => {
    btn.addEventListener('click', () => _deleteChatMessage(btn.dataset.id));
  });
  container.querySelectorAll('.chat-mention-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = CHAT.messages.find(m => m.id === btn.dataset.id);
      if (msg?.name) _insertChatMention(msg.name, btn.dataset.prefix);
    });
  });
  container.querySelectorAll('.chat-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const msg = CHAT.messages.find(m => m.id === btn.dataset.id);
      if (!msg) return;
      const prefix = containerId.includes('Popup') ? 'Popup' : 'Tab';
      _setChatReply(prefix, msg);
    });
  });
  container.querySelectorAll('.chat-reply-quote').forEach(quote => {
    quote.addEventListener('click', () => {
      const id = quote.dataset.replyId;
      if (!id) return;
      const el = container.querySelector(`[data-msg-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('chat-msg-highlight');
        setTimeout(() => el.classList.remove('chat-msg-highlight'), 1600);
      }
    });
  });
  container.querySelectorAll('.chat-reaction-btn, .chat-react-picker-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _toggleChatReaction(btn.dataset.id, btn.dataset.emoji);
      container.querySelectorAll('.chat-react-picker').forEach(p => p.classList.add('hidden'));
    });
  });
  container.querySelectorAll('.chat-react-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const picker = container.querySelector(`.chat-react-picker[data-for="${btn.dataset.id}"]`);
      if (!picker) return;
      const wasOpen = !picker.classList.contains('hidden');
      container.querySelectorAll('.chat-react-picker').forEach(p => p.classList.add('hidden'));
      if (!wasOpen) picker.classList.remove('hidden');
    });
  });
}

async function _toggleChatReaction(msgId, emoji) {
  if (!msgId || !emoji || String(msgId).startsWith('_legacy_')) return;
  let db;
  try { db = firebase.firestore(); } catch { showToast('Chat unavailable.', 'error'); return; }

  const uid = _chatUID();
  const ref = db.collection(CHAT.COLLECTION).doc(msgId);

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      const reactions = { ...(data.reactions || {}) };
      const list = [...(reactions[emoji] || [])];
      const idx = list.indexOf(uid);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(uid);
      if (list.length) reactions[emoji] = list;
      else delete reactions[emoji];
      tx.update(ref, { reactions });
    });
  } catch (err) {
    showToast('Could not update reaction.', 'error');
    console.error('Reaction error:', err);
  }
}

function _insertChatMention(name, prefix) {
  const inputId = _chatPrefixKey(prefix) === 'Tab' ? 'chatTabInput' : 'chatPopupInput';
  const inp = document.getElementById(inputId);
  const token = _chatMentionToken(name);
  if (!inp || !token) return;
  if (!new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(inp.value)) {
    const sep = inp.value.length && !/\s$/.test(inp.value) ? ' ' : '';
    inp.value = inp.value + sep + token + ' ';
  }
  inp.focus();
  inp.dispatchEvent(new Event('input'));
}

function _setChatReply(prefix, msg) {
  const key = _chatPrefixKey(prefix);
  CHAT.replyingTo[key] = {
    id: msg.id,
    name: msg.name || 'Anonymous',
    text: msg.text || '',
  };
  _renderChatReplyBar(key);
  if (msg.name) _insertChatMention(msg.name, prefix);
  const inputId = key === 'Tab' ? 'chatTabInput' : 'chatPopupInput';
  document.getElementById(inputId)?.focus();
}

function _clearChatReply(prefix) {
  const key = _chatPrefixKey(prefix);
  delete CHAT.replyingTo[key];
  _renderChatReplyBar(key);
}

function _renderChatReplyBar(prefix) {
  const key = _chatPrefixKey(prefix);
  const barId = key === 'Tab' ? 'chatTabReplyBar' : 'chatPopupReplyBar';
  const bar = document.getElementById(barId);
  if (!bar) return;
  const reply = CHAT.replyingTo[key];
  if (!reply) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  const snippet = (reply.text || '').slice(0, 80);
  bar.innerHTML = `
    <div class="chat-reply-bar-inner">
      <div class="chat-reply-bar-text">
        <span class="chat-reply-bar-label">Replying to <strong>${esc(reply.name)}</strong></span>
        <span class="chat-reply-bar-snippet">${esc(snippet)}${(reply.text || '').length > 80 ? '…' : ''}</span>
      </div>
      <button type="button" class="chat-reply-cancel" data-prefix="${key}" title="Cancel reply">&times;</button>
    </div>`;
  bar.classList.remove('hidden');
  bar.querySelector('.chat-reply-cancel')?.addEventListener('click', () => _clearChatReply(key));
}

function _deleteChatMessage(msgId) {
  if (!window.confirm('Delete this message?')) return;
  let db;
  try { db = firebase.firestore(); } catch { return; }
  db.collection(CHAT.COLLECTION).doc(msgId).delete()
    .catch(err => { showToast('Could not delete.', 'error'); console.error(err); });
}

function _chatScrollBottom(containerId) {
  requestAnimationFrame(() => {
    const el = document.getElementById(containerId);
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function _resetUnread() {
  CHAT.unreadCount = 0;
  _updateBadge();
}

function _updateBadge() {
  const badge = document.getElementById('chatBubbleBadge');
  if (!badge) return;
  if (CHAT.unreadCount > 0 && !CHAT.popupOpen && !CHAT.tabActive) {
    badge.textContent = CHAT.unreadCount > 99 ? '99+' : String(CHAT.unreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Room UI ──

function _initChatRoomsUI() {
  _chatActiveRoom();
  _renderRoomSelectors();
  _renderRoomChrome();
  _syncChatRoomControls();
}

function _renderRoomSelectors() {
  const options = CHAT.ROOMS.map(room =>
    `<option value="${esc(room.id)}">${room.icon} ${esc(room.label)}</option>`
  ).join('');

  ['chatTabRoomSelect', 'chatPopupRoomSelect'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.dataset.built) return;
    sel.innerHTML = options;
    sel.dataset.built = '1';
    sel.addEventListener('change', () => _switchChatRoom(sel.value));
  });

  const list = document.getElementById('chatRoomList');
  if (!list || list.dataset.built) return;
  list.innerHTML = CHAT.ROOMS.map(room => `
    <button class="chat-room-btn" type="button" data-room-id="${esc(room.id)}">
      <span class="chat-room-row">
        <span class="chat-room-name"><span>${room.icon}</span><span>${esc(room.label)}</span></span>
        <span class="chat-room-badges">
          <span class="chat-room-online" data-room-online="${esc(room.id)}">0</span>
          <span class="chat-room-count" data-room-count="${esc(room.id)}">0</span>
        </span>
      </span>
      <span class="chat-room-desc">${esc(room.desc)}</span>
    </button>
  `).join('');
  list.dataset.built = '1';
  list.querySelectorAll('.chat-room-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchChatRoom(btn.dataset.roomId));
  });
}

function _syncChatRoomControls() {
  const room = _chatActiveRoom();
  ['chatTabRoomSelect', 'chatPopupRoomSelect'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel && sel.value !== room.id) sel.value = room.id;
  });
  document.querySelectorAll('.chat-room-btn[data-room-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.roomId === room.id);
  });
  const hint = document.getElementById('chatPopupRoomHint');
  if (hint) hint.textContent = room.label;
}

function _renderRoomChrome() {
  const room = _chatActiveRoom();
  const meta = document.getElementById('chatActiveRoomMeta');
  if (meta) {
    meta.innerHTML = `
      <div class="chat-active-room-title"><span>${room.icon}</span><span>${esc(room.label)}</span></div>
      <div class="chat-active-room-desc">${esc(room.desc)} Older global chat messages remain in General.</div>
    `;
  }
  _syncChatRoomControls();
  _renderRoomCounts();
}

function _switchChatRoom(roomId) {
  const next = _chatRoomId(roomId);
  if (next === CHAT.activeRoomId) return;
  const prev = CHAT.activeRoomId;
  CHAT.activeRoomId = next;
  localStorage.setItem(CHAT.ROOM_KEY, next);
  _chatClearTyping();
  ['Tab', 'Popup'].forEach(prefix => _clearChatReply(prefix));
  _renderRoomChrome();
  _renderAllChatMessages();
  _renderTypingIndicators();
  _renderChatPinBanners();
  _renderOnlineMembers();
  _startRoomPresence(prev);
  _chatScrollBottom('chatTabMessages');
  if (CHAT.popupOpen) _chatScrollBottom('chatPopupMessages');
}

function _renderRoomCounts() {
  CHAT.ROOMS.forEach(room => {
    const msgEl = document.querySelector(`[data-room-count="${room.id}"]`);
    if (msgEl) msgEl.textContent = String(CHAT.roomCounts[room.id] || 0);
    const onlineEl = document.querySelector(`[data-room-online="${room.id}"]`);
    if (onlineEl) onlineEl.textContent = String(CHAT.onlineCounts[room.id] || 0);
  });
}

// ── Room Presence ──

function _chatPresenceMs(member) {
  const raw = member?.updatedAt || member?.lastSeen;
  if (raw?.toMillis) return raw.toMillis();
  if (raw?.seconds != null) return raw.seconds * 1000;
  if (raw) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

async function _chatWriteRoomPresence(roomId, online) {
  let db;
  try { db = firebase.firestore(); } catch { return; }
  const uid = _chatUID();
  const room = _chatRoomById(roomId || _chatActiveRoom().id);
  const docId = _chatRoomPresenceDocId(room.id, uid);
  try {
    await db.collection(CHAT.PRESENCE_COLLECTION).doc(docId).set({
      uid,
      email: _chatAuthEmail(),
      name: _chatName() || 'Anonymous',
      roomId: room.id,
      roomLabel: room.label,
      online: !!online,
      page: 'simulation',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (_) {}
}

function _startRoomPresence(previousRoomId) {
  let db;
  try { db = firebase.firestore(); } catch { return; }

  if (previousRoomId && previousRoomId !== _chatActiveRoom().id) {
    _chatWriteRoomPresence(previousRoomId, false);
  }
  if (CHAT.presenceUnsubscribe) CHAT.presenceUnsubscribe();
  if (CHAT.presenceTimer) clearInterval(CHAT.presenceTimer);

  _chatWriteRoomPresence(_chatActiveRoom().id, true);
  CHAT.presenceTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') {
      _chatWriteRoomPresence(_chatActiveRoom().id, true);
    }
  }, CHAT.PRESENCE_HEARTBEAT_MS);

  if (!CHAT.presenceUnloadBound) {
    CHAT.presenceUnloadBound = true;
    document.addEventListener('visibilitychange', () => {
      _chatWriteRoomPresence(_chatActiveRoom().id, document.visibilityState === 'visible');
    });
    window.addEventListener('beforeunload', () => {
      if (CHAT.presenceTimer) clearInterval(CHAT.presenceTimer);
      _chatWriteRoomPresence(_chatActiveRoom().id, false);
    });
  }

  CHAT.presenceUnsubscribe = db.collection(CHAT.PRESENCE_COLLECTION)
    .onSnapshot(snap => {
      const cutoff = Date.now() - CHAT.PRESENCE_TTL_MS;
      const onlineByRoom = {};
      const activeRoomId = _chatActiveRoom().id;
      const members = [];
      snap.docs.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        const roomId = _chatRoomId(d.roomId || 'general');
        const ts = _chatPresenceMs(d);
        if (!d.online || (ts && ts < cutoff)) return;
        onlineByRoom[roomId] = onlineByRoom[roomId] || new Map();
        onlineByRoom[roomId].set(d.uid || doc.id, d);
        if (roomId === activeRoomId) members.push(d);
      });
      CHAT.onlineCounts = Object.fromEntries(
        Object.entries(onlineByRoom).map(([roomId, map]) => [roomId, map.size])
      );
      CHAT.onlineMembers = members.sort((a, b) => {
        const ownA = a.uid === _chatUID() ? 0 : 1;
        const ownB = b.uid === _chatUID() ? 0 : 1;
        if (ownA !== ownB) return ownA - ownB;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      _renderRoomCounts();
      _renderOnlineMembers();
      _hydrateOnlineMemberProfiles();
    }, err => console.warn('Room presence listener error:', err));
}

async function _hydrateOnlineMemberProfiles() {
  const emails = [...new Set([
    ...CHAT.onlineMembers.map(m => String(m.email || '').toLowerCase().trim()),
    ...CHAT.messages.map(m => String(m.email || '').toLowerCase().trim()),
  ].filter(email => email && CHAT.memberProfiles[email] === undefined))];
  if (!emails.length) return;

  let db;
  try { db = firebase.firestore(); } catch { return; }

  await Promise.all(emails.slice(0, 20).map(async email => {
    try {
      const doc = await db.collection('user_profiles').doc(email).get();
      CHAT.memberProfiles[email] = doc.exists ? doc.data() : null;
    } catch (_) {
      CHAT.memberProfiles[email] = null;
    }
  }));
  _renderOnlineMembers();
  _renderAllChatMessages();
}

function _chatMemberProfile(member) {
  const email = String(member?.email || '').toLowerCase().trim();
  if (!email) return null;
  return CHAT.memberProfiles[email] || null;
}

function _chatProfileHasPublicInfo(profile) {
  return !!(profile?.isPublic && (profile.name || profile.specialty || profile.hospital || profile.profilePicBase64));
}

function _chatIsVerifiedProfile(profile) {
  return !!(profile?.applicantId || profile?.inducted || profile?.verified || profile?.isVerified);
}

function _chatIsContributor(email) {
  const key = String(email || '').toLowerCase().trim();
  return !!(key && typeof SIM !== 'undefined' && SIM.donor?.byEmail?.has(key));
}

function _chatTrustBadges(email, profile) {
  const badges = [];
  if (_chatIsVerifiedProfile(profile)) {
    badges.push('<span class="chat-trust-badge chat-trust-verified" title="Linked or verified profile">✓ Verified</span>');
  }
  if (_chatProfileHasPublicInfo(profile)) {
    badges.push('<span class="chat-trust-badge chat-trust-profile" title="Public MeritNama profile">Profile</span>');
  }
  if (_chatIsContributor(email)) {
    badges.push('<span class="chat-trust-badge chat-trust-contributor" title="MeritNama contributor">★ Contributor</span>');
  }
  return badges.join('');
}

function _chatProfileForEmail(email) {
  const key = String(email || '').toLowerCase().trim();
  if (!key) return null;
  return CHAT.memberProfiles[key] || null;
}

function _chatMemberInitial(name) {
  const clean = String(name || '?').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function _renderOnlineMembers() {
  const countEl = document.getElementById('chatOnlineCount');
  if (countEl) countEl.textContent = String(CHAT.onlineMembers.length);
  const list = document.getElementById('chatOnlineMembers');
  if (!list) return;
  if (!CHAT.onlineMembers.length) {
    list.innerHTML = `<div class="chat-member-empty">No one else is online in ${esc(_chatActiveRoom().label)} yet.</div>`;
    return;
  }

  list.innerHTML = CHAT.onlineMembers.map(member => {
    const profile = _chatMemberProfile(member);
    const email = String(member.email || '').toLowerCase().trim();
    const name = profile?.name || member.name || member.email || 'Anonymous';
    const isOwn = member.uid === _chatUID();
    const isTyping = CHAT.typingByUid.has(member.uid);
    const avatar = profile?.profilePicBase64
      ? `<img src="${profile.profilePicBase64}" alt="" />`
      : esc(_chatMemberInitial(name));
    const statusChip = profile?.inducted
      ? '<span class="chat-member-chip good">Inducted</span>'
      : '<span class="chat-member-chip">Applicant</span>';
    const publicProfileChip = _chatProfileHasPublicInfo(profile)
      ? '<span class="chat-member-chip">Profile</span>'
      : '';
    const contributorChip = _chatIsContributor(email)
      ? '<span class="chat-member-chip contributor">Contributor</span>'
      : '';
    const typingChip = isTyping
      ? '<span class="chat-member-chip typing">typing</span>'
      : '';
    const specialtyChip = profile?.specialty
      ? `<span class="chat-member-chip">${esc(profile.specialty)}</span>`
      : '';
    const hospitalChip = profile?.hospital
      ? `<span class="chat-member-chip">${esc(profile.hospital)}</span>`
      : '';
    return `
      <div class="chat-member-card${isTyping ? ' typing' : ''}">
        <div class="chat-member-avatar">${avatar}<span class="chat-member-dot"></span></div>
        <div class="chat-member-main">
          <div class="chat-member-name">${esc(name)}${isOwn ? ' (you)' : ''}</div>
          <div class="chat-member-meta">${_chatTrustBadges(email, profile)}${typingChip}${statusChip}${publicProfileChip}${contributorChip}${specialtyChip}${hospitalChip}</div>
        </div>
      </div>`;
  }).join('');
}
