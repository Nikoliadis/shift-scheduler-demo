// Σύστημα αναφοράς λαθών (14/11/2026).
//
// Δύο ρόλοι, ΑΥΣΤΗΡΑ διαχωρισμένοι στο backend:
//   EMPLOYEE — υποβάλλει αναφορές, βλέπει ΜΟΝΟ τις δικές του, χωρίς σημειώσεις
//   ADMIN    — βλέπει/διαχειρίζεται όλες, αλλάζει καταστάσεις, εσωτερικές
//              σημειώσεις, ιστορικό, ειδοποιήσεις
//
// Ο έλεγχος γίνεται με requireAuth/requireAdmin στο server.js ΚΑΙ με φίλτρο
// user_id μέσα στα employee endpoints — ποτέ με βάση το τι στέλνει ο client.
const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED'];
// Οι κατηγορίες είναι κλειστή λίστα — ο client δεν ορίζει καινούργιες
const CATEGORIES = [
  'WRONG_SHIFT',        // Λάθος βάρδια
  'WRONG_DAY_OFF',      // Λάθος ρεπό
  'WRONG_HOURS',        // Λάθος ωράριο
  'WRONG_ASSIGNMENT',   // Λάθος ανάθεση εργαζομένου
  'VEGA_BANK',         // Πρόβλημα με Vega Bank
  'CONSTRAINT_VIOLATION', // Παραβίαση περιορισμού εργαζομένου
  'OTHER'               // Άλλο
];

const err400 = (msg) => Object.assign(new Error(msg), { status: 400 });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ═══════════════════════════════════════════════════════════════════
// EMPLOYEE — υποβολή και προβολή ΜΟΝΟ των δικών του αναφορών
// ═══════════════════════════════════════════════════════════════════

// POST /api/reports — υποβολή νέας αναφοράς
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { category, issueDate, description, relatedShift, extraInfo } = req.body || {};

    if (!CATEGORIES.includes(category)) throw err400('Διάλεξε κατηγορία προβλήματος');
    if (!isDate(issueDate)) throw err400('Δώσε την ημερομηνία που αφορά το πρόβλημα');
    const desc = String(description || '').trim();
    if (desc.length < 10) throw err400('Γράψε περιγραφή τουλάχιστον 10 χαρακτήρων');
    if (desc.length > 5000) throw err400('Η περιγραφή είναι πολύ μεγάλη (μέγιστο 5000 χαρακτήρες)');

    // Ο εργαζόμενος προκύπτει ΑΠΟΚΛΕΙΣΤΙΚΑ από το session — ό,τι όνομα
    // στείλει ο client αγνοείται (δεν γίνεται υποβολή εκ μέρους άλλου)
    const userId = req.session.userId;

    // Αποφυγή διπλής υποβολής από γρήγορα διαδοχικά clicks: ίδιος χρήστης,
    // ίδια κατηγορία/ημερομηνία/περιγραφή μέσα σε 30 δευτερόλεπτα
    const [[dup]] = await conn.query(
      `SELECT id FROM reports
       WHERE user_id = ? AND category = ? AND issue_date = ? AND description = ?
         AND created_at > (NOW() - INTERVAL 30 SECOND)
       ORDER BY id DESC LIMIT 1`,
      [userId, category, issueDate, desc]
    );
    if (dup) {
      return res.json({ ok: true, id: dup.id, duplicate: true, message: 'Η αναφορά είχε ήδη υποβληθεί.' });
    }

    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO reports (user_id, category, issue_date, description, related_shift, extra_info, status)
       VALUES (?, ?, ?, ?, ?, ?, 'NEW')`,
      [
        userId, category, issueDate, desc,
        (relatedShift || '').trim().slice(0, 100) || null,
        (extraInfo || '').trim().slice(0, 5000) || null
      ]
    );
    const reportId = ins.insertId;

    // Ιστορικό: η δημιουργία είναι η πρώτη εγγραφή
    await conn.query(
      'INSERT INTO report_status_history (report_id, from_status, to_status, changed_by) VALUES (?, NULL, ?, ?)',
      [reportId, 'NEW', userId]
    );
    // Ειδοποίηση admin
    await conn.query(
      'INSERT INTO admin_notifications (report_id, message) VALUES (?, ?)',
      [reportId, `Νέα αναφορά #${reportId} από ${req.session.displayName || 'χρήστη'}`]
    );
    await conn.commit();

    res.json({ ok: true, id: reportId, message: 'Η αναφορά υποβλήθηκε. Ευχαριστούμε!' });
  } catch (err) {
    try { await conn.rollback(); } catch { /* δεν είχε ανοίξει συναλλαγή */ }
    if (!err.status) console.error('report submit error:', err.message);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Προσωρινό πρόβλημα. Δοκίμασε ξανά.' });
  } finally {
    conn.release();
  }
});

// GET /api/reports/mine — ΜΟΝΟ οι δικές του, ΧΩΡΙΣ εσωτερικές σημειώσεις
router.get('/mine', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, category, issue_date, description, related_shift, extra_info, status, created_at
       FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
      [req.session.userId]
    );
    res.json({ ok: true, reports: rows });
  } catch (err) {
    console.error('reports/mine error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN — όλα τα παρακάτω περνούν από requireAdmin
// ═══════════════════════════════════════════════════════════════════

// GET /api/reports/admin/stats — μετρητές dashboard
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT status, COUNT(*) AS n FROM reports GROUP BY status');
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const [[unread]] = await pool.query('SELECT COUNT(*) AS n FROM admin_notifications WHERE is_read = 0');
    res.json({
      ok: true,
      stats: {
        total: STATUSES.reduce((a, s) => a + (by[s] || 0), 0),
        NEW: by.NEW || 0,
        IN_REVIEW: by.IN_REVIEW || 0,
        RESOLVED: by.RESOLVED || 0,
        REJECTED: by.REJECTED || 0
      },
      unreadNotifications: Number(unread.n)
    });
  } catch (err) {
    console.error('admin/stats error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

// GET /api/reports/admin/list — λίστα με αναζήτηση/φίλτρα
// query: status, category, userId, from, to, q
router.get('/admin/list', requireAdmin, async (req, res) => {
  try {
    const { status, category, userId, from, to, q } = req.query || {};
    const where = [];
    const args = [];
    if (status && STATUSES.includes(status)) { where.push('r.status = ?'); args.push(status); }
    if (category && CATEGORIES.includes(category)) { where.push('r.category = ?'); args.push(category); }
    if (userId && /^\d+$/.test(String(userId))) { where.push('r.user_id = ?'); args.push(Number(userId)); }
    if (isDate(from)) { where.push('r.issue_date >= ?'); args.push(from); }
    if (isDate(to)) { where.push('r.issue_date <= ?'); args.push(to); }
    if (q && String(q).trim()) {
      where.push('(r.description LIKE ? OR r.related_shift LIKE ? OR u.display_name LIKE ? OR u.username LIKE ?)');
      const like = `%${String(q).trim()}%`;
      args.push(like, like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT r.id, r.user_id, COALESCE(u.display_name, u.username) AS userName,
              r.category, r.issue_date, r.description, r.related_shift, r.extra_info,
              r.status, r.created_at, r.updated_at,
              (SELECT COUNT(*) FROM report_notes n WHERE n.report_id = r.id) AS noteCount
       FROM reports r LEFT JOIN users u ON u.id = r.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY r.id DESC LIMIT 500`,
      args
    );
    res.json({ ok: true, reports: rows });
  } catch (err) {
    console.error('admin/list error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

// GET /api/reports/admin/users — για το φίλτρο εργαζομένου
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, COALESCE(u.display_name, u.username) AS name, COUNT(r.id) AS reportCount
       FROM users u JOIN reports r ON r.user_id = u.id
       GROUP BY u.id, name ORDER BY name`
    );
    res.json({ ok: true, users: rows });
  } catch (err) {
    console.error('admin/users error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

// GET /api/reports/admin/notifications — μη αναγνωσμένες πρώτα
router.get('/admin/notifications', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.id, n.report_id, n.message, n.is_read, n.created_at, r.status
       FROM admin_notifications n LEFT JOIN reports r ON r.id = n.report_id
       ORDER BY n.is_read ASC, n.id DESC LIMIT 50`
    );
    const [[unread]] = await pool.query('SELECT COUNT(*) AS n FROM admin_notifications WHERE is_read = 0');
    res.json({ ok: true, notifications: rows, unread: Number(unread.n) });
  } catch (err) {
    console.error('admin/notifications error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

// POST /api/reports/admin/notifications/read — σήμανση ως αναγνωσμένων
// body: { reportId } ή { all: true }
router.post('/admin/notifications/read', requireAdmin, async (req, res) => {
  try {
    const { reportId, all } = req.body || {};
    if (all === true) {
      const [r] = await pool.query('UPDATE admin_notifications SET is_read = 1, read_at = NOW() WHERE is_read = 0');
      return res.json({ ok: true, marked: r.affectedRows });
    }
    if (!/^\d+$/.test(String(reportId))) throw err400('Λείπει το reportId');
    const [r] = await pool.query(
      'UPDATE admin_notifications SET is_read = 1, read_at = NOW() WHERE report_id = ? AND is_read = 0',
      [Number(reportId)]
    );
    res.json({ ok: true, marked: r.affectedRows });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Προσωρινό πρόβλημα.' });
  }
});

// GET /api/reports/admin/:id — πλήρης αναφορά: ιστορικό + εσωτερικές σημειώσεις
// ΠΡΟΣΟΧΗ ΣΕΙΡΑΣ: πρέπει να δηλώνεται ΠΡΙΝ από το '/admin/:id', αλλιώς το
// :id ταιριάζει με τη λέξη 'audit' και η διαδρομή δεν φτάνει ποτέ εδώ.
// ==================== ΗΜΕΡΟΛΟΓΙΟ ΑΣΦΑΛΕΙΑΣ (15/11/2026) ====================
// ΜΟΝΟ ΑΝΑΓΝΩΣΗ και ΜΟΝΟ για διαχειριστές. Δεν υπάρχει καμία διαδρομή της
// εφαρμογής που να τροποποιεί ή να διαγράφει εγγραφές του ημερολογίου.
router.get('/admin/audit', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const where = [];
    const params = [];
    if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action).slice(0, 40)); }
    if (req.query.actor) { where.push('actor_user_id = ?'); params.push(Number(req.query.actor) || 0); }
    if (req.query.success === '0') where.push('success = 0');

    const [rows] = await pool.query(
      `SELECT id, created_at, actor_user_id, actor_name, action, target_type,
              target_id, success, ip, details
       FROM audit_log
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[c]] = await pool.query(
      `SELECT COUNT(*) AS n FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      params
    );
    res.json({ ok: true, total: c.n, limit, offset, entries: rows });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json({ ok: true, total: 0, entries: [], needsMigration: true });
    console.error('admin/audit error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα.' });
  }
});

router.get('/admin/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw err400('Άκυρο id');
    const [[report]] = await pool.query(
      `SELECT r.*, COALESCE(u.display_name, u.username) AS userName
       FROM reports r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
      [id]
    );
    if (!report) return res.status(404).json({ ok: false, error: 'Η αναφορά δεν βρέθηκε' });
    const [history] = await pool.query(
      `SELECT h.id, h.from_status, h.to_status, h.created_at,
              COALESCE(u.display_name, u.username) AS byName
       FROM report_status_history h LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.report_id = ? ORDER BY h.id`,
      [id]
    );
    const [notes] = await pool.query(
      `SELECT n.id, n.note, n.created_at, COALESCE(u.display_name, u.username) AS authorName
       FROM report_notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.report_id = ? ORDER BY n.id`,
      [id]
    );
    // Το άνοιγμα της αναφοράς σημαίνει «αναγνωσμένη» (ζητούμενο 5)
    await pool.query(
      'UPDATE admin_notifications SET is_read = 1, read_at = NOW() WHERE report_id = ? AND is_read = 0',
      [id]
    );
    res.json({ ok: true, report, history, notes });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Προσωρινό πρόβλημα.' });
  }
});

// PATCH /api/reports/admin/:id/status — αλλαγή κατάστασης + ιστορικό
router.patch('/admin/:id/status', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) throw err400('Άκυρο id');
    if (!STATUSES.includes(status)) throw err400('Άκυρη κατάσταση');

    await conn.beginTransaction();
    const [[cur]] = await conn.query('SELECT status FROM reports WHERE id = ? FOR UPDATE', [id]);
    if (!cur) throw Object.assign(new Error('Η αναφορά δεν βρέθηκε'), { status: 404 });
    if (cur.status === status) {
      await conn.commit();
      return res.json({ ok: true, status, unchanged: true });
    }
    await conn.query('UPDATE reports SET status = ? WHERE id = ?', [status, id]);
    await conn.query(
      'INSERT INTO report_status_history (report_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)',
      [id, cur.status, status, req.session.userId]
    );
    await conn.commit();
    res.json({ ok: true, status, from: cur.status });
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Προσωρινό πρόβλημα.' });
  } finally {
    conn.release();
  }
});

// POST /api/reports/admin/:id/notes — εσωτερική σημείωση (μόνο admin τη βλέπει)
router.post('/admin/:id/notes', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = String((req.body || {}).note || '').trim();
    if (!Number.isInteger(id) || id <= 0) throw err400('Άκυρο id');
    if (!note) throw err400('Γράψε τη σημείωση');
    if (note.length > 5000) throw err400('Η σημείωση είναι πολύ μεγάλη');
    const [[exists]] = await pool.query('SELECT id FROM reports WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ ok: false, error: 'Η αναφορά δεν βρέθηκε' });
    const [ins] = await pool.query(
      'INSERT INTO report_notes (report_id, author_id, note) VALUES (?, ?, ?)',
      [id, req.session.userId, note]
    );
    res.json({ ok: true, id: ins.insertId });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Προσωρινό πρόβλημα.' });
  }
});


module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
