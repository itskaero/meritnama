const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CAND_PATH = path.join(DATA_DIR, 'induction21_candidates.json');
const REV_PATH = path.join(DATA_DIR, 'induction21_revisions.json');
const COMP_PATH = path.join(DATA_DIR, 'induction21_components.json');
const CERT_PATH = path.join(DATA_DIR, 'induction21_certificates.json');
const OUT_PATH = path.join(DATA_DIR, 'induction21_candidates.json');

const FIELDS_TO_REMOVE = [
  'degree', 'houseJob', 'experience', 'research', 'position', 'hardAreas',
  'matric', 'fsc', 'attempts', 'mdcat',
];
const FIELDS_TO_KEEP = [
  'applicantId', 'nameFull', 'emailId', 'pmdcNo', 'preference',
  'programMarks', 'programAttempt', 'programPercentage', 'applied_in',
  'adjusted', 'scrutiny', 'marksExplanation', 'marksTotal',
  'certificates',
];

function main() {
  console.log('Reading candidates...');
  const raw = fs.readFileSync(CAND_PATH, 'utf-8');
  const candidates = JSON.parse(raw);
  const ids = Object.keys(candidates);
  console.log(`Total candidates: ${ids.length}`);

  // Extract revisions
  const revisions = {};
  let revisionCount = 0;
  let revisionCandidateCount = 0;
  for (const id of ids) {
    const c = candidates[id];
    if (c.revisions && typeof c.revisions === 'object') {
      const revKeys = Object.keys(c.revisions).filter(k => c.revisions[k] && typeof c.revisions[k] === 'object');
      if (revKeys.length > 0) {
        revisions[id] = c.revisions;
        revisionCandidateCount++;
        revisionCount += revKeys.length;
      }
    }
  }
  console.log(`Candidates with revisions: ${revisionCandidateCount}`);
  console.log(`Total revision entries: ${revisionCount}`);

  // Write revisions file
  fs.writeFileSync(REV_PATH, JSON.stringify(revisions, null, 2));
  console.log(`Written: ${REV_PATH}`);

  // Create stripped candidates
  const stripped = {};
  for (const id of ids) {
    const c = candidates[id];
    const out = {};
    for (const key of FIELDS_TO_KEEP) {
      if (Object.prototype.hasOwnProperty.call(c, key)) {
        out[key] = c[key];
      }
    }
    stripped[id] = out;
  }
  console.log(`Stripped entries: ${Object.keys(stripped).length}`);

  // Verify components data matches
  console.log('\nVerifying components...');
  if (fs.existsSync(COMP_PATH)) {
    const compRaw = fs.readFileSync(COMP_PATH, 'utf-8');
    const comps = JSON.parse(compRaw);
    const compIds = Object.keys(comps);
    console.log(`Components entries: ${compIds.length}`);
    const missing = ids.filter(id => !compIds.includes(id));
    if (missing.length > 0) {
      console.log(`WARNING: ${missing.length} candidates missing from components`);
    } else {
      console.log('All candidates have component data ✓');
    }
  }

  // Verify certificates data
  console.log('\nVerifying certificates...');
  if (fs.existsSync(CERT_PATH)) {
    const certRaw = fs.readFileSync(CERT_PATH, 'utf-8');
    const certs = JSON.parse(certRaw);
    const certIds = Object.keys(certs);
    console.log(`Certificates entries: ${certIds.length}`);
  }

  // Write stripped candidates (backup original first)
  const backupPath = CAND_PATH.replace('.json', '_backup.json');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(CAND_PATH, backupPath);
    console.log(`Backup saved: ${backupPath}`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(stripped, null, 2));
  console.log(`Written stripped candidates: ${OUT_PATH}`);

  console.log('\nDone!');
}

main();
