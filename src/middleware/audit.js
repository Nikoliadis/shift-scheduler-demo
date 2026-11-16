// ==================== ΗΜΕΡΟΛΟΓΙΟ ΑΣΦΑΛΕΙΑΣ (15/11/2026) ====================
//
// Κεντρικό σημείο καταγραφής. Κανένα route δεν γράφει απευθείας στον πίνακα.
//
// ΑΡΧΕΣ
//   1. Η καταγραφή ΔΕΝ ρίχνει ποτέ την εφαρμογή. Αν αποτύχει το INSERT (π.χ.
//      ο πίνακας δεν υπάρχει ακόμη σε παλιά βάση), το σφάλμα απλώς
//      καταγράφεται στα logs και η λειτουργία συνεχίζει.
//   2. ΠΟΤΕ δεν αποθηκεύονται κωδικοί, hashes, session ids, tokens, cookies,
//      ολόκληρα request bodies ή περιττά προσωπικά δεδομένα. Υπάρχει
//      μαύρη λίστα κλειδιών που κόβει ό,τι ξεφύγει κατά λάθος.
//   3. Το `details` είναι μικρή δομημένη σύνοψη με ανώτατο όριο μεγέθους.
const pool = require('../db/pool');

// Κλειδιά που ΔΕΝ επιτρέπεται να φτάσουν ποτέ στο ημερολόγιο
const FORBIDDEN = /pass|pwd|hash|secret|token|cookie|session|sid|auth|credential|bearer/i;
const MAX_DETAILS = 2000;

// Γνωστές ενέργειες — σταθερές ώστε να φιλτράρονται αξιόπιστα
const ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGOUT: 'LOGOUT',
  AGENT_CREATE: 'AGENT_CREATE',
  AGENT_UPDATE: 'AGENT_UPDATE',
  AGENT_ACTIVATE: 'AGENT_ACTIVATE',
  AGENT_DEACTIVATE: 'AGENT_DEACTIVATE',
  SCHEDULE_SAVE: 'SCHEDULE_SAVE',
  SCHEDULE_IMPORT: 'SCHEDULE_IMPORT',
  EXPORT_WEEK: 'EXPORT_WEEK',
  EXPORT_PERIOD: 'EXPORT_PERIOD',
  REPORT_STATUS: 'REPORT_STATUS',
  ADMIN_ACTION: 'ADMIN_ACTION'
};

// Καθαρισμός του details: κόβει απαγορευμένα κλειδιά, περιορίζει βάθος/μέγεθος
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 3) return '…';
  if (typeof value === 'string') return value.length > 200 ? value.slice(0, 200) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.test(k)) continue;            // σιωπηλή απόρριψη
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}

// Η IP όπως τη βλέπει ο Express πίσω από το proxy (trust proxy = 1)
function ipOf(req) {
  const ip = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || null;
  return ip ? String(ip).slice(0, 45) : null;
}

/**
 * Καταγραφή μίας ενέργειας. Δεν πετάει ποτέ εξαίρεση.
 *
 * @param {object} req            Express request (για χρήστη/IP) — μπορεί να λείπει
 * @param {object} o
 * @param {string} o.action       μία από τις ACTIONS
 * @param {string} [o.targetType] π.χ. 'agent', 'schedule', 'report'
 * @param {string|number} [o.targetId]
 * @param {boolean} [o.success]   προεπιλογή true
 * @param {object} [o.details]    μικρή σύνοψη — ΧΩΡΙΣ ευαίσθητα
 * @param {string} [o.actorName]  όταν δεν υπάρχει session (π.χ. αποτυχία login)
 * @param {object} [o.conn]       σύνδεση σε transaction, όταν χρειάζεται συνέπεια
 */
async function audit(req, o = {}) {
  try {
    const s = (req && req.session) || {};
    const clean = o.details === undefined ? null : sanitize(o.details);
    let json = clean === null ? null : JSON.stringify(clean);
    if (json && json.length > MAX_DETAILS) json = json.slice(0, MAX_DETAILS - 1) + '…';

    const runner = o.conn || pool;
    await runner.query(
      `INSERT INTO audit_log
       (actor_user_id, actor_name, action, target_type, target_id, success, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.userId || null,
        (s.displayName || o.actorName || null) && String(s.displayName || o.actorName).slice(0, 100),
        String(o.action).slice(0, 40),
        o.targetType ? String(o.targetType).slice(0, 30) : null,
        o.targetId === undefined || o.targetId === null ? null : String(o.targetId).slice(0, 64),
        o.success === false ? 0 : 1,
        ipOf(req),
        json
      ]
    );
  } catch (err) {
    // Η αποτυχία καταγραφής ΔΕΝ διακόπτει τη λειτουργία
    console.error('[audit] αποτυχία καταγραφής:', err.message);
  }
}

/**
 * Πόσες ΑΠΟΤΥΧΗΜΕΝΕΣ συνδέσεις έγιναν για αυτό το όνομα χρήστη μέσα στο
 * παράθυρο; Χρησιμοποιείται για κλείδωμα ΑΝΑ ΛΟΓΑΡΙΑΣΜΟ (το rate limit του
 * Express είναι ανά IP και δεν πιάνει κατανεμημένη επίθεση).
 *
 * Μετράει μόνο μετά την τελευταία ΕΠΙΤΥΧΗ σύνδεση, ώστε μια σωστή είσοδος να
 * μηδενίζει τον μετρητή.
 */
async function recentFailures(username, windowMinutes) {
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM audit_log
       WHERE action = ? AND target_type = 'username' AND target_id = ?
         AND created_at > (NOW() - INTERVAL ? MINUTE)
         AND created_at > COALESCE((
           SELECT MAX(created_at) FROM audit_log
           WHERE action = ? AND target_type = 'username' AND target_id = ?
         ), '1970-01-01')`,
      [ACTIONS.LOGIN_FAILED, username, windowMinutes, ACTIONS.LOGIN_SUCCESS, username]
    );
    return Number(row.n) || 0;
  } catch (err) {
    // Αν ο πίνακας λείπει (παλιά βάση), ΜΗΝ κλειδώνεις κανέναν
    console.error('[audit] recentFailures:', err.message);
    return 0;
  }
}

module.exports = { audit, recentFailures, ACTIONS, sanitize };
