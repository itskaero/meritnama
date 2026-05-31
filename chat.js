'use strict';
// ═══════════════════════════════════════════════════════
// Community Chat — Real-time Firestore-powered chatbox
// Collection: chat_messages
// Fields: name, email, text, timestamp, reactions, replyTo
// ═══════════════════════════════════════════════════════

(function () {
  const MESSAGES_LIMIT = 80;
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏'];

  let db;
  let messagesUnsubscribe = null;
  let replyingTo = null; // { id, name, text }
  let allMessages = [];  // { _id, ...data }

  // ── Helpers ──────────────────────────────────────────
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(date) {
    if (!date) return '';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60)        return 'just now';
    if (diff < 3600)      return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)     return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  }

  function formatDate(date) {
    if (!date) return '';
    const today = new Date();
    const d = new Date(date);
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function avatarInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }

  function getSessionEmail() {
    try {
      const raw = localStorage.getItem('meritnama_auth_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && typeof s.email === 'string') ? s.email : null;
    } catch (e) { return null; }
  }

  function getChatName() {
    const input = document.getElementById('chatNameInput');
    const name = (input && input.value.trim()) || '';
    if (name) localStorage.setItem('meritnama_chat_name', name);
    return name || localStorage.getItem('meritnama_chat_name') || 'Anonymous';
  }

  // ── Profile cache for tags ──────────────────────────
  const profileCache = {};

  async function getUserProfile(email) {
    if (!email) return null;
    if (profileCache[email] !== undefined) return profileCache[email];
    try {
      const doc = await db.collection('user_profiles').doc(email).get();
      profileCache[email] = doc.exists ? doc.data() : null;
    } catch (e) {
      profileCache[email] = null;
    }
    return profileCache[email];
  }

  // ── Render tags for a user ──────────────────────────
  function renderUserTags(profile) {
    if (!profile) return '';
    let html = '';
    if (profile.specialty) {
      html += `<span class="chat-msg-tag chat-msg-tag-spec">${esc(profile.specialty)}</span>`;
    }
    if (profile.year) {
      html += `<span class="chat-msg-tag chat-msg-tag-year">${esc(profile.year)}</span>`;
    }
    if (profile.hospital) {
      html += `<span class="chat-msg-tag chat-msg-tag-hosp">${esc(profile.hospital)}</span>`;
    }
    return html;
  }

  // ── Render reactions ────────────────────────────────
  function renderReactions(msgId, reactions) {
    if (!reactions || Object.keys(reactions).length === 0) return '';
    const email = getSessionEmail() || getChatName();
    let html = '<div class="chat-msg-reactions">';
    for (const [emoji, users] of Object.entries(reactions)) {
      if (!users || !Array.isArray(users) || users.length === 0) continue;
      const isActive = users.includes(email);
      html += `<button class="chat-reaction-btn${isActive ? ' active' : ''}" data-msgid="${esc(msgId)}" data-emoji="${esc(emoji)}">
        <span>${emoji}</span><span class="reaction-count">${users.length}</span>
      </button>`;
    }
    html += '</div>';
    return html;
  }

  // ── Build a single message ──────────────────────────
  function buildMessage(msg) {
    const dateStr = msg.timestamp ? timeAgo(msg.timestamp.toDate()) : '';
    const initials = avatarInitials(msg.name);
    const tags = msg._profile ? renderUserTags(msg._profile) : '';
    const reactions = renderReactions(msg._id, msg.reactions);

    // Reply indicator
    let replyHtml = '';
    if (msg.replyTo && msg.replyTo.name) {
      replyHtml = `
        <div class="chat-msg-reply-indicator" data-reply-target="${esc(msg.replyTo.id || '')}">
          <span>↩ <strong>${esc(msg.replyTo.name)}</strong></span>
          <span class="reply-preview">${esc((msg.replyTo.text || '').substring(0, 80))}</span>
        </div>`;
    }

    return `
      <div class="chat-msg" data-msgid="${esc(msg._id)}">
        <div class="chat-msg-avatar">${esc(initials)}</div>
        <div class="chat-msg-content">
          ${replyHtml}
          <div class="chat-msg-meta">
            <span class="chat-msg-name">${esc(msg.name || 'Anonymous')}</span>
            ${tags}
            <span class="chat-msg-time">${dateStr}</span>
          </div>
          <div class="chat-msg-text">${esc(msg.text)}</div>
          ${reactions}
        </div>
        <div class="chat-msg-actions">
          <button class="chat-action-btn" data-action="react" data-msgid="${esc(msg._id)}" title="React">😊</button>
          <button class="chat-action-btn" data-action="reply" data-msgid="${esc(msg._id)}" title="Reply">↩</button>
        </div>
      </div>`;
  }

  // ── Render all messages ─────────────────────────────
  function renderMessages() {
    const container = document.getElementById('chatMessages');
    if (allMessages.length === 0) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <p>No messages yet &mdash; start the conversation!</p>
        </div>`;
      return;
    }

    let html = '';
    let lastDate = '';

    for (const msg of allMessages) {
      // Date separator
      if (msg.timestamp) {
        const msgDate = formatDate(msg.timestamp.toDate());
        if (msgDate !== lastDate) {
          lastDate = msgDate;
          html += `<div class="chat-date-sep"><span>${esc(msgDate)}</span></div>`;
        }
      }
      html += buildMessage(msg);
    }

    container.innerHTML = html;
    scrollToBottom();
    attachMessageListeners();
  }

  function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  // ── Attach click listeners ──────────────────────────
  function attachMessageListeners() {
    const container = document.getElementById('chatMessages');

    // Reaction buttons
    container.querySelectorAll('.chat-reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleReaction(btn.dataset.msgid, btn.dataset.emoji);
      });
    });

    // Action buttons (react / reply)
    container.querySelectorAll('.chat-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const msgId = btn.dataset.msgid;
        if (action === 'reply') startReply(msgId);
        if (action === 'react') showEmojiPicker(btn, msgId);
      });
    });
  }

  // ── Emoji picker ────────────────────────────────────
  let activeEmojiPicker = null;

  function showEmojiPicker(anchorBtn, msgId) {
    closeEmojiPicker();
    const picker = document.createElement('div');
    picker.className = 'emoji-picker-popover';
    picker.innerHTML = REACTION_EMOJIS.map(e =>
      `<button data-emoji="${e}" data-msgid="${esc(msgId)}">${e}</button>`
    ).join('');
    anchorBtn.parentElement.appendChild(picker);
    activeEmojiPicker = picker;

    picker.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleReaction(btn.dataset.msgid, btn.dataset.emoji);
        closeEmojiPicker();
      });
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeEmojiPicker, { once: true });
    }, 10);
  }

  function closeEmojiPicker() {
    if (activeEmojiPicker) {
      activeEmojiPicker.remove();
      activeEmojiPicker = null;
    }
  }

  // ── Toggle reaction ─────────────────────────────────
  async function toggleReaction(msgId, emoji) {
    const userId = getSessionEmail() || getChatName();
    const msgRef = db.collection('chat_messages').doc(msgId);

    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(msgRef);
        if (!doc.exists) return;

        const data = doc.data();
        const reactions = data.reactions || {};
        const users = reactions[emoji] || [];

        if (users.includes(userId)) {
          // Remove reaction
          reactions[emoji] = users.filter(u => u !== userId);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          // Add reaction
          reactions[emoji] = [...users, userId];
        }

        transaction.update(msgRef, { reactions });
      });
    } catch (err) {
      console.error('Reaction error:', err);
    }
  }

  // ── Reply ───────────────────────────────────────────
  function startReply(msgId) {
    const msg = allMessages.find(m => m._id === msgId);
    if (!msg) return;

    replyingTo = {
      id: msgId,
      name: msg.name || 'Anonymous',
      text: (msg.text || '').substring(0, 100)
    };

    const preview = document.getElementById('chatReplyPreview');
    document.getElementById('replyToName').textContent = replyingTo.name;
    document.getElementById('replyToText').textContent = replyingTo.text;
    preview.classList.add('active');

    document.getElementById('chatInput').focus();
  }

  function cancelReply() {
    replyingTo = null;
    document.getElementById('chatReplyPreview').classList.remove('active');
  }

  // ── Send message ────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim().substring(0, 1500);
    if (!text) return;

    const name = getChatName();
    const email = getSessionEmail() || '';

    const btn = document.getElementById('chatSendBtn');
    btn.disabled = true;
    input.value = '';
    updateSendBtn();

    const msgData = {
      name,
      email,
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      reactions: {},
    };

    if (replyingTo) {
      msgData.replyTo = {
        id: replyingTo.id,
        name: replyingTo.name,
        text: replyingTo.text.substring(0, 100),
      };
    }

    cancelReply();

    try {
      await db.collection('chat_messages').add(msgData);
    } catch (err) {
      console.error('Send message error:', err);
      input.value = text; // Restore on failure
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  // ── Subscribe to messages (real-time) ───────────────
  function subscribeMessages() {
    if (messagesUnsubscribe) messagesUnsubscribe();

    messagesUnsubscribe = db.collection('chat_messages')
      .orderBy('timestamp', 'asc')
      .limitToLast(MESSAGES_LIMIT)
      .onSnapshot(async (snap) => {
        const messages = [];
        snap.forEach(doc => messages.push({ _id: doc.id, ...doc.data() }));

        // Fetch profiles for messages with email
        const emails = [...new Set(messages.filter(m => m.email).map(m => m.email))];
        await Promise.all(emails.map(e => getUserProfile(e)));

        // Attach profile data
        messages.forEach(m => {
          if (m.email && profileCache[m.email]) {
            m._profile = profileCache[m.email];
          }
        });

        allMessages = messages;
        renderMessages();
      }, err => {
        console.error('Messages snapshot error:', err);
        document.getElementById('chatMessages').innerHTML =
          '<div class="chat-empty"><div class="chat-empty-icon">⚠️</div><p>Failed to load messages. Please refresh.</p></div>';
      });
  }

  // ── Auto-resize textarea ────────────────────────────
  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function updateSendBtn() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    btn.disabled = !input.value.trim();
  }

  // ── Initialize ──────────────────────────────────────
  function init() {
    if (!window.firebase || !firebase.firestore) { setTimeout(init, 100); return; }
    db = firebase.firestore();

    // Restore saved name
    const savedName = localStorage.getItem('meritnama_chat_name');
    const nameInput = document.getElementById('chatNameInput');
    if (savedName && nameInput) nameInput.value = savedName;

    // Auto-fill from profile
    const email = getSessionEmail();
    if (email) {
      getUserProfile(email).then(profile => {
        if (profile && profile.name && nameInput && !nameInput.value) {
          nameInput.value = profile.name;
          localStorage.setItem('meritnama_chat_name', profile.name);
        }
      });
    }

    // Save name on change
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim();
      if (name) localStorage.setItem('meritnama_chat_name', name);
    });

    // Chat input
    const chatInput = document.getElementById('chatInput');
    chatInput.addEventListener('input', () => {
      autoResize(chatInput);
      updateSendBtn();
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Send button
    document.getElementById('chatSendBtn').addEventListener('click', sendMessage);

    // Cancel reply
    document.getElementById('chatReplyCancel').addEventListener('click', cancelReply);

    // Subscribe to messages
    subscribeMessages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
