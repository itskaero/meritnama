'use strict';

if (typeof firebase !== 'undefined') {
  window.db = window.db || firebase.firestore();
}

/**
 * MeritNama SPA — Community views.
 * Handles Discussion Forums and Credentials Access Request.
 */

// ═══════════════════════════════════════════════════════
// DYNAMIC SCRIPT LOADERS
// ═══════════════════════════════════════════════════════

let _discussionScriptsPromise = null;
function loadDiscussionScripts() {
  if (_discussionScriptsPromise) return _discussionScriptsPromise;
  _discussionScriptsPromise = (async () => {
    if (!document.querySelector('script[src="reviews.js"]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'reviews.js';
        script.onload = () => {
          // Trigger fake DOMContentLoaded for reviews.js IIFE registration
          document.dispatchEvent(new Event('DOMContentLoaded'));
          resolve();
        };
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  })();
  return _discussionScriptsPromise;
}

let _requestAccessPromise = null;
function loadRequestAccessScripts() {
  if (_requestAccessPromise) return _requestAccessPromise;
  _requestAccessPromise = (async () => {
    if (!document.querySelector('script[src="access-request.js"]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'access-request.js';
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }
  })();
  return _requestAccessPromise;
}

// ═══════════════════════════════════════════════════════
// VIEW: DISCUSSION & SUB-FORUMS
// ═══════════════════════════════════════════════════════

async function renderDiscussion(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Community Forums…</p>
    </div>
  `;

  try {
    await loadDiscussionScripts();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg);">
        <h2>Community Discussions</h2>
        <p>Connect with peers, check training ratings, and participate in competitive specialty threads.</p>
      </div>

      <div class="rv-panel card" id="forumPanel" style="padding:0; overflow:hidden;">
        <!-- Dynamic Panel Header -->
        <div class="rv-panel-header" id="forumPanelHeader" style="display:flex; align-items:center; gap:10px; padding:16px 24px; border-bottom:1px solid var(--border-default); background:var(--surface-secondary);">
          <span style="font-size:16px;"><i class="ph ph-chat-circle"></i></span>
          <h3 id="forumPanelTitle" style="margin:0; font-size:15px; font-weight:700;">Community Forum</h3>
          <span class="badge badge-info" id="threadCount" style="margin-left:auto;">0 threads</span>
          <button class="btn btn-primary" id="forumNewBtn" style="padding:4px 10px; font-size:12px;">+ New Thread</button>
        </div>

        <div class="rv-panel-body" id="forumBody" style="padding:24px;">
          <!-- VIEW A: Threads List -->
          <div id="forumViewList">
            <!-- Category Filter Chips -->
            <div class="forum-category-chips" id="forumCategoryFilter" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px;">
              <button class="badge active" data-cat="" style="cursor:pointer; border:none; padding:4px 12px; background:var(--brand-primary); color:#fff;">All</button>
              <button class="badge badge-secondary" data-cat="General" style="cursor:pointer; border:none; padding:4px 12px;">General</button>
              <button class="badge badge-secondary" data-cat="Question" style="cursor:pointer; border:none; padding:4px 12px;">Q&amp;A</button>
              <button class="badge badge-secondary" data-cat="Study" style="cursor:pointer; border:none; padding:4px 12px;">Study</button>
              <button class="badge badge-secondary" data-cat="Hospital" style="cursor:pointer; border:none; padding:4px 12px;">Hospital</button>
              <button class="badge badge-secondary" data-cat="Merit" style="cursor:pointer; border:none; padding:4px 12px;">Merit</button>
              <button class="badge badge-secondary" data-cat="Experience" style="cursor:pointer; border:none; padding:4px 12px;">Story</button>
              <button class="badge badge-secondary" data-cat="Concern" style="cursor:pointer; border:none; padding:4px 12px;">Concern</button>
            </div>

            <!-- List container -->
            <div id="threadList" class="thread-list" style="display:flex; flex-direction:column; gap:12px;">
              <div style="text-align:center; padding:40px; color:var(--text-muted);">Loading threads list…</div>
            </div>

            <button class="btn btn-secondary" id="threadLoadMore" style="width:100%; margin-top:16px; display:none;">Load more threads</button>
          </div>

          <!-- VIEW B: New Thread Form -->
          <div id="forumViewNew" style="display:none;">
            <button class="btn btn-secondary" id="forumBackFromNew" style="margin-bottom:16px; padding:6px 12px; font-size:12px;"><i class="ph ph-arrow-left"></i> Back to threads</button>
            <div class="input-grid" style="display:grid; grid-template-columns:1fr; gap:12px;">
              <div class="form-group">
                <label for="threadName">Your Name / Alias</label>
                <input type="text" id="threadName" class="input" placeholder="Dr. Anonymous" maxlength="60" />
              </div>
              <div class="form-group">
                <label for="threadCategory">Category</label>
                <select id="threadCategory" class="select">
                  <option value="General">General Discussion</option>
                  <option value="Question">Question &amp; Advice</option>
                  <option value="Study">Study Tips &amp; FCPS</option>
                  <option value="Hospital">Hospital Insights</option>
                  <option value="Merit">Merit &amp; Induction</option>
                  <option value="Experience">Experience Share</option>
                  <option value="Concern">Concern</option>
                </select>
              </div>
              <div class="form-group">
                <label for="threadYear">Training Year (optional)</label>
                <select id="threadYear" class="select">
                  <option value="">Any / Not Applicable</option>
                  <option value="Aspirant">Aspirant (pre-induction)</option>
                  <option value="R1">R1 — Year 1</option>
                  <option value="R2">R2 — Year 2</option>
                  <option value="R3">R3 — Year 3</option>
                  <option value="R4">R4 — Year 4</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div class="form-group">
                <label for="threadSpecialty">Specialty (optional)</label>
                <input type="text" id="threadSpecialty" class="input" placeholder="E.g. Surgery" list="specialtyList" />
                <datalist id="specialtyList"></datalist>
                <datalist id="hospitalList"></datalist>
              </div>
              <div class="form-group">
                <label for="threadTitle">Thread Title</label>
                <input type="text" id="threadTitle" class="input" placeholder="A clear title for your post…" maxlength="120" />
                <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="threadTitleCount">0</span>/120</div>
              </div>
              <div class="form-group">
                <label for="threadBody">Description</label>
                <textarea id="threadBody" class="input" rows="5" placeholder="Describe your topic in detail…" maxlength="3000"></textarea>
                <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="threadBodyCount">0</span>/3000</div>
              </div>
            </div>
            <button class="btn btn-primary" id="threadSubmitBtn" style="margin-top:16px; width:100%;">Post Thread</button>
            <div id="threadStatus" style="font-size:12.5px; text-align:center; min-height:1.2em; margin-top:8px;"></div>
          </div>

          <!-- VIEW C: Thread Detail & Replies -->
          <div id="forumViewDetail" style="display:none;">
            <button class="btn btn-secondary" id="forumBackFromDetail" style="margin-bottom:16px; padding:6px 12px; font-size:12px;"><i class="ph ph-arrow-left"></i> Back to threads</button>
            <div id="threadDetailCard" class="card" style="margin-bottom:24px; border-color:var(--brand-primary); background:var(--brand-light);"></div>
            <div class="thread-comments-section">
              <div class="thread-comments-header" id="commentCountLabel" style="font-weight:700; font-size:14px; margin-bottom:12px;">0 replies</div>
              <div id="commentsList" style="display:flex; flex-direction:column; gap:12px; margin-bottom:24px;"></div>
              <!-- Reply Form -->
              <div class="card" style="background:var(--surface-secondary);">
                <h4 style="margin:0 0 12px;">Reply to Thread</h4>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <div class="form-group">
                    <label for="commentName">Your Name / Alias</label>
                    <input type="text" id="commentName" class="input" placeholder="Dr. Anonymous" maxlength="60" />
                  </div>
                  <div class="form-group">
                    <label for="commentText">Your message</label>
                    <textarea id="commentText" class="input" rows="3" placeholder="Share your insights or answer the query…" maxlength="1500"></textarea>
                    <div style="text-align:right; font-size:11px; color:var(--text-tertiary); margin-top:2px;"><span id="commentCharCount">0</span>/1500</div>
                  </div>
                  <button class="btn btn-primary" id="commentSubmitBtn">Post Reply</button>
                  <div id="commentStatus" style="font-size:12.5px; text-align:center; min-height:1.2em;"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Re-trigger event binds inside reviews.js
    if (typeof window.initForumView === 'function') {
      window.initForumView();
    }
  } catch (err) {
    console.error('[Forums View] Initialization failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to load Discussions scripts.</p></div>`;
  }
}

// ═══════════════════════════════════════════════════════
// VIEW: CREDENTIALS ACCESS REQUEST
// ═══════════════════════════════════════════════════════

async function renderRequestAccess(container) {
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:40vh; gap: var(--spacing-md);">
      <div class="skeleton-shimmer" style="width: 52px; height: 52px; border-radius: 50%; border: 3px solid var(--border-default); border-top-color: var(--brand-primary); animation: spin 0.8s linear infinite;"></div>
      <p style="color:var(--text-secondary); font-size:14px;">Loading Verification gate…</p>
    </div>
  `;

  try {
    await loadRequestAccessScripts();

    container.innerHTML = `
      <div class="section-header" style="margin-bottom: var(--spacing-lg);">
        <h2>Request Verification credentials</h2>
        <p>Submit details to request account access or manually upload supporting tokens.</p>
      </div>

      <div class="grid grid-2" style="gap: var(--spacing-lg); align-items: flex-start;">
        <!-- Form card -->
        <div class="card">
          <h3>Verification Request</h3>
          <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;" class="req-access-form">
            <div class="form-group">
              <label for="reqEmail">Registered Email</label>
              <input type="email" id="reqEmail" class="input" placeholder="dr.doe@example.com" />
            </div>
            <div class="form-group">
              <label for="reqId">Applicant ID</label>
              <input type="number" id="reqId" class="input" placeholder="E.g. 35183" />
            </div>
            <p id="reqPrev" style="font-size:13px; color:var(--brand-primary); font-weight:600; min-height:1.2em; margin:0;"></p>

            <div id="reqPay" style="margin-top:8px;"></div>

            <button class="btn btn-primary" id="reqSubmitBtn" style="margin-top:12px; width:100%;">Submit Verification Request</button>
            <div id="reqError" style="font-size:12.5px; text-align:center; color:var(--color-reach); min-height:1.2em; margin-top:8px;"></div>
            <div id="reqSuccess" style="display:none; font-size:12.5px; text-align:center; color:var(--color-safe); min-height:1.2em; margin-top:8px;"></div>
          </div>
        </div>

        <!-- Support Info panel -->
        <div class="card" id="proofPanel">
          <h3>Submit Contribution Proof</h3>
          <p style="font-size:13px; color:var(--text-secondary); margin-bottom: var(--spacing-md);">If you made a bank/RAAST transfer, enter your email and attach payment proof receipt.</p>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label for="proofEmailStandalone">Account Email</label>
              <input type="email" id="proofEmailStandalone" class="input" placeholder="dr.doe@example.com" />
            </div>
            <div class="form-group">
              <label for="proofMessageStandalone">Reference Message (optional)</label>
              <textarea id="proofMessageStandalone" class="input" rows="2" placeholder="E.g. ref #10029381…"></textarea>
            </div>
            <div class="form-group">
              <label>Receipt Screenshot</label>
              <input type="file" id="proofPhotoStandalone" accept="image/*" class="input" style="padding:4px 10px;" />
              <div id="proofPhotoPreviewStandalone" style="display:none; margin-top:8px;"></div>
            </div>
            <button class="btn btn-secondary" id="proofSubmitStandalone">Upload Proof</button>
            <div id="proofErrorStandalone" style="font-size:12px; text-align:center; color:var(--color-reach); min-height:1.2em; margin-top:6px;"></div>
            <div id="proofSuccessStandalone" style="display:none; font-size:12px; text-align:center; color:var(--color-safe); min-height:1.2em; margin-top:6px;"></div>
          </div>
        </div>
      </div>
    `;

    // Hook listeners
    const reqEmail = document.getElementById('reqEmail');
    const reqId = document.getElementById('reqId');
    const reqPrev = document.getElementById('reqPrev');
    const reqPay = document.getElementById('reqPay');
    const reqBtn = document.getElementById('reqSubmitBtn');
    const reqErr = document.getElementById('reqError');
    const reqOk = document.getElementById('reqSuccess');

    let verifyTimer = null;
    const AR = window.MNAccessRequest;
    let accessConfig = null;

    AR.loadAccessConfig(db).then((cfg) => {
      accessConfig = cfg;
      reqPay.innerHTML = AR.renderPaymentBlock(cfg, '');
    });

    async function runVerify() {
      reqPrev.textContent = '';
      if (!reqEmail.value.trim() || !reqId.value.trim()) return;
      try {
        const result = await AR.verifyCandidate(reqEmail.value, reqId.value);
        if (result.ok) {
          reqPrev.innerHTML = `✓ Matched: <strong>${result.nameFull || result.email}</strong><br>Applicant ID: <strong>${result.applicantId}</strong>`;
          if (accessConfig) {
            reqPay.innerHTML = AR.renderPaymentBlock(accessConfig, result.applicantId);
          }
        }
      } catch (e) {}
    }

    function scheduleVerify() {
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(runVerify, 400);
    }

    reqEmail.addEventListener('input', scheduleVerify);
    reqId.addEventListener('input', scheduleVerify);

    // Binds proof uploader receipt
    const proofPhoto = document.getElementById('proofPhotoStandalone');
    const proofPreview = document.getElementById('proofPhotoPreviewStandalone');
    let proofBase64 = '';

    proofPhoto.addEventListener('change', () => {
      const file = proofPhoto.files[0];
      if (!file) {
        proofPreview.style.display = 'none';
        proofBase64 = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        proofBase64 = e.target.result;
        proofPreview.style.display = 'block';
        proofPreview.innerHTML = `<img src="${proofBase64}" style="max-width:100%; max-height:160px; display:block; border-radius:6px;" alt="Receipt proof" />`;
      };
      reader.readAsDataURL(file);
    });

    // Upload proof button
    const proofBtn = document.getElementById('proofSubmitStandalone');
    const proofErr = document.getElementById('proofErrorStandalone');
    const proofOk = document.getElementById('proofSuccessStandalone');
    const proofEmail = document.getElementById('proofEmailStandalone');
    const proofMsg = document.getElementById('proofMessageStandalone');

    proofBtn.addEventListener('click', async () => {
      proofErr.textContent = '';
      proofOk.style.display = 'none';
      const email = proofEmail.value.trim().toLowerCase();
      if (!email) {
        proofErr.textContent = 'Enter email used for request.';
        return;
      }
      proofBtn.disabled = true;
      proofBtn.textContent = 'Uploading…';

      try {
        const result = await AR.submitPaymentProof(db, email, proofBase64, proofMsg.value);
        if (!result.ok) {
          proofErr.textContent = result.error || 'Failed to submit.';
          return;
        }
        proofOk.style.display = 'block';
        proofOk.textContent = 'Payment proof receipt uploaded!';
        proofBtn.textContent = 'Uploaded';
        proofPhoto.value = '';
        proofBase64 = '';
        proofPreview.style.display = 'none';
        proofMsg.value = '';
      } catch(e) {
        proofErr.textContent = 'Upload failed. Try again.';
      } finally {
        if (proofBtn.textContent === 'Uploading…') {
          proofBtn.disabled = false;
          proofBtn.textContent = 'Upload Proof';
        }
      }
    });

    // Submit request button
    reqBtn.addEventListener('click', async () => {
      reqErr.textContent = '';
      reqOk.style.display = 'none';
      reqBtn.disabled = true;
      reqBtn.textContent = 'Submitting…';

      try {
        const result = await AR.submitAccessRequest(db, {
          email: reqEmail.value,
          applicantId: reqId.value,
          paymentDeclared: !!document.getElementById('authPayDeclared')?.checked,
          paymentAmountPKR: document.getElementById('authPayAmountPKR')?.value || '',
          paymentReference: document.getElementById('authPayRef')?.value || '',
          message: document.getElementById('authMsg')?.value || ''
        });

        if (!result.ok) {
          reqErr.textContent = result.error || 'Request failed.';
          reqBtn.disabled = false;
          reqBtn.textContent = 'Submit Request';
          return;
        }

        reqOk.style.display = 'block';
        reqOk.innerHTML = `Request submitted! Admin will verify and email credentials.`;
        reqBtn.textContent = 'Submitted';
      } catch(e) {
        reqErr.textContent = 'Submission failed. Try again.';
        reqBtn.disabled = false;
        reqBtn.textContent = 'Submit Request';
      }
    });

  } catch(err) {
    console.error('[Request Access View] Load failure:', err);
    container.innerHTML = `<div class="card" style="border-color:var(--color-reach); padding:24px; text-align:center;"><p style="color:var(--color-reach);">Failed to load Verification module.</p></div>`;
  }
}

// Expose renderers globally
window.renderDiscussion = renderDiscussion;
window.renderRequestAccess = renderRequestAccess;
