// Tests συστήματος αναφορών + RBAC (14/11/2026) — ΧΩΡΙΣ πραγματική βάση.
//
// Σηκώνει ΠΡΑΓΜΑΤΙΚΟ Express server με τον ΠΡΑΓΜΑΤΙΚΟ router (src/routes/reports.js)
// και το ΠΡΑΓΜΑΤΙΚΟ middleware (src/middleware/auth.js), πάνω σε in-memory
// fake pool. Οι κλήσεις γίνονται με HTTP fetch, όπως από το browser.
//
// Χρήση: node scripts/test_reports.js
const http = require('http');

let fail = 0;
let pass = 0;
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}

// ══════════════════════════════════════════════════════════════════
// In-memory βάση
// ══════════════════════════════════════════════════════════════════
const DB = {
  users: [
    { id: 1, username: 'admin', display_name: 'Διαχειριστής', is_admin: 1, can_edit_agents: 1 },
    { id: 2, username: 'kostas', display_name: 'ΚΩΣΤΑΣ Π.', is_admin: 0, can_edit_agents: 1 },
    { id: 3, username: 'maria', display_name: 'ΙΡΙΣ Λ.', is_admin: 0, can_edit_agents: 0 }
  ],
  reports: [],
  report_status_history: [],
  report_notes: [],
  admin_notifications: []
};
let seq = { reports: 0, hist: 0, notes: 0, notif: 0 };
const userName = (id) => {
  const u = DB.users.find((x) => x.id === id);
  return u ? (u.display_name || u.username) : null;
};
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

async function query(sql, params = []) {
  const s = norm(sql);
  const a = [...(params || [])];

  // ---- dup check ----
  if (/SELECT id FROM reports WHERE user_id = \? AND category = \?/.test(s)) {
    const [uid, cat, date, desc] = a;
    const hit = DB.reports.filter((r) => r.user_id === uid && r.category === cat &&
      r.issue_date === date && r.description === desc && Date.now() - r._ts < 30000).pop();
    return [hit ? [{ id: hit.id }] : [], []];
  }
  if (/^INSERT INTO reports/.test(s)) {
    const [user_id, category, issue_date, description, related_shift, extra_info] = a;
    const r = {
      id: ++seq.reports, user_id, category, issue_date, description,
      related_shift, extra_info, status: 'NEW', created_at: now(), updated_at: now(), _ts: Date.now()
    };
    DB.reports.push(r);
    return [{ insertId: r.id, affectedRows: 1 }, []];
  }
  if (/^INSERT INTO report_status_history/.test(s)) {
    // Η δημιουργία χρησιμοποιεί literal NULL: VALUES (?, NULL, ?, ?) → 3 params
    const literalNull = /VALUES \(\?, NULL,/.test(s);
    const [report_id, from_status, to_status, changed_by] = literalNull
      ? [a[0], null, a[1], a[2]]
      : a;
    DB.report_status_history.push({ id: ++seq.hist, report_id, from_status, to_status, changed_by, created_at: now() });
    return [{ insertId: seq.hist, affectedRows: 1 }, []];
  }
  if (/^INSERT INTO admin_notifications/.test(s)) {
    const [report_id, message] = a;
    DB.admin_notifications.push({ id: ++seq.notif, report_id, message, is_read: 0, created_at: now(), read_at: null });
    return [{ insertId: seq.notif, affectedRows: 1 }, []];
  }
  if (/^INSERT INTO report_notes/.test(s)) {
    const [report_id, author_id, note] = a;
    DB.report_notes.push({ id: ++seq.notes, report_id, author_id, note, created_at: now() });
    return [{ insertId: seq.notes, affectedRows: 1 }, []];
  }
  // ---- employee: δικές του ----
  if (/FROM reports WHERE user_id = \? ORDER BY id DESC/.test(s)) {
    return [DB.reports.filter((r) => r.user_id === a[0]).slice().reverse().map((r) => ({ ...r })), []];
  }
  // ---- stats ----
  if (/SELECT status, COUNT\(\*\) AS n FROM reports GROUP BY status/.test(s)) {
    const by = {};
    for (const r of DB.reports) by[r.status] = (by[r.status] || 0) + 1;
    return [Object.entries(by).map(([status, n]) => ({ status, n })), []];
  }
  if (/SELECT COUNT\(\*\) AS n FROM admin_notifications WHERE is_read = 0/.test(s)) {
    return [[{ n: DB.admin_notifications.filter((x) => !x.is_read).length }], []];
  }
  // ---- admin list (δυναμικό WHERE) ----
  if (/FROM reports r LEFT JOIN users u ON u\.id = r\.user_id/.test(s) && /noteCount/.test(s)) {
    let rows = DB.reports.slice();
    let i = 0;
    if (/r\.status = \?/.test(s)) { const v = a[i++]; rows = rows.filter((r) => r.status === v); }
    if (/r\.category = \?/.test(s)) { const v = a[i++]; rows = rows.filter((r) => r.category === v); }
    if (/r\.user_id = \?/.test(s)) { const v = a[i++]; rows = rows.filter((r) => r.user_id === v); }
    if (/r\.issue_date >= \?/.test(s)) { const v = a[i++]; rows = rows.filter((r) => r.issue_date >= v); }
    if (/r\.issue_date <= \?/.test(s)) { const v = a[i++]; rows = rows.filter((r) => r.issue_date <= v); }
    if (/r\.description LIKE \?/.test(s)) {
      const needle = String(a[i]).replace(/%/g, '').toLowerCase();
      i += 4;
      rows = rows.filter((r) => [r.description, r.related_shift, userName(r.user_id)]
        .some((f) => String(f || '').toLowerCase().includes(needle)));
    }
    return [rows.slice().reverse().map((r) => ({
      ...r, userName: userName(r.user_id),
      noteCount: DB.report_notes.filter((n) => n.report_id === r.id).length
    })), []];
  }
  // ---- admin users ----
  if (/FROM users u JOIN reports r ON r\.user_id = u\.id/.test(s)) {
    const ids = [...new Set(DB.reports.map((r) => r.user_id))];
    return [ids.map((id) => ({ id, name: userName(id), reportCount: DB.reports.filter((r) => r.user_id === id).length })), []];
  }
  // ---- notifications ----
  if (/FROM admin_notifications n LEFT JOIN reports r/.test(s)) {
    const rows = DB.admin_notifications.slice()
      .sort((x, y) => (x.is_read - y.is_read) || (y.id - x.id))
      .map((n) => ({ ...n, status: (DB.reports.find((r) => r.id === n.report_id) || {}).status || null }));
    return [rows, []];
  }
  if (/^UPDATE admin_notifications SET is_read = 1, read_at = NOW\(\) WHERE is_read = 0/.test(s)) {
    let k = 0;
    for (const n of DB.admin_notifications) if (!n.is_read) { n.is_read = 1; n.read_at = now(); k++; }
    return [{ affectedRows: k }, []];
  }
  if (/^UPDATE admin_notifications SET is_read = 1, read_at = NOW\(\) WHERE report_id = \?/.test(s)) {
    let k = 0;
    for (const n of DB.admin_notifications) if (n.report_id === a[0] && !n.is_read) { n.is_read = 1; n.read_at = now(); k++; }
    return [{ affectedRows: k }, []];
  }
  // ---- detail ----
  if (/FROM reports r LEFT JOIN users u ON u\.id = r\.user_id WHERE r\.id = \?/.test(s)) {
    const r = DB.reports.find((x) => x.id === a[0]);
    return [r ? [{ ...r, userName: userName(r.user_id) }] : [], []];
  }
  if (/FROM report_status_history h/.test(s)) {
    return [DB.report_status_history.filter((h) => h.report_id === a[0])
      .map((h) => ({ ...h, byName: userName(h.changed_by) })), []];
  }
  if (/FROM report_notes n/.test(s)) {
    return [DB.report_notes.filter((n) => n.report_id === a[0])
      .map((n) => ({ ...n, authorName: userName(n.author_id) })), []];
  }
  if (/SELECT status FROM reports WHERE id = \? FOR UPDATE/.test(s)) {
    const r = DB.reports.find((x) => x.id === a[0]);
    return [r ? [{ status: r.status }] : [], []];
  }
  if (/^UPDATE reports SET status = \? WHERE id = \?/.test(s)) {
    const r = DB.reports.find((x) => x.id === a[1]);
    if (r) { r.status = a[0]; r.updated_at = now(); }
    return [{ affectedRows: r ? 1 : 0 }, []];
  }
  if (/^SELECT id FROM reports WHERE id = \?/.test(s)) {
    const r = DB.reports.find((x) => x.id === a[0]);
    return [r ? [{ id: r.id }] : [], []];
  }
  throw new Error('fakePool: αταίριαστο SQL → ' + s.slice(0, 110));
}

const fakePool = {
  query,
  async getConnection() {
    return { query, release() {}, async beginTransaction() {}, async commit() {}, async rollback() {} };
  },
  async end() {}
};
const poolPath = require.resolve('../src/db/pool');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };

// ══════════════════════════════════════════════════════════════════
// Πραγματικός Express app με τον πραγματικό router + middleware
// ══════════════════════════════════════════════════════════════════
const express = require('express');
const { requireAuth } = require('../src/middleware/auth');
const reportsRouter = require('../src/routes/reports');

const app = express();
app.use(express.json());
// Προσομοίωση session: ο ρόλος έρχεται από header ΜΟΝΟ στα tests.
// Στην εφαρμογή γεμίζει από το login (users.is_admin) — βλ. src/routes/auth.js
app.use((req, res, next) => {
  const uid = Number(req.get('x-test-user') || 0);
  if (uid) {
    const u = DB.users.find((x) => x.id === uid);
    req.session = { userId: u.id, displayName: u.display_name, isAdmin: u.is_admin === 1 };
  } else {
    req.session = {};
  }
  next();
});
app.use('/api/reports', requireAuth, reportsRouter);

const server = http.createServer(app);

function call(method, path, { as, body } = {}) {
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers['x-test-user'] = String(as);
  // Το fetch δεν δέχεται body σε GET/HEAD
  const sendBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body: sendBody ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}

const ADMIN = 1;
const EMP = 2;
const EMP2 = 3;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  console.log('\n=== 1. Υποβολή αναφοράς από Employee ===');
  const sub = await call('POST', '/api/reports', {
    as: EMP,
    body: { category: 'VEGA_BANK', issueDate: '2026-11-18', description: 'Η βάρδια Vega Bank 23:00-07:00 δεν είναι σωστή για μένα.', relatedShift: '23:00-07:00' }
  });
  ta('η υποβολή πέτυχε', sub.status === 200 && sub.data.ok, JSON.stringify(sub.data));
  ta(`δημιουργήθηκε αναφορά #${sub.data && sub.data.id}`, sub.data && sub.data.id === 1);
  ta('αποθηκεύτηκε στη βάση', DB.reports.length === 1 && DB.reports[0].status === 'NEW');
  ta('2) ο χρήστης αναγνωρίστηκε ΑΥΤΟΜΑΤΑ από το session',
    DB.reports[0].user_id === EMP, `user_id=${DB.reports[0].user_id}`);
  ta('καταγράφηκε ιστορικό δημιουργίας',
    DB.report_status_history.length === 1 && DB.report_status_history[0].to_status === 'NEW');
  ta('5) δημιουργήθηκε ειδοποίηση admin (μη αναγνωσμένη)',
    DB.admin_notifications.length === 1 && DB.admin_notifications[0].is_read === 0);

  // Ο client ΔΕΝ μπορεί να υποβάλει εκ μέρους άλλου
  const spoof = await call('POST', '/api/reports', {
    as: EMP,
    body: { category: 'OTHER', issueDate: '2026-11-19', description: 'Δοκιμή πλαστογράφησης χρήστη.', userId: ADMIN, user_id: ADMIN }
  });
  ta('το userId του client ΑΓΝΟΕΙΤΑΙ (όχι υποβολή εκ μέρους άλλου)',
    spoof.data.ok && DB.reports.find((r) => r.id === spoof.data.id).user_id === EMP);

  console.log('\n=== 2. Validation + αποφυγή διπλής υποβολής ===');
  const bad1 = await call('POST', '/api/reports', { as: EMP, body: { category: 'NOPE', issueDate: '2026-11-18', description: 'αρκετά μεγάλη περιγραφή' } });
  ta('άκυρη κατηγορία → 400', bad1.status === 400);
  const bad2 = await call('POST', '/api/reports', { as: EMP, body: { category: 'OTHER', issueDate: 'χθες', description: 'αρκετά μεγάλη περιγραφή' } });
  ta('άκυρη ημερομηνία → 400', bad2.status === 400);
  const bad3 = await call('POST', '/api/reports', { as: EMP, body: { category: 'OTHER', issueDate: '2026-11-18', description: 'κοντό' } });
  ta('πολύ κοντή περιγραφή → 400', bad3.status === 400);

  const payload = { category: 'WRONG_HOURS', issueDate: '2026-11-20', description: 'Διπλό κλικ στο κουμπί υποβολής.' };
  const [d1, d2] = await Promise.all([
    call('POST', '/api/reports', { as: EMP, body: payload }),
    call('POST', '/api/reports', { as: EMP, body: payload })
  ]);
  const made = DB.reports.filter((r) => r.description === payload.description).length;
  ta(`διπλό γρήγορο click → ${made} εγγραφή (όχι 2)`, made === 1,
    `status: ${d1.status}/${d2.status}, ids: ${d1.data && d1.data.id}/${d2.data && d2.data.id}`);

  console.log('\n=== 3. RBAC: ο Employee ΑΠΟΚΛΕΙΕΤΑΙ από κάθε admin endpoint ===');
  const adminEndpoints = [
    ['GET', '/api/reports/admin/stats'],
    ['GET', '/api/reports/admin/list'],
    ['GET', '/api/reports/admin/users'],
    ['GET', '/api/reports/admin/notifications'],
    ['GET', '/api/reports/admin/1'],
    ['POST', '/api/reports/admin/notifications/read'],
    ['PATCH', '/api/reports/admin/1/status'],
    ['POST', '/api/reports/admin/1/notes']
  ];
  let blocked = 0;
  for (const [m, p] of adminEndpoints) {
    const r = await call(m, p, { as: EMP, body: { status: 'RESOLVED', note: 'x', all: true } });
    if (r.status === 403) blocked++;
    else ta(`${m} ${p} → ΠΡΕΠΕΙ 403`, false, `πήρα ${r.status}`);
  }
  ta(`8/10) και τα ${adminEndpoints.length} admin endpoints επιστρέφουν 403 στον Employee`,
    blocked === adminEndpoints.length, `μπλοκαρίστηκαν ${blocked}/${adminEndpoints.length}`);

  let noAuth = 0;
  for (const [m, p] of adminEndpoints) {
    const r = await call(m, p, { body: {} });   // χωρίς session
    if (r.status === 401) noAuth++;
  }
  ta(`χωρίς σύνδεση → 401 σε όλα (${noAuth}/${adminEndpoints.length})`, noAuth === adminEndpoints.length);

  console.log('\n=== 4. Ο Employee βλέπει ΜΟΝΟ τις δικές του ===');
  await call('POST', '/api/reports', { as: EMP2, body: { category: 'WRONG_DAY_OFF', issueDate: '2026-11-21', description: 'Αναφορά του δεύτερου εργαζομένου.' } });
  const mine = await call('GET', '/api/reports/mine', { as: EMP });
  const mine2 = await call('GET', '/api/reports/mine', { as: EMP2 });
  ta('9) ο EMP βλέπει μόνο τις δικές του', mine.data.reports.every((r) => r.user_id === EMP || r.user_id === undefined));
  ta('9) ο EMP δεν βλέπει την αναφορά του EMP2',
    !mine.data.reports.some((r) => r.description.includes('δεύτερου εργαζομένου')));
  ta('9) ο EMP2 βλέπει τη δική του', mine2.data.reports.some((r) => r.description.includes('δεύτερου εργαζομένου')));
  ta('οι δικές του αναφορές ΔΕΝ περιέχουν εσωτερικές σημειώσεις',
    mine.data.reports.every((r) => !('notes' in r) && !('noteCount' in r)));

  console.log('\n=== 5. Admin Dashboard + notification badge ===');
  const st1 = await call('GET', '/api/reports/admin/stats', { as: ADMIN });
  ta('ο Admin βλέπει στατιστικά', st1.status === 200 && st1.data.ok);
  ta(`4) σύνολο αναφορών = ${DB.reports.length}`, st1.data.stats.total === DB.reports.length);
  ta(`νέες = ${st1.data.stats.NEW}`, st1.data.stats.NEW === DB.reports.filter((r) => r.status === 'NEW').length);
  ta(`5) badge μη αναγνωσμένων = ${st1.data.unreadNotifications}`,
    st1.data.unreadNotifications === DB.admin_notifications.filter((n) => !n.is_read).length &&
    st1.data.unreadNotifications > 0);

  const notif = await call('GET', '/api/reports/admin/notifications', { as: ADMIN });
  ta('οι ειδοποιήσεις δείχνουν πρώτα τις μη αναγνωσμένες',
    notif.data.notifications.length > 0 && notif.data.notifications[0].is_read === 0);
  ta('κάθε ειδοποίηση δείχνει σε συγκεκριμένη αναφορά',
    notif.data.notifications.every((n) => Number.isInteger(n.report_id)));

  console.log('\n=== 6. Άνοιγμα αναφοράς → σημαίνεται ως αναγνωσμένη ===');
  const unreadBefore = DB.admin_notifications.filter((n) => !n.is_read).length;
  const det = await call('GET', '/api/reports/admin/1', { as: ADMIN });
  ta('ο Admin βλέπει πλήρεις λεπτομέρειες', det.status === 200 && det.data.report.id === 1);
  ta('περιλαμβάνεται ιστορικό', Array.isArray(det.data.history) && det.data.history.length >= 1);
  ta('περιλαμβάνονται εσωτερικές σημειώσεις (λίστα)', Array.isArray(det.data.notes));
  ta(`5) το άνοιγμα μείωσε τις μη αναγνωσμένες (${unreadBefore} → ${DB.admin_notifications.filter((n) => !n.is_read).length})`,
    DB.admin_notifications.filter((n) => !n.is_read).length === unreadBefore - 1);

  console.log('\n=== 7. Αλλαγή κατάστασης + ιστορικό ===');
  const ch = await call('PATCH', '/api/reports/admin/1/status', { as: ADMIN, body: { status: 'IN_REVIEW' } });
  ta('6) η κατάσταση άλλαξε σε IN_REVIEW', ch.data.ok && ch.data.status === 'IN_REVIEW' && ch.data.from === 'NEW');
  ta('η βάση ενημερώθηκε', DB.reports.find((r) => r.id === 1).status === 'IN_REVIEW');
  ta('καταγράφηκε στο ιστορικό',
    DB.report_status_history.some((h) => h.report_id === 1 && h.from_status === 'NEW' && h.to_status === 'IN_REVIEW' && h.changed_by === ADMIN));
  const same = await call('PATCH', '/api/reports/admin/1/status', { as: ADMIN, body: { status: 'IN_REVIEW' } });
  ta('ίδια κατάσταση → unchanged, χωρίς διπλή εγγραφή ιστορικού',
    same.data.unchanged === true &&
    DB.report_status_history.filter((h) => h.report_id === 1 && h.to_status === 'IN_REVIEW').length === 1);
  const badSt = await call('PATCH', '/api/reports/admin/1/status', { as: ADMIN, body: { status: 'HACKED' } });
  ta('άκυρη κατάσταση → 400', badSt.status === 400);
  const missing = await call('PATCH', '/api/reports/admin/9999/status', { as: ADMIN, body: { status: 'RESOLVED' } });
  ta('ανύπαρκτη αναφορά → 404', missing.status === 404);

  console.log('\n=== 8. Εσωτερικές σημειώσεις (μόνο Admin) ===');
  const note = await call('POST', '/api/reports/admin/1/notes', { as: ADMIN, body: { note: 'Ελέγχθηκε με τον προϊστάμενο — ισχύει.' } });
  ta('7) η σημείωση προστέθηκε', note.data.ok && DB.report_notes.length === 1);
  ta('η σημείωση συνδέεται με τον admin συγγραφέα', DB.report_notes[0].author_id === ADMIN);
  const det2 = await call('GET', '/api/reports/admin/1', { as: ADMIN });
  ta('ο Admin βλέπει τη σημείωση', det2.data.notes.length === 1 && det2.data.notes[0].authorName === 'Διαχειριστής');
  const mineAfter = await call('GET', '/api/reports/mine', { as: EMP });
  const ownReport = mineAfter.data.reports.find((r) => r.id === 1);
  ta('ο Employee ΔΕΝ βλέπει τη σημείωση στη δική του αναφορά',
    ownReport && !JSON.stringify(ownReport).includes('Ελέγχθηκε με τον προϊστάμενο'));
  const emptyNote = await call('POST', '/api/reports/admin/1/notes', { as: ADMIN, body: { note: '   ' } });
  ta('κενή σημείωση → 400', emptyNote.status === 400);

  console.log('\n=== 9. Αναζήτηση και φίλτρα ===');
  const byStatus = await call('GET', '/api/reports/admin/list?status=IN_REVIEW', { as: ADMIN });
  ta('φίλτρο κατάστασης', byStatus.data.reports.length === 1 && byStatus.data.reports[0].id === 1);
  const byCat = await call('GET', '/api/reports/admin/list?category=VEGA_BANK', { as: ADMIN });
  ta('φίλτρο κατηγορίας', byCat.data.reports.every((r) => r.category === 'VEGA_BANK') && byCat.data.reports.length === 1);
  const byUser = await call('GET', '/api/reports/admin/list?userId=' + EMP2, { as: ADMIN });
  ta('φίλτρο εργαζομένου', byUser.data.reports.every((r) => r.user_id === EMP2) && byUser.data.reports.length === 1);
  const byQ = await call('GET', '/api/reports/admin/list?q=' + encodeURIComponent('δεύτερου'), { as: ADMIN });
  ta('αναζήτηση κειμένου', byQ.data.reports.length === 1 && byQ.data.reports[0].user_id === EMP2);
  const byQName = await call('GET', '/api/reports/admin/list?q=' + encodeURIComponent('ΙΡΙΣ'), { as: ADMIN });
  ta('αναζήτηση με όνομα εργαζομένου', byQName.data.reports.length === 1);
  const all = await call('GET', '/api/reports/admin/list', { as: ADMIN });
  ta(`χωρίς φίλτρα → όλες (${all.data.reports.length})`, all.data.reports.length === DB.reports.length);
  ta('ο πίνακας δείχνει όνομα εργαζομένου και πλήθος σημειώσεων',
    all.data.reports.every((r) => 'userName' in r && 'noteCount' in r));

  console.log('\n=== 10. Σήμανση όλων + τελική κατάσταση ===');
  await call('POST', '/api/reports/admin/notifications/read', { as: ADMIN, body: { all: true } });
  ta('όλες οι ειδοποιήσεις σημάνθηκαν', DB.admin_notifications.every((n) => n.is_read === 1));
  const st2 = await call('GET', '/api/reports/admin/stats', { as: ADMIN });
  ta('το badge πήγε στο 0', st2.data.unreadNotifications === 0);
  await call('PATCH', '/api/reports/admin/1/status', { as: ADMIN, body: { status: 'RESOLVED' } });
  const st3 = await call('GET', '/api/reports/admin/stats', { as: ADMIN });
  ta(`επιλυμένες = 1`, st3.data.stats.RESOLVED === 1);
  ta('το σύνολο παραμένει σωστό', st3.data.stats.total === DB.reports.length);

  server.close();
  console.log(`\n${fail === 0 ? '✔ ΟΛΑ ΠΕΡΑΣΑΝ' : '✘ ' + fail + ' ΑΠΕΤΥΧΑΝ'}  (${pass} ok, ${fail} fail)\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nΣΦΑΛΜΑ ΕΚΤΕΛΕΣΗΣ:', e && e.stack ? e.stack : e);
  try { server.close(); } catch { /* ignore */ }
  process.exit(1);
});
