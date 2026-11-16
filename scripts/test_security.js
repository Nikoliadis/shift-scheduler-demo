// ==================== TESTS ΑΣΦΑΛΕΙΑΣ (15/11/2026) ====================
//
// Regression suite για τις διορθώσεις της Ομάδας Β του security audit.
// ΧΩΡΙΣ πραγματική βάση: σηκώνει τον ΠΡΑΓΜΑΤΙΚΟ server (src/server.js) με
// in-memory pool και MemoryStore για τα sessions, και χτυπά τα endpoints με
// HTTP — όπως ένας επιτιθέμενος από browser ή curl.
//
// Καλύπτει:
//   Β1/Β2  Δικαίωμα επεξεργασίας agents σε ΟΛΑ τα endpoints εγγραφής
//   Β3     Αναγέννηση session id στο login (session fixation)
//   Β4     Το Excel ΔΕΝ παράγει τύπους από ονόματα εργαζομένων
//   Β5     Καμία διαρροή εσωτερικών σφαλμάτων· τα 4xx διατηρούνται
//   Β6     /api/health: ελάχιστη δημόσια απόκριση, λεπτομέρειες μόνο σε admin
//   +      Κεφαλίδες ασφαλείας, φράγμα admin panel, 401 σε προστατευμένα API
//
// Χρήση: node scripts/test_security.js
const path = require('path');
const bcrypt = require('bcryptjs');

let fail = 0;
let pass = 0;
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}
const t = (name, got, want, d) => ta(`${name}`, got === want, d || `πήρα ${JSON.stringify(got)}, περίμενα ${JSON.stringify(want)}`);

// ══════════════════════════════════════════════════════════════════
// In-memory δεδομένα
// ══════════════════════════════════════════════════════════════════
const PW = 'test-password-1234';
const HASH = bcrypt.hashSync(PW, 4); // χαμηλό cost ΜΟΝΟ για ταχύτητα στα tests

const DB = {
  users: [
    { id: 1, username: 'adminuser', password_hash: HASH, display_name: 'Διαχειριστής', is_admin: 1, can_edit_agents: 1 },
    { id: 2, username: 'editor', password_hash: HASH, display_name: 'Επεξεργαστής', is_admin: 0, can_edit_agents: 1 },
    { id: 3, username: 'viewer', password_hash: HASH, display_name: 'Θεατής', is_admin: 0, can_edit_agents: 0 }
  ],
  agents: [{ id: 10, full_name: 'ΔΟΚΙΜΗ ΑΛΦΑ', active: 1 }]
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
let lastWrite = null;        // τι πέρασε στη βάση (για έλεγχο ότι ΔΕΝ γράφτηκε)
let throwOnNextQuery = null; // για το test διαρροής σφαλμάτων
const AUDIT = [];            // in-memory ημερολόγιο ασφαλείας

async function query(sql, params = []) {
  const s = norm(sql);
  if (throwOnNextQuery) {
    const e = new Error(throwOnNextQuery);
    throwOnNextQuery = null;
    throw e;
  }
  if (/^SELECT 1$/.test(s)) return [[{ 1: 1 }], []];
  if (/FROM users WHERE username = \?/.test(s)) {
    const u = DB.users.find((x) => x.username === params[0]);
    return [u ? [u] : [], []];
  }
  // ---- ημερολόγιο ασφαλείας ----
  if (/^INSERT INTO audit_log/.test(s)) {
    const [actor_user_id, actor_name, action, target_type, target_id, success, ip, details] = params;
    AUDIT.push({ id: AUDIT.length + 1, actor_user_id, actor_name, action, target_type,
      target_id, success, ip, details, created_at: new Date() });
    return [{ insertId: AUDIT.length, affectedRows: 1 }, []];
  }
  if (/FROM audit_log WHERE action = \? AND target_type = 'username'/.test(s)) {
    // recentFailures: αποτυχίες μετά την τελευταία επιτυχία
    const [act, uname] = params;
    const lastOk = AUDIT.filter((r) => r.action === 'LOGIN_SUCCESS' && r.target_id === uname).pop();
    const since = lastOk ? lastOk.id : 0;
    return [[{ n: AUDIT.filter((r) => r.action === act && r.target_id === uname && r.id > since).length }], []];
  }
  if (/^SELECT COUNT\(\*\) AS n FROM audit_log/.test(s)) return [[{ n: AUDIT.length }], []];
  if (/FROM audit_log/.test(s)) return [AUDIT.slice().reverse().slice(0, 100), []];

  if (/^SELECT COUNT\(\*\) AS n FROM/.test(s)) return [[{ n: 7 }], []];
  if (/^INSERT INTO agents/.test(s)) { lastWrite = 'INSERT agents'; return [{ insertId: 99, affectedRows: 1 }, []]; }
  if (/^UPDATE agents SET active/.test(s)) { lastWrite = 'UPDATE active'; return [{ affectedRows: 1 }, []]; }
  if (/^UPDATE agents SET/.test(s)) { lastWrite = 'UPDATE agents'; return [{ affectedRows: 1 }, []]; }
  if (/FROM agents/.test(s)) return [DB.agents, []];
  if (/FROM (skills|roles|agent_skills|agent_constraints|shift_requirements|shift_eligibility|time_off|schedules|sessions|shift_wishes)/.test(s)) return [[], []];
  if (/^(DELETE|INSERT|UPDATE|CREATE|SET|START|COMMIT|ROLLBACK)/i.test(s)) return [{ affectedRows: 0 }, []];
  return [[], []];
}
const conn = { query, release() {}, async beginTransaction() {}, async commit() {}, async rollback() {} };
const fakePool = { query, async getConnection() { return conn; }, async end() {} };

// ---- Έγχυση fake pool ----
const poolPath = require.resolve('../src/db/pool');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };

// ---- Έγχυση MemoryStore αντί για MySQLStore (κρατά τον ΙΔΙΟ κώδικα server) ----
const session = require('express-session');
const emsPath = require.resolve('express-mysql-session');
require.cache[emsPath] = {
  id: emsPath, filename: emsPath, loaded: true,
  exports: () => session.MemoryStore
};

// ---- Σήκωμα του ΠΡΑΓΜΑΤΙΚΟΥ server σε τυχαία θύρα ----
process.env.PORT = '0';
delete process.env.NODE_ENV;           // όχι production → cookie χωρίς secure, ώστε να δουλεύει σε http
process.env.SESSION_SECRET = 'test-only-secret-not-used-in-production';

const { server } = require('../src/server');

// Το server.js κάνει listen μόνο του σε θύρα 0 (τυχαία) — περιμένουμε να δεθεί
function waitForPort() {
  return new Promise((resolve) => {
    const tick = () => {
      const a = server && server.address();
      if (a && a.port) return resolve(a.port);
      setTimeout(tick, 20);
    };
    tick();
  });
}

let PORT = 0;
async function call(method, p, { body, cookie, headers } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers || {})
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* δεν είναι JSON */ }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, raw, headers: res.headers, setCookie: sc };
}

// Μοναδική IP ανά κλήση: απομονώνει το κλείδωμα ΛΟΓΑΡΙΑΣΜΟΥ από το
// rate limit ανά IP. Με trust proxy = 1 ο Express διαβάζει το X-Forwarded-For.
let ipSeq = 0;
const freshIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };

const sidOf = (setCookie) => {
  const m = /programa_vardion_sid=([^;]+)/.exec(setCookie || '');
  return m ? m[1] : null;
};

async function login(username) {
  const r = await call('POST', '/api/login', {
    body: { username, password: PW }, headers: { 'X-Forwarded-For': freshIp() }
  });
  return { ...r, cookie: (r.setCookie || '').split(';')[0] };
}

(async () => {
  PORT = await waitForPort();

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 1. ΑΥΘΕΝΤΙΚΟΠΟΙΗΣΗ ==========');
  {
    const bad = await call('POST', '/api/login', {
      body: { username: 'adminuser', password: 'λάθος' }, headers: { 'X-Forwarded-For': freshIp() } });
    t('λάθος κωδικός → 401', bad.status, 401);
    const nouser = await call('POST', '/api/login', {
      body: { username: 'δεν-υπάρχει', password: PW }, headers: { 'X-Forwarded-For': freshIp() } });
    t('ανύπαρκτος χρήστης → 401', nouser.status, 401);
    ta('ίδιο μήνυμα και στις δύο περιπτώσεις (χωρίς account enumeration)',
      bad.json && nouser.json && bad.json.error === nouser.json.error,
      `${bad.json && bad.json.error} ≠ ${nouser.json && nouser.json.error}`);

    const ok = await login('adminuser');
    t('σωστά στοιχεία → 200', ok.status, 200);
    ta('επιστρέφεται isAdmin', ok.json && ok.json.isAdmin === true);
    ta('cookie httpOnly', /HttpOnly/i.test(ok.setCookie || ''), ok.setCookie);
    ta('cookie SameSite=Lax', /SameSite=Lax/i.test(ok.setCookie || ''), ok.setCookie);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 2. Β3 — ΑΝΑΓΕΝΝΗΣΗ SESSION (fixation) ==========');
  {
    const first = await login('editor');
    const sid1 = sidOf(first.setCookie);
    ta('το login δίνει session id', !!sid1);
    // Δεύτερο login ΜΕ ΤΟ ΙΔΙΟ cookie: το id πρέπει να ΑΛΛΑΞΕΙ
    const second = await call('POST', '/api/login', {
      body: { username: 'editor', password: PW }, cookie: first.cookie,
      headers: { 'X-Forwarded-For': freshIp() }
    });
    const sid2 = sidOf(second.setCookie);
    ta('εκδίδεται ΝΕΟ session id στο login', !!sid2 && sid2 !== sid1,
      `sid1=${String(sid1).slice(0, 12)}… sid2=${String(sid2).slice(0, 12)}…`);
    // Η συνεδρία δουλεύει κανονικά μετά την αναγέννηση
    const me = await call('GET', '/api/me', { cookie: (second.setCookie || '').split(';')[0] });
    t('η νέα συνεδρία είναι έγκυρη', me.status, 200);
    ta('…και κρατά τα στοιχεία χρήστη', me.json && me.json.displayName === 'Επεξεργαστής');
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 3. Β1/Β2 — ΔΙΚΑΙΩΜΑ ΕΠΕΞΕΡΓΑΣΙΑΣ AGENTS ==========');
  {
    const viewer = await login('viewer');   // can_edit_agents = 0
    const editor = await login('editor');   // can_edit_agents = 1
    const payload = { full_name: 'ΝΕΟΣ ΔΟΚΙΜΗ', company: 'ORION', departments: ['call'] };

    lastWrite = null;
    const c1 = await call('POST', '/api/agents', { body: payload, cookie: viewer.cookie });
    t('viewer → POST /api/agents = 403', c1.status, 403);
    t('…και ΔΕΝ γράφτηκε τίποτα', lastWrite, null);

    lastWrite = null;
    const c2 = await call('PUT', '/api/agents/10/active', { body: { active: 0 }, cookie: viewer.cookie });
    t('viewer → PUT /:id/active = 403', c2.status, 403);
    t('…και ΔΕΝ απενεργοποιήθηκε', lastWrite, null);

    lastWrite = null;
    const c3 = await call('PUT', '/api/agents/10', { body: payload, cookie: viewer.cookie });
    t('viewer → PUT /:id = 403', c3.status, 403);
    t('…και ΔΕΝ γράφτηκε τίποτα', lastWrite, null);

    // Ο εξουσιοδοτημένος ΔΕΝ πρέπει να εμποδίζεται (συμβατότητα)
    lastWrite = null;
    const e2 = await call('PUT', '/api/agents/10/active', { body: { active: 0 }, cookie: editor.cookie });
    ta(`editor → PUT /:id/active επιτρέπεται (${e2.status})`, e2.status === 200, JSON.stringify(e2.json));
    t('…και η εγγραφή έγινε', lastWrite, 'UPDATE active');

    // Χωρίς σύνδεση: 401, όχι 403
    const anon = await call('POST', '/api/agents', { body: payload });
    t('ανώνυμος → POST /api/agents = 401', anon.status, 401);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 4. Β6 — HEALTH ENDPOINT ==========');
  {
    // Το /api/health βρίσκεται ΠΙΣΩ από τα app.use('/api', requireAuth, …)
    // που προηγούνται — είναι ήδη προστατευμένο. Το κλειδώνουμε με test ώστε
    // να μη γίνει κατά λάθος δημόσιο σε μελλοντική αναδιάταξη των routes.
    const pub = await call('GET', '/api/health');
    t('ανώνυμος → 401 (δεν αποκαλύπτεται τίποτα)', pub.status, 401);
    ta('ΔΕΝ αποκαλύπτει όνομα βάσης', !/database|programa_vardion/.test(pub.raw), pub.raw.slice(0, 120));
    ta('ΔΕΝ αποκαλύπτει πλήθη εγγραφών', !/agent_constraints|shift_eligibility/.test(pub.raw), pub.raw.slice(0, 120));

    const viewer = await login('viewer');
    const nonAdmin = await call('GET', '/api/health', { cookie: viewer.cookie });
    t('συνδεδεμένος μη-admin → 200', nonAdmin.status, 200);
    ta('…ok: true (χρήσιμο ως probe για συνδεδεμένο monitor)', nonAdmin.json && nonAdmin.json.ok === true);
    ta('…αλλά ΧΩΡΙΣ όνομα βάσης', nonAdmin.json && !('database' in nonAdmin.json), JSON.stringify(nonAdmin.json));
    ta('…και ΧΩΡΙΣ πλήθη εγγραφών',
      nonAdmin.json && !('agents' in nonAdmin.json), JSON.stringify(nonAdmin.json));

    const admin = await login('adminuser');
    const det = await call('GET', '/api/health', { cookie: admin.cookie });
    ta('admin: παίρνει τις λεπτομέρειες', det.json && 'database' in det.json && 'agents' in det.json,
      JSON.stringify(det.json));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 5. Β5 — ΔΙΑΡΡΟΗ ΣΦΑΛΜΑΤΩΝ ==========');
  {
    const admin = await login('adminuser');
    const SECRET_SQL = "Unknown column 'users.password_hash' in 'field list'";
    throwOnNextQuery = SECRET_SQL;
    const r = await call('GET', '/api/agents', { cookie: admin.cookie });
    t('σφάλμα βάσης → 500', r.status, 500);
    ta('ΔΕΝ διαρρέει το μήνυμα της βάσης', !r.raw.includes('password_hash'), r.raw.slice(0, 160));
    ta('ΔΕΝ διαρρέει SQL/σχήμα', !/Unknown column|SELECT |FROM users/i.test(r.raw), r.raw.slice(0, 160));
    ta('γενικό μήνυμα προς τον χρήστη', !!(r.json && r.json.error && r.json.error.length < 80), r.raw.slice(0, 120));

    // Κακοσχηματισμένο JSON: φιλικό 400, όχι stack trace
    const bad = await call('POST', '/api/login', {
      body: '{"username": ',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp() } });
    ta(`κακοσχηματισμένο JSON → 4xx (${bad.status})`, bad.status >= 400 && bad.status < 500);
    ta('…χωρίς stack trace', !/at \w+ \(|node_modules/.test(bad.raw), bad.raw.slice(0, 160));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 6. ΦΡΑΓΜΑ ADMIN PANEL ==========');
  {
    const anon = await call('GET', '/admin.html');
    ta(`ανώνυμος → ανακατεύθυνση (${anon.status})`, anon.status === 302, String(anon.status));
    const viewer = await login('viewer');
    const nonAdmin = await call('GET', '/admin.html', { cookie: viewer.cookie });
    t('μη-admin → 403', nonAdmin.status, 403);
    ta('…και ΔΕΝ σερβίρεται το admin.html', !/admin\.js/.test(nonAdmin.raw), nonAdmin.raw.slice(0, 100));
    const admin = await login('adminuser');
    const ok = await call('GET', '/admin.html', { cookie: admin.cookie });
    t('admin → 200', ok.status, 200);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 7. ΚΕΦΑΛΙΔΕΣ ΑΣΦΑΛΕΙΑΣ ==========');
  {
    const r = await call('GET', '/api/health');
    const h = (n) => r.headers.get(n) || '';
    ta('Content-Security-Policy υπάρχει', !!h('content-security-policy'));
    ta("CSP: scriptSrc 'self' χωρίς unsafe-inline",
      /script-src 'self'(;|$)/.test(h('content-security-policy')), h('content-security-policy').slice(0, 120));
    ta("CSP: frame-ancestors 'none'", /frame-ancestors 'none'/.test(h('content-security-policy')));
    t('X-Content-Type-Options', h('x-content-type-options'), 'nosniff');
    ta('Referrer-Policy ορισμένο', !!h('referrer-policy'), h('referrer-policy'));
    ta('X-Powered-By κρυμμένο', !h('x-powered-by'), h('x-powered-by'));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 8. 401 ΣΕ ΟΛΑ ΤΑ ΠΡΟΣΤΑΤΕΥΜΕΝΑ API ==========');
  {
    const paths = [
      ['GET', '/api/agents'], ['GET', '/api/meta'], ['GET', '/api/timeoff'],
      ['POST', '/api/schedule/generate'], ['POST', '/api/export/week'],
      ['POST', '/api/import/preview'], ['GET', '/api/reports/mine'],
      ['GET', '/api/reports/admin/list'], ['GET', '/api/reports/admin/stats']
    ];
    for (const [m, p] of paths) {
      const r = await call(m, p, { body: m === 'POST' ? {} : undefined });
      ta(`${m} ${p} → 401 χωρίς σύνδεση`, r.status === 401, `πήρα ${r.status}`);
    }
    // Μη-admin σε admin endpoint → 403
    const viewer = await login('viewer');
    const r = await call('GET', '/api/reports/admin/list', { cookie: viewer.cookie });
    t('μη-admin σε /api/reports/admin/list → 403', r.status, 403);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 9. Β4 — EXCEL: ΚΑΝΕΝΑΣ ΤΥΠΟΣ ΑΠΟ ΟΝΟΜΑΤΑ ==========');
  {
    const ExcelJS = require('exceljs');
    const { buildWeekSheet } = require('../src/routes/export')._test;
    const WS = '2026-11-23';
    // Ονόματα που σε CSV θα ερμηνεύονταν ως τύποι
    const evil = ['=1+1', '+ΑΛΦΑ', '-ΒΗΤΑ', '@ΓΑΜΑ'];
    const assignments = evil.map((n, i) => ({
      agentId: 100 + i, agentName: n, date: WS, start: '08:00', end: '16:00',
      color: 'FFFFFFFF', reqLabel: 'Πρωινή'
    }));
    const wb = new ExcelJS.Workbook();
    buildWeekSheet(wb, 'test', WS, assignments);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf);

    let formulas = 0;
    const texts = [];
    back.worksheets[0].eachRow((row) => {
      row.eachCell((c) => {
        if (c.type === ExcelJS.ValueType.Formula || c.formula) formulas++;
        if (typeof c.value === 'string') texts.push(c.value);
      });
    });
    t('κανένα κελί δεν είναι ΤΥΠΟΣ', formulas, 0);
    ta('τα ονόματα γράφονται αυτούσια (καμία αλλοίωση)',
      evil.some((n) => texts.includes(n)) || texts.some((x) => evil.some((n) => x.startsWith(n.slice(0, 3)))),
      JSON.stringify(texts.slice(0, 8)));
  }


  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 10. ΟΜΑΔΑ Γ — ΗΜΕΡΟΛΟΓΙΟ ΑΣΦΑΛΕΙΑΣ ==========');
  {
    const { sanitize } = require('../src/middleware/audit');

    // Α. Καθαρισμός: τίποτα ευαίσθητο δεν περνά ποτέ
    const dirty = {
      username: 'editor', password: 'μυστικός', password_hash: '$2a$10$abc',
      sessionId: 'abc123', token: 'eyJ...', cookie: 'sid=1', authHeader: 'Bearer x',
      credentials: 'x', nested: { pwd: 'y', keep: 'ναι' }, keep: 'ναι'
    };
    const clean = JSON.stringify(sanitize(dirty));
    ta('ο καθαρισμός κρατά τα ακίνδυνα', /editor/.test(clean) && /"keep":"ναι"/.test(clean));
    for (const bad of ['μυστικός', '$2a$10$abc', 'abc123', 'eyJ', 'sid=1', 'Bearer']) {
      ta(`…και ΚΟΒΕΙ «${bad.slice(0, 14)}»`, !clean.includes(bad), clean.slice(0, 160));
    }
    ta('…κόβει και φωλιασμένα κλειδιά', !/"pwd"/.test(clean), clean.slice(0, 160));

    // Β. Καταγραφή επιτυχούς και αποτυχημένης σύνδεσης
    const before = AUDIT.length;
    await call('POST', '/api/login', {
      body: { username: 'editor', password: 'ΛΑΘΟΣ-ΚΩΔΙΚΟΣ' }, headers: { 'X-Forwarded-For': freshIp() } });
    const f = AUDIT[AUDIT.length - 1];
    ta('αποτυχία σύνδεσης καταγράφεται', !!f && f.action === 'LOGIN_FAILED', JSON.stringify(f));
    t('…με success = 0', f && f.success, 0);
    ta('…με το όνομα χρήστη', f && f.target_id === 'editor');
    ta('…ΧΩΡΙΣ τον κωδικό πουθενά', !JSON.stringify(f).includes('ΛΑΘΟΣ-ΚΩΔΙΚΟΣ'), JSON.stringify(f));

    const good = await login('editor');
    const okRow = AUDIT[AUDIT.length - 1];
    ta('επιτυχής σύνδεση καταγράφεται', okRow && okRow.action === 'LOGIN_SUCCESS');
    ta('…με success = 1', okRow && okRow.success === 1);
    ta('ΠΟΤΕ δεν αποθηκεύεται κωδικός σε καμία εγγραφή',
      !AUDIT.some((r) => JSON.stringify(r).includes(PW)), 'βρέθηκε κωδικός στο ημερολόγιο!');
    ta(`καταγράφηκαν ${AUDIT.length - before} νέες εγγραφές`, AUDIT.length > before);

    // Γ. Ενέργειες σε agents, με «πριν/μετά»
    const n0 = AUDIT.length;
    await call('PUT', '/api/agents/10/active', { body: { active: 0 }, cookie: good.cookie });
    const dea = AUDIT[AUDIT.length - 1];
    ta('απενεργοποίηση agent καταγράφεται', dea && dea.action === 'AGENT_DEACTIVATE', JSON.stringify(dea));
    ta('…με «από → σε»', dea && /"from"/.test(dea.details || '') && /"to"/.test(dea.details || ''), dea && dea.details);
    ta('…με αναγνωριστικό στόχου', dea && dea.target_id === '10');
    ta('…και με τον δράστη', dea && dea.actor_user_id === 2, String(dea && dea.actor_user_id));

    // Δ. Αποτυχημένη εξουσιοδότηση ΔΕΝ γράφει ψευδή εγγραφή επιτυχίας
    const viewer = await login('viewer');
    const nBefore = AUDIT.length;
    await call('PUT', '/api/agents/10/active', { body: { active: 1 }, cookie: viewer.cookie });
    ta('403 δεν παράγει εγγραφή ενέργειας',
      !AUDIT.slice(nBefore).some((r) => r.action === 'AGENT_ACTIVATE'),
      JSON.stringify(AUDIT.slice(nBefore)));

    // Ε. Λογαριασμός: ποιος μπορεί να διαβάσει το ημερολόγιο
    const anon = await call('GET', '/api/reports/admin/audit');
    t('ανώνυμος → 401', anon.status, 401);
    const nonAdmin = await call('GET', '/api/reports/admin/audit', { cookie: viewer.cookie });
    t('μη-admin → 403', nonAdmin.status, 403);
    const admin = await login('adminuser');
    const adm = await call('GET', '/api/reports/admin/audit', { cookie: admin.cookie });
    t('admin → 200', adm.status, 200);
    ta('…επιστρέφει εγγραφές', adm.json && Array.isArray(adm.json.entries) && adm.json.entries.length > 0);

    // ΣΤ. Καμία διαδρομή τροποποίησης/διαγραφής
    const srcReports = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', 'reports.js'), 'utf8');
    ta('κανένα UPDATE/DELETE στο audit_log σε όλο τον κώδικα',
      !/(UPDATE|DELETE)\s+(FROM\s+)?audit_log/i.test(
        ['reports', 'agents', 'auth', 'schedule', 'export', 'import', 'period', 'meta']
          .map((f) => require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', f + '.js'), 'utf8'))
          .join('\n') + srcReports
      ));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 11. ΟΜΑΔΑ Γ — ΚΛΕΙΔΩΜΑ ΛΟΓΑΡΙΑΣΜΟΥ ==========');
  {
    const U = 'viewer';
    // 10 αποτυχίες → κλείδωμα στην 11η
    let locked = null;
    for (let i = 0; i < 14; i++) {
      const r = await call('POST', '/api/login', {
        body: { username: U, password: 'ΛΑΘΟΣ' + i }, headers: { 'X-Forwarded-For': freshIp() }
      });
      if (r.status === 429) { locked = i; break; }
    }
    ta(`κλείδωμα λογαριασμού στις ${locked} αποτυχίες (από ΔΙΑΦΟΡΕΤΙΚΕΣ IP)`,
      locked !== null && locked >= 9 && locked <= 11, `locked=${locked}`);
    const after = await call('POST', '/api/login', {
      body: { username: U, password: PW }, headers: { 'X-Forwarded-For': freshIp() }
    });
    t('ακόμη και με ΣΩΣΤΟ κωδικό → 429 όσο κρατά το κλείδωμα', after.status, 429);
    ta('το κλείδωμα καταγράφηκε', AUDIT.some((r) => r.action === 'LOGIN_LOCKED'));

    // Άλλος λογαριασμός ΔΕΝ επηρεάζεται
    const other = await call('POST', '/api/login', {
      body: { username: 'adminuser', password: PW }, headers: { 'X-Forwarded-For': freshIp() }
    });
    t('άλλος λογαριασμός συνδέεται κανονικά', other.status, 200);

    // Ανύπαρκτος χρήστης κλειδώνει κι αυτός → καμία αποκάλυψη λογαριασμών
    for (let i = 0; i < 11; i++) {
      await call('POST', '/api/login', {
        body: { username: 'φάντασμα', password: 'x' + i }, headers: { 'X-Forwarded-For': freshIp() }
      });
    }
    const ghost = await call('POST', '/api/login', {
      body: { username: 'φάντασμα', password: 'x' }, headers: { 'X-Forwarded-For': freshIp() }
    });
    t('ανύπαρκτος χρήστης κλειδώνει επίσης (χωρίς enumeration)', ghost.status, 429);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 12. ΟΜΑΔΑ Γ — ΠΟΛΙΤΙΚΗ ΚΩΔΙΚΩΝ ==========');
  {
    const { validatePassword, MIN_LENGTH } = require('../src/utils/password');
    t(`ελάχιστο μήκος ${MIN_LENGTH}`, validatePassword('abcdefghijk').length > 0, true);
    t('κοινός κωδικός απορρίπτεται', validatePassword('password123').length > 0, true);
    t('ίδιος με username απορρίπτεται', validatePassword('adminadminadmin', 'adminadminadmin').length > 0, true);
    t('περιέχει username → απορρίπτεται', validatePassword('xxadminuserxx99', 'adminuser').length > 0, true);
    t('επανάληψη χαρακτήρα απορρίπτεται', validatePassword('aaaaaaaaaaaaaa').length > 0, true);
    t('ακολουθία πληκτρολογίου απορρίπτεται', validatePassword('qwertyuiop1234').length > 0, true);
    t('ισχυρός κωδικός γίνεται δεκτός', validatePassword('Θάλασσα-Βουνό-2026', 'editor').length, 0);
    ta('ΔΕΝ επηρεάζει υπάρχοντες κωδικούς (μόνο CLI για ΝΕΟΥΣ)',
      !require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8')
        .includes('assertStrongPassword'));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n========== 13. ΟΜΑΔΑ Γ — ΟΡΙΑ ΕΙΣΑΓΩΓΗΣ EXCEL ==========');
  {
    const admin = await login('adminuser');
    // Υπερμέγεθες base64 (~6MB αποσυμπιεσμένο)
    const huge = 'A'.repeat(8 * 1024 * 1024);
    const r = await call('POST', '/api/import/preview', {
      body: { weekStart: '2026-11-23', fileBase64: huge }, cookie: admin.cookie
    });
    ta(`υπερμέγεθες αρχείο απορρίπτεται (${r.status})`, r.status === 400 || r.status === 413, r.raw.slice(0, 120));
    ta('…με κατανοητό μήνυμα', /πολύ μεγάλο|μεγάλο/.test(r.raw) || r.status === 413, r.raw.slice(0, 160));

    const empty = await call('POST', '/api/import/preview', {
      body: { weekStart: '2026-11-23' }, cookie: admin.cookie
    });
    t('χωρίς αρχείο → 400', empty.status, 400);
  }
  console.log('\n' + '═'.repeat(60));
  console.log(`ΣΥΝΟΛΟ: ${pass} ok, ${fail} FAIL`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nΣΦΑΛΜΑ ΕΚΤΕΛΕΣΗΣ:', e && e.stack ? e.stack : e);
  process.exit(1);
});
