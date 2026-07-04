'use strict';

if (typeof firebase !== 'undefined') {
  window.db = window.db || firebase.firestore();
}

/**
 * MeritNama SPA — Donations & Supporter views.
 * Handles the support contribution page and QR code generation.
 */

// ═══════════════════════════════════════════════════════
// DYNAMIC LOADER
// ═══════════════════════════════════════════════════════

async function loadQrCodeScript() {
  if (window.QRCode) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

// ═══════════════════════════════════════════════════════
// VIEW: SUPPORT & DONATIONS
// ═══════════════════════════════════════════════════════

async function renderDonate(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Support Portal…</p>
    </div>
  `;

  try {
    await loadQrCodeScript();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg); text-align:center;">
        <span class="badge badge-info" style="margin-bottom:8px;">Open Source &middot; No Ads &middot; Community Funded</span>
        <h2>Keep MeritNama Running</h2>
        <p>Supporters keep live merit lists, simulations, and diagnostic tools online for everyone.</p>
      </div>

      <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start; margin-bottom: var(--spacing-lg);">
        <!-- Banking details -->
        <div class="card">
          <h3>Support Contribution Details</h3>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom: var(--spacing-md);">Running VMs and scraping proxies to bypass endpoints rate-limits requires resources. Use the banking details below to contribute.</p>

          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; border-bottom:1px solid var(--border-default); padding-bottom:8px;">
              <span>Bank Name</span>
              <strong>Mashreq Bank Pakistan</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; border-bottom:1px solid var(--border-default); padding-bottom:8px;">
              <span>Account Number</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <code style="font-family:var(--font-mono); font-weight:700;">0891-2007-4774</code>
                <button class="btn btn-ghost" style="padding:2px;" onclick="navigator.clipboard.writeText('089120074774')"><i class="ph ph-copy"></i></button>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
              <span>RAAST ID</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <code style="font-family:var(--font-mono); font-weight:700;">03046774774</code>
                <button class="btn btn-ghost" style="padding:2px;" onclick="navigator.clipboard.writeText('03046774774')"><i class="ph ph-copy"></i></button>
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:center; margin-top:24px;" id="qrcode"></div>
        </div>

        <!-- Supporters Card Grid -->
        <div class="card" style="padding: var(--spacing-md);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-default); padding-bottom:8px; margin-bottom:12px;">
            <h3 style="margin:0;">★ MeritNama Supporters</h3>
            <span class="badge badge-info" id="totalContributed">PKR 0</span>
          </div>
          <div id="contributorsGrid" style="display:flex; flex-direction:column; gap:8px; max-height:350px; overflow-y:auto; padding-right:6px;">
            <p style="color:var(--text-muted); font-size:12.5px; text-align:center; padding:20px;">Loading contributors list…</p>
          </div>
        </div>
      </div>
    `;

    // Load QR
    if (window.QRCode) {
      new window.QRCode(document.getElementById('qrcode'), {
        text: '089120074774',
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }

    // Load Contributors list from Firestore
    loadDonationsList();

  } catch (err) {
    console.error('[Donate View] Load error:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to initialize support page.</p></div>`;
  }
}

async function loadDonationsList() {
  const grid = document.getElementById('contributorsGrid');
  const totalVal = document.getElementById('totalContributed');
  if (!grid) return;

  try {
    const snap = await db.collection('contributions').orderBy('date', 'desc').limit(40).get();
    if (snap.empty) {
      grid.innerHTML = `<p style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px;">No contributions logged yet. Be the first!</p>`;
      return;
    }

    let totalPKR = 0;
    grid.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      totalPKR += d.amountPKR || 0;
      const name = d.name || 'Anonymous';
      const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
      const date = d.date ? d.date.toDate().toLocaleDateString() : '';

      return `
        <div class="card" style="display:flex; align-items:center; gap: var(--spacing-sm); padding: 8px 12px; border-color:var(--border-subtle); background:var(--surface-secondary);">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--brand-primary); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px;">${initials}</div>
          <div>
            <div style="font-weight:600; font-size:13px;">${name}</div>
            <div style="font-size:11.5px; color:var(--text-tertiary);">PKR ${d.amountPKR?.toLocaleString() || '—'} &middot; ${date}</div>
          </div>
        </div>
      `;
    }).join('');

    if (totalVal) {
      totalVal.textContent = `PKR ${totalPKR.toLocaleString()}`;
    }
  } catch (err) {
    console.error('Failed to load contributions:', err);
    grid.innerHTML = `<p style="color:var(--color-reach); font-size:12.5px; text-align:center;">Failed to load contributors.</p>`;
  }
}

// Expose renderers globally
window.renderDonate = renderDonate;
