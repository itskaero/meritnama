'use strict';

// ═══════════════════════════════════════════════════════
// JOBS — synced to Firestore, public Jobs tab + admin sync panel
// ═══════════════════════════════════════════════════════
//
// Two entry points:
//   • app.html Jobs tab           → initJobsTab()         — read-only live grid
//   • admin.html Jobs Sync panel  → initJobsSyncPanel()   — scrape & merge button
//
// Admin data sources:
//   • Live scrape — scrapes the source listing pages (via CORS proxy), parses
//                  each job-detail page, merges only new/changed docs.
//   • Snapshot    — reads a static JSON file dropped at data/jobs.json (produced
//                  by the Python `jobAggregator_enhanced` package). Mirror the
//                  Python output into meritnama/data/jobs.json and click
//                  "Sync from snapshot" in the admin panel. This is the
//                  reliable path when free CORS proxies are flaky.
//
// Both paths converge into the same idempotent Firestore merge: only docs whose
// fingerprint differs from the existing one are written, and jobs/_meta carries
// { count, lastSyncAt }.
//
// Public Jobs tab   ← Firestore `jobs` onSnapshot (live, read-only)

const JOBS = {
  COLLECTION: 'jobs',
  BASE_LISTING: 'https://www.jobz.pk/medical-employment{pageNo}/',
  DEFAULT_PAGES: 1,
  // Each proxy is { build(url) -> proxiedUrl, unwrap(text) -> unwrappedText }.
  // Proxies that return the raw body (`unwrap: r => r`) rely on the proxy
  // sending a permissive Access-Control-Allow-Origin header; the allorigins
  // `/get` variant returns the body wrapped in a JSON object (which allorigins
  // always serves with CORS headers) and is the most reliable fallback.
  CORS_PROXIES: [
    { build: u => 'https://api.allorigins.win/raw?url='   + encodeURIComponent(u), unwrap: r => r },
    { build: u => 'https://api.allorigins.win/get?url='   + encodeURIComponent(u), unwrap: r => {
        try { return JSON.parse(r).contents; } catch (_) { return null; }
      } },
    { build: u => 'https://corsproxy.io/?url='           + encodeURIComponent(u), unwrap: r => r },
    { build: u => 'https://thingproxy.freeboard.io/fetch/' + u,                    unwrap: r => r },
  ],
  SNAPSHOT_URL: 'data/jobs.json',
  list: [],            // current Firestore jobs (live)
  unsubscribe: null,
  meta: null,
  synced: false,
  filters: {
    vacancy: '',
    organization: '',
    city: '',
    status: 'all',
    search: '',
    onlyWithVacancies: false,
  },
  sort: { key: 'datePosted', dir: -1 },
};

// ── helpers ──────────────────────────────────────────────

function _jobsDb() {
  try { return firebase.firestore().collection(JOBS.COLLECTION); }
  catch (_) { return null; }
}

// Cheap, dependency-free string hash (djb-ish) — stable across browsers.
function _hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

// Fingerprint only the fields we consider "content". Ignore volatile
// bookkeeping (firstSeen/lastUpdated/fingerprint) and the raw dump.
function _jobFingerprint(j) {
  const sig = JSON.stringify({
    t: j.title || null,
    o: j.organization || null,
    i: j.industry || null,
    c: j.category || null,
    jt: j.jobType || null,
    np: j.newspaper || null,
    ed: (j.education || []).slice().sort(),
    a: j.area || null,
    loc: j.location || null,
    dp: j.datePosted || null,
    eld: j.expectedLastDateISO || null,
    io: j.isOpen === null ? 'u' : (j.isOpen ? '1' : '0'),
    ao: j.applyOnline || null,
    oa: j.onlineApplicants || null,
    img: j.image || null,
    v: (j.vacancies || []).slice().sort(),
  });
  return _hashString(sig);
}

// Derive a short city from the verbose "Vacancy Location" string
// e.g. "Bannu, Khyber Pakhtunkhwa KPK, Pakistan" -> "Bannu"
function _cityFromLocation(loc) {
  if (!loc) return '';
  return String(loc).split(',')[0].trim();
}

// ── in-browser scraper (port of python jobAggregator_enhanced) ──

const MONTHS = { january:0, february:1, march:2, april:3, may:4, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11 };

function _parseLastDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})\s+([A-Za-z]+)\s*,?\s*(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toLowerCase()];
  const yr  = parseInt(m[3], 10);
  if (mon == null || isNaN(day) || isNaN(yr)) return null;
  const d = new Date(Date.UTC(yr, mon, day));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _computeIsOpen(iso) {
  if (!iso) return null;
  const today = new Date(Date.now());
  const tY = today.getUTCFullYear(), tM = today.getUTCMonth(), tD = today.getUTCDate();
  const [y, m, d] = iso.split('-').map(Number);
  if (y > tY) return true;
  if (y < tY) return false;
  if (m - 1 > tM) return true;
  if (m - 1 < tM) return false;
  return d >= tD;
}

function _text(el) {
  if (!el) return null;
  return (el.textContent || '').replace(/\s+/g, ' ').trim() || null;
}

function _splitPipe(v) {
  if (!v) return [];
  return String(v).split('|').map(s => s.trim()).filter(Boolean);
}

const _KEY_MAP = {
  'Apply Online if applicable:': 'applyOnline',
  'Area / Town:': 'area',
  'Category / Sector:': 'category',
  'Date Posted / Updated:': 'datePosted',
  'Education:': 'education',
  'Expected Last Date:': 'expectedLastDate',
  'Job Industry:': 'industry',
  'Job Type:': 'jobType',
  'Newspaper:': 'newspaper',
  'Online Applicants:': 'onlineApplicants',
  'Organization:': 'organization',
  'Vacancy Location:': 'location',
};

async function _proxiedFetch(url) {
  let lastErr;
  for (const proxy of JOBS.CORS_PROXIES) {
    const proxied = proxy.build(url);
    try {
      const res = await fetch(proxied, { cache: 'no-store', redirect: 'follow' });
      // For CORS-blocked reads the browser throws — that goes to the catch.
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status + ' via proxy'); continue; }
      const rawText = await res.text();
      if (!rawText || rawText.length < 100) { lastErr = new Error('Empty proxy response'); continue; }
      const body = proxy.unwrap ? proxy.unwrap(rawText) : rawText;
      if (!body || body.length < 100) { lastErr = new Error('Empty unwrapped response'); continue; }
      // Reject Cloudflare/proxy error pages so we fall through to the next proxy
      // (allorigins sometimes 522s with a Cloudflare HTML page that has CORS *).
      if (/<title>Attention Required/i.test(body) ||
          /<title>.*Cloudflare/i.test(body) ||
          /cf-error-details/i.test(body)) {
        lastErr = new Error('Proxy returned a Cloudflare error page');
        continue;
      }
      return body;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All CORS proxies failed');
}

function _parseListingLinks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('div.row_container');
  const links = [];
  rows.forEach((row, i) => {
    if (i === 0) return; // first row is header
    const cell = row.querySelector('div.cell31');
    if (!cell) return;
    const a = cell.querySelector('a');
    const href = a && a.getAttribute('href');
    if (href) links.push(href);
  });
  return links;
}

function _extractJobId(url) {
  const m = String(url).match(/_jobs-(\d+)\.html/i);
  return m ? parseInt(m[1], 10) : null;
}

function _parseJobDetail(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('div.job_detail');
  if (!main) return null;

  const fields = {};
  main.querySelectorAll('div.row_job_detail').forEach(row => {
    const k = _text(row.querySelector('div.job_detail_cell1'));
    const v = _text(row.querySelector('div.job_detail_cell2'));
    if (k && v != null) fields[k] = v;
  });

  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = _KEY_MAP[k];
    if (!key) continue;
    out[key] = key === 'education' ? _splitPipe(v) : v;
  }

  let image = null;
  doc.querySelectorAll('a').forEach(a => {
    if (image) return;
    const href = a.getAttribute('href') || '';
    if (href.indexOf('jobz.pk/images/jobs/') !== -1) image = href;
  });

  const vacancies = [];
  doc.querySelectorAll('div.equal_4cols').forEach(ec => {
    if (vacancies.length) return;
    const h3 = ec.querySelector('h3');
    if (h3 && /vacancies in/i.test(h3.textContent || '')) {
      ec.querySelectorAll('div.one_cell').forEach(c => {
        const t = (c.textContent || '').trim();
        if (t) vacancies.push(t);
      });
    }
  });

  const titleTag = doc.querySelector('h1');
  const lastISO = _parseLastDate(out.expectedLastDate);
  return {
    id:          _extractJobId(url),
    sourceUrl:   url,
    title:       _text(titleTag),
    organization: out.organization || null,
    industry:    out.industry || null,
    category:    out.category || null,
    jobType:     out.jobType || null,
    newspaper:   out.newspaper || null,
    education:   out.education || [],
    area:        out.area || null,
    location:    out.location || null,
    datePosted:  out.datePosted || null,
    expectedLastDate:    out.expectedLastDate || null,
    expectedLastDateISO: lastISO,
    isOpen:      _computeIsOpen(lastISO),
    applyOnline: out.applyOnline || null,
    onlineApplicants: out.onlineApplicants || null,
    image:       image,
    vacancies:   vacancies,
    city:        _cityFromLocation(out.location),
  };
}

async function _scrapeAll(numPages, onProgress) {
  const allLinks = [];
  const seen = new Set();
  for (let p = 1; p <= numPages; p++) {
    const pageNo = p === 1 ? '' : p;
    const url = JOBS.BASE_LISTING.replace('{pageNo}', pageNo);
    if (onProgress) onProgress({ phase: 'listing', page: p, total: numPages, url });
    let html;
    try { html = await _proxiedFetch(url); }
    catch (e) { if (onProgress) onProgress({ phase: 'listing', page: p, url, error: e.message }); continue; }
    const links = _parseListingLinks(html);
    links.forEach(l => { if (!seen.has(l)) { seen.add(l); allLinks.push(l); } });
    if (p < numPages) await new Promise(r => setTimeout(r, 300));
  }

  const jobs = [];
  for (let i = 0; i < allLinks.length; i++) {
    const url = allLinks[i];
    if (onProgress) onProgress({ phase: 'detail', index: i + 1, total: allLinks.length, url });
    let html;
    try { html = await _proxiedFetch(url); }
    catch (e) { if (onProgress) onProgress({ phase: 'detail', index: i + 1, url, error: e.message }); continue; }
    const job = _parseJobDetail(html, url);
    if (job) jobs.push(job);
    await new Promise(r => setTimeout(r, 250));
  }
  return jobs;
}

// ── live subscription ───────────────────────────────────

function initJobsTab() {
  const tab = document.getElementById('tab-jobs');
  if (!tab) return;
  _bindJobsFilters();
  if (!JOBS.unsubscribe) _subscribeJobs();

  // Job detail modal close
  const closeBtn = document.getElementById('jobDetailClose');
  if (closeBtn) closeBtn.addEventListener('click', _closeJobModal);
  const overlay = document.getElementById('jobDetailModal');
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === this) _closeJobModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') _closeJobModal();
  });
}

/* Admin-side entry point — binds the Scrape&sync button inside admin.html
   (no UI to render live cards; this panel lives in the dashboard). */
function initJobsSyncPanel() {
  if (!document.getElementById('jobsSyncBtn') && !document.getElementById('jobsSnapBtn')) return;
  _bindJobsSyncButton();
  _bindJobsSnapButton();
  _refreshJobsMetaPill();
}

function _subscribeJobs() {
  const col = _jobsDb();
  if (!col) { _setJobsStatus('Firestore unavailable — showing nothing live.'); return; }
  JOBS.unsubscribe = col.onSnapshot(snap => {
    const jobs = [];
    snap.forEach(d => {
      if (d.id === '_meta') return;       // skip metadata doc
      const data = d.data();
      if (data && data.id != null) jobs.push(data);
    });
    // Sort deterministically by datePosted desc, then id
    jobs.sort((a, b) => {
      const ka = a.sortKey || a.datePosted || '';
      const kb = b.sortKey || b.datePosted || '';
      if (ka === kb) return (b.id || 0) - (a.id || 0);
      return kb < ka ? -1 : 1;
    });
    JOBS.list = jobs;
    JOBS.synced = true;
    // Pull meta if present
    col.doc('_meta').get().then(m => {
      JOBS.meta = m.exists ? m.data() : null;
      _renderJobsCounts();
      renderJobsGrid();
    }).catch(() => renderJobsGrid());
  }, err => {
    console.warn('[jobs] subscription error', err);
    _setJobsStatus('Could not reach Firestore: ' + (err && err.message || err));
  });
}

// ── shared Firestore merge ────────────────────────────────
// Both the live-scrape path and the snapshot-sync path end here. Returns the
// number of docs that were actually written (0 means the database was already
// in sync with the supplied payload).

async function _mergeJobsIntoFirestore(scrapedJobs, statusFn) {
  const col = _jobsDb();
  if (!col) { statusFn('Firestore unavailable — cannot sync.'); return -1; }

  statusFn('Comparing ' + scrapedJobs.length + ' jobs to database…');
  const existing = new Map();
  try {
    const snap = await col.get();
    snap.forEach(d => { if (d.id !== '_meta') existing.set(d.id, d.data() || {}); });
  } catch (e) {
    statusFn('Could not read Firestore: ' + e.message);
    return -1;
  }

  const toWrite = [];
  for (const nj of scrapedJobs) {
    if (nj.id == null) continue;
    const docId = String(nj.id);
    const prev = existing.get(docId) || {};
    const fingerprint = _jobFingerprint(nj);
    if (prev.fingerprint === fingerprint) continue;
    nj.fingerprint = fingerprint;
    nj.firstSeen   = prev.firstSeen || firebase.firestore.FieldValue.serverTimestamp();
    nj.lastUpdated = firebase.firestore.FieldValue.serverTimestamp();
    toWrite.push({ id: docId, data: nj });
  }

  if (toWrite.length) {
    statusFn('Writing ' + toWrite.length + ' new/changed job' + (toWrite.length === 1 ? '' : 's') + '…');
    const batch = firebase.firestore().batch();
    for (const w of toWrite) batch.set(col.doc(w.id), w.data, { merge: true });
    try { await batch.commit(); }
    catch (e) { statusFn('Write failed: ' + e.message); return -1; }
  }

  try {
    const snap2 = await col.get();
    const count = snap2.size - (snap2.docs.some(d => d.id === '_meta') ? 1 : 0);
    await col.doc('_meta').set({
      count,
      lastSyncAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (_) {}

  _refreshJobsMetaPill();
  statusFn('Merged ' + scrapedJobs.length + ' · ' + toWrite.length + ' new/changed' +
           (scrapedJobs.length - toWrite.length ? ' · ' + (scrapedJobs.length - toWrite.length) + ' unchanged' : '') +
           '.');
  return toWrite.length;
}

// ── live scrape → merge into Firestore ───────────────────

async function syncJobsFromSource() {
  if (!_jobsDb()) { _setJobsStatus('Firestore unavailable — cannot sync.'); return false; }

  const btn = document.getElementById('jobsSyncBtn');
  const pagesInput = document.getElementById('jobsPages');
  const numPages = Math.max(1, Math.min(5, parseInt((pagesInput && pagesInput.value) || JOBS.DEFAULT_PAGES, 10) || JOBS.DEFAULT_PAGES));
  if (btn) { btn.disabled = true; btn.textContent = 'Scraping…'; }

  let errors = 0;
  _setJobsStatus('Scraping listing page 1/' + numPages + '…');

  const sourceJobs = await _scrapeAll(numPages, ev => {
    if (ev.phase === 'listing') {
      if (ev.error) { errors++; _setJobsStatus('Listing ' + ev.page + '/' + ev.total + ' failed: ' + ev.error); }
      else          _setJobsStatus('Scraping listing ' + ev.page + '/' + ev.total + '…');
    } else if (ev.phase === 'detail') {
      if (ev.error) errors++;
      else          _setJobsStatus('Fetching job ' + ev.index + '/' + ev.total + '…');
    }
  });

  if (!sourceJobs.length) {
    _setJobsStatus('Live scrape failed (' + errors + ' error' + (errors === 1 ? '' : 's') +
                   '). The public CORS proxies may be down or rate-limiting — use “Sync from snapshot” instead.');
    if (btn) { btn.disabled = false; btn.textContent = 'Scrape & sync'; }
    return false;
  }

  const result = await _mergeJobsIntoFirestore(sourceJobs, _setJobsStatus);
  if (btn) { btn.disabled = false; btn.textContent = 'Scrape & sync'; }
  return result >= 0;
}

// ── snapshot sync → merge into Firestore ──────────────────
// Reads data/jobs.json (the mirror of the Python `jobAggregator_enhanced`
// output) and merges it into Firestore using the same fingerprint approach.
// Reliable fallback path when public CORS proxies are flaky.

function _normalizeSnapshotJob(job) {
  job = job || {};
  const out = {
    id:         job.id != null ? job.id : null,
    sourceUrl:  job.url || job.sourceUrl || null,
    title:      job.title || null,
    organization: job.organization || null,
    industry:   job.industry || null,
    category:   job.category || null,
    jobType:    job.jobType || null,
    newspaper:  job.newspaper || null,
    education:  Array.isArray(job.education) ? job.education : [],
    area:       job.area || null,
    location:   job.location || null,
    datePosted: job.datePosted || null,
    expectedLastDate:    job.expectedLastDate || null,
    expectedLastDateISO: job.expectedLastDateISO || null,
    isOpen:     job.isOpen === undefined ? null : job.isOpen,
    applyOnline: job.applyOnline || null,
    onlineApplicants: job.onlineApplicants || null,
    image:      job.image || null,
    vacancies:  Array.isArray(job.vacancies) ? job.vacancies : [],
  };
  // Missing/from-stale snapshots won’t always recomputed expectedLastDateISO.
  // Re-derive it from the raw text to stay current, without mutating the file.
  if (!out.expectedLastDateISO && out.expectedLastDate) {
    out.expectedLastDateISO = _parseLastDate(out.expectedLastDate);
    if (out.expectedLastDateISO) out.isOpen = _computeIsOpen(out.expectedLastDateISO);
  } else if (out.expectedLastDateISO && out.isOpen == null) {
    out.isOpen = _computeIsOpen(out.expectedLastDateISO);
  }
  out.city = _cityFromLocation(out.location);
  return out;
}

async function syncJobsFromSnapshot() {
  if (!_jobsDb()) { _setJobsStatus('Firestore unavailable — cannot sync.'); return false; }

  const btn = document.getElementById('jobsSnapBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  _setJobsStatus('Fetching snapshot ' + JOBS.SNAPSHOT_URL + '…');

  let payload;
  try {
    const res = await fetch(JOBS.SNAPSHOT_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    payload = await res.json();
  } catch (e) {
    _setJobsStatus('Snapshot fetch failed: ' + e.message +
      '. Run the Python `jobAggregator_enhanced` so it mirrors to meritnama/data/jobs.json first.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sync from snapshot'; }
    return false;
  }

  const rawJobs = Array.isArray(payload) ? payload
                : (payload && Array.isArray(payload.jobs)) ? payload.jobs
                : null;
  if (!rawJobs || !rawJobs.length) {
    _setJobsStatus('Snapshot empty — no jobs found inside ' + JOBS.SNAPSHOT_URL + '.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sync from snapshot'; }
    return false;
  }

  const normalized = rawJobs.map(_normalizeSnapshotJob).filter(j => j.id != null);
  if (!normalized.length) {
    _setJobsStatus('Snapshot had ' + rawJobs.length + ' rows but none had a valid job id.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sync from snapshot'; }
    return false;
  }

  const result = await _mergeJobsIntoFirestore(normalized, _setJobsStatus);
  if (btn) { btn.disabled = false; btn.textContent = 'Sync from snapshot'; }
  return result >= 0;
}

function _bindJobsSyncButton() {
  if (!document.getElementById('jobsSyncBtn')) return;
  const btn = document.getElementById('jobsSyncBtn');
  if (btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => { syncJobsFromSource(); });
}

function _bindJobsSnapButton() {
  if (!document.getElementById('jobsSnapBtn')) return;
  const btn = document.getElementById('jobsSnapBtn');
  if (btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => { syncJobsFromSnapshot(); });
}

// ── filters ──────────────────────────────────────────────

function _bindJobsFilters() {
  const ids = ['jobsVacancySel', 'jobsOrgSel', 'jobsCitySel',
               'jobsStatusSel', 'jobsSearch', 'jobsOnlyVacChk'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound) continue;
    el.dataset.bound = '1';
    el.addEventListener('input',  () => { _readJobsFilters(); renderJobsGrid(); });
    el.addEventListener('change', () => { _readJobsFilters(); renderJobsGrid(); });
  }
}

function _readJobsFilters() {
  JOBS.filters.vacancy           = (document.getElementById('jobsVacancySel') || {}).value || '';
  JOBS.filters.organization      = (document.getElementById('jobsOrgSel')   || {}).value || '';
  JOBS.filters.city              = (document.getElementById('jobsCitySel')  || {}).value || '';
  JOBS.filters.status            = (document.getElementById('jobsStatusSel')|| {}).value || 'all';
  JOBS.filters.search            = ((document.getElementById('jobsSearch')  || {}).value || '').toLowerCase().trim();
  JOBS.filters.onlyWithVacancies = !!(document.getElementById('jobsOnlyVacChk') || {}).checked;
}

function _uniqueVacancies(jobs) {
  const s = new Set();
  for (const j of jobs) (j.vacancies || []).forEach(v => v && s.add(v));
  return [...s].sort((a, b) => a.localeCompare(b));
}
function _uniqueOrgs(jobs)     { return [...new Set(jobs.map(j => j.organization).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function _uniqueCities(jobs)   { return [...new Set(jobs.map(j => j.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

function _populateJobsFilterDropdowns() {
  const jobs = JOBS.list;
  const vacSel  = document.getElementById('jobsVacancySel');
  const orgSel  = document.getElementById('jobsOrgSel');
  const citySel = document.getElementById('jobsCitySel');
  if (vacSel)  populateSelect(vacSel,  _uniqueVacancies(jobs), 'All vacancies');
  if (orgSel)  populateSelect(orgSel,  _uniqueOrgs(jobs),     'All organizations');
  if (citySel) populateSelect(citySel, _uniqueCities(jobs),   'All cities');
}

// ── render ───────────────────────────────────────────────

function _filterJobs() {
  const f = JOBS.filters;
  return JOBS.list.filter(j => {
    if (f.vacancy && !(j.vacancies || []).includes(f.vacancy)) return false;
    if (f.organization && j.organization !== f.organization) return false;
    if (f.city && j.city !== f.city) return false;
    if (f.onlyWithVacancies && !(j.vacancies || []).length) return false;
    if (f.status === 'open'    && j.isOpen !== true)  return false;
    if (f.status === 'closed'  && j.isOpen !== false) return false;
    if (f.status === 'unknown' && j.isOpen !== null)  return false;
    if (f.search) {
      const hay = [j.title, j.organization, j.location, j.industry, j.area,
                   (j.vacancies || []).join(' '), (j.education || []).join(' ')]
                  .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

function _statusBadge(j) {
  if (j.isOpen === true)  return '<span class="job-status job-status-open" title="' + esc(j.expectedLastDateISO || '') + '">● Open</span>';
  if (j.isOpen === false) return '<span class="job-status job-status-closed">● Closed</span>';
  return '<span class="job-status job-status-unknown" title="No deadline found">● Deadline N/A</span>';
}

function _vacancyChips(j) {
  const v = j.vacancies || [];
  if (!v.length) return '';
  return '<div class="job-chips">' +
    v.map(x => '<span class="job-chip job-chip-vac">' + esc(x) + '</span>').join('') +
    '</div>';
}

function _jobsEmptyHtml(msg) {
  return '<div class="jobs-empty">' + esc(msg || 'No jobs match these filters.') + '</div>';
}

function _renderJobsStatsRow(jobs) {
  const row = document.getElementById('jobsStatsRow');
  if (!row) return;
  const open    = jobs.filter(j => j.isOpen === true).length;
  const closed  = jobs.filter(j => j.isOpen === false).length;
  const unknown = jobs.filter(j => j.isOpen === null || j.isOpen === undefined).length;
  const orgs    = new Set(jobs.map(j => j.organization).filter(Boolean)).size;
  const cities  = new Set(jobs.map(j => j.city).filter(Boolean)).size;
  const vacs    = new Set(); jobs.forEach(j => (j.vacancies || []).forEach(v => v && vacs.add(v)));
  row.innerHTML =
    '<div class="jobs-stat"><span class="jobs-stat-val jobs-stat-total">' + jobs.length + '</span><span class="jobs-stat-lbl">Total postings</span></div>' +
    '<div class="jobs-stat"><span class="jobs-stat-val jobs-stat-open">'  + open   + '</span><span class="jobs-stat-lbl">Open</span></div>' +
    '<div class="jobs-stat"><span class="jobs-stat-val jobs-stat-closed">' + closed + '</span><span class="jobs-stat-lbl">Closed</span></div>' +
    (unknown ? '<div class="jobs-stat"><span class="jobs-stat-val jobs-stat-unknown">' + unknown + '</span><span class="jobs-stat-lbl">Deadline N/A</span></div>' : '') +
    '<div class="jobs-stat"><span class="jobs-stat-val">' + orgs   + '</span><span class="jobs-stat-lbl">Organizations</span></div>' +
    '<div class="jobs-stat"><span class="jobs-stat-val">' + cities + '</span><span class="jobs-stat-lbl">Cities</span></div>' +
    '<div class="jobs-stat"><span class="jobs-stat-val">' + vacs.size + '</span><span class="jobs-stat-lbl">Distinct roles</span></div>';
}

function renderJobsGrid() {
  const grid   = document.getElementById('jobsGrid');
  const count  = document.getElementById('jobsCount');
  if (!grid) return;

  if (!JOBS.synced) {
    grid.innerHTML = _jobsEmptyHtml('Loading jobs…');
    if (count) count.textContent = '…';
    return;
  }
  if (!JOBS.list.length) {
    _renderJobsStatsRow([]);
    grid.innerHTML = _jobsEmptyHtml('No jobs available yet. Check back shortly.');
    if (count) count.textContent = '0 jobs';
    _populateJobsFilterDropdowns();
    return;
  }

  _renderJobsStatsRow(JOBS.list);
  _populateJobsFilterDropdowns();
  const rows = _filterJobs();
  if (count) count.textContent = rows.length + (rows.length === 1 ? ' job' : ' jobs') + ' shown';

  if (!rows.length) { grid.innerHTML = _jobsEmptyHtml(); return; }

  grid.innerHTML = rows.map(j => {
    const img = j.image
      ? '<a class="job-thumb" href="' + esc(j.sourceUrl || j.image) + '" target="_blank" rel="noopener" tabindex="-1"><img loading="lazy" src="' + esc(j.image) + '" alt="' + esc(j.title || '') + '"></a>'
      : '<div class="job-thumb job-thumb-ph">' + (j.organization ? esc(j.organization.charAt(0).toUpperCase()) : '&#129658;') + '</div>';
    const loc    = j.city    ? '<span class="job-loc">&#128205; ' + esc(j.city) + '</span>' : '';
    const org    = j.organization ? '<span class="job-org">' + esc(j.organization) + '</span>' : '';
    const edu    = (j.education && j.education.length)
      ? '<div class="job-chips">' + j.education.map(e => '<span class="job-chip job-chip-edu">' + esc(e) + '</span>').join('') + '</div>'
      : '';
    const jtype  = j.jobType ? '<span class="job-chip job-chip-type">' + esc(j.jobType) + '</span>' : '';
    const date   = j.datePosted ? '<span class="job-date">Posted ' + esc(j.datePosted) + '</span>' : '';
    const lastDt = j.expectedLastDate
      ? '<span class="job-lastdate" title="' + esc(j.expectedLastDateISO || '') + '">&#9201; Apply by ' + esc(j.expectedLastDate) + '</span>'
      : '';
    const apply  = '<button class="job-apply job-view-details" data-job-id="' + esc(j.id) + '">View details</button>';
    return '' +
      '<article class="job-card" data-id="' + esc(j.id) + '">' +
        img +
        '<div class="job-body">' +
          '<div class="job-badge-row">' + _statusBadge(j) + jtype + '</div>' +
          '<h3 class="job-title">' + esc(j.title || 'Untitled role') + '</h3>' +
          (org || loc ? '<div class="job-meta-row">' + org + loc + '</div>' : '') +
          edu +
          _vacancyChips(j) +
          (date || lastDt ? '<div class="job-dates">' + date + lastDt + '</div>' : '') +
          apply +
        '</div>' +
      '</article>';
  }).join('');
  _bindJobViewButtons();
}

function _timeLeft(iso) {
  if (!iso) return '';
  const now = new Date();
  const tY = now.getUTCFullYear(), tM = now.getUTCMonth(), tD = now.getUTCDate();
  const today = new Date(Date.UTC(tY, tM, tD));
  const [y, m, d] = iso.split('-').map(Number);
  const deadline = new Date(Date.UTC(y, m, d));
  const diff = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return '<span style="color:#e05470">Closed ' + Math.abs(diff) + ' days ago</span>';
  if (diff === 0) return '<span style="color:#50e070">Closing today</span>';
  if (diff === 1) return '<span style="color:#50e070">1 day left</span>';
  return '<span style="color:#50e070">' + diff + ' days left</span>';
}

function _openJobModal(j) {
  const overlay = document.getElementById('jobDetailModal');
  const body = document.getElementById('jobDetailBody');
  if (!overlay || !body) return;

  const img = j.image
    ? '<img src="' + esc(j.image) + '" alt="' + esc(j.title || '') + '" style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;margin-bottom:1rem;background:var(--bg-card)" />'
    : '<div style="width:100%;height:160px;display:flex;align-items:center;justify-content:center;background:var(--bg-card);border-radius:8px;margin-bottom:1rem;color:var(--text-muted);font-size:2rem;">&#128188;</div>';

  const timeHtml = j.expectedLastDateISO
    ? '<div style="margin-bottom:0.75rem;">' + _timeLeft(j.expectedLastDateISO) + '</div>'
    : '';

  const org = j.organization
    ? '<p style="margin:4px 0"><strong>Organization:</strong> ' + esc(j.organization) + '</p>'
    : '';
  const loc = j.city
    ? '<p style="margin:4px 0"><strong>Location:</strong> ' + esc(j.city) + '</p>'
    : '';
  const date = j.datePosted
    ? '<p style="margin:4px 0"><strong>Posted:</strong> ' + esc(j.datePosted) + '</p>'
    : '';
  const lastDate = j.expectedLastDate
    ? '<p style="margin:4px 0"><strong>Apply by:</strong> ' + esc(j.expectedLastDate) + '</p>'
    : '';
  const edu = (j.education && j.education.length)
    ? '<p style="margin:4px 0"><strong>Education:</strong> ' + j.education.map(e => esc(e)).join(', ') + '</p>'
    : '';
  const vac = (j.vacancies && j.vacancies.length)
    ? '<p style="margin:4px 0"><strong>Vacancies:</strong> ' + j.vacancies.join(', ') + '</p>'
    : '';
  const type = j.jobType
    ? '<p style="margin:4px 0"><strong>Type:</strong> ' + esc(j.jobType) + '</p>'
    : '';
  const src = j.sourceUrl
    ? '<p style="margin:12px 0 0"><a href="' + esc(j.sourceUrl) + '" target="_blank" rel="noopener" style="color:var(--neon-cyan)">Open original posting &#8599;</a></p>'
    : '';

  body.innerHTML =
    img +
    '<h3 style="margin:0 0 0.75rem">' + esc(j.title || 'Untitled role') + '</h3>' +
    timeHtml +
    '<div style="font-size:0.88rem;color:var(--text-muted)">' +
      org + loc + date + lastDate + edu + vac + type + src +
    '</div>';

  overlay.style.display = 'flex';
}

function _closeJobModal() {
  const overlay = document.getElementById('jobDetailModal');
  if (overlay) overlay.style.display = 'none';
}

function _bindJobViewButtons() {
  document.querySelectorAll('.job-view-details').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.jobId;
      const j = JOBS.list.find(item => String(item.id) === String(id));
      if (j) _openJobModal(j);
    });
  });
}

function _renderJobsCounts() {
  const metaEl = document.getElementById('jobsMeta');
  if (metaEl && JOBS.meta && JOBS.meta.lastSyncAt) {
    const ts = JOBS.meta.lastSyncAt.toDate ? JOBS.meta.lastSyncAt.toDate() : new Date(JOBS.meta.lastSyncAt);
    metaEl.textContent = (JOBS.meta.count || JOBS.list.length) + ' jobs · last sync ' + ts.toLocaleString();
  } else if (metaEl && JOBS.synced) {
    metaEl.textContent = (JOBS.list.length || 0) + ' jobs in database';
  }
}

function _refreshJobsMetaPill() {
  const col = _jobsDb();
  if (!col) return;
  col.doc('_meta').get().then(m => {
    JOBS.meta = m.exists ? m.data() : null;
    _renderJobsCounts();
  }).catch(() => {});
}

function _setJobsStatus(msg) {
  const el = document.getElementById('jobsStatus');
  if (el) el.textContent = msg;
}

// Auto-init whichever entry point is present on the page.
// On app.html → initJobsTab() renders the live public grid.
// On admin.html → initJobsSyncPanel() wires the admin sync button.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initJobsTab();
    initJobsSyncPanel();
  });
} else {
  initJobsTab();
  initJobsSyncPanel();
}