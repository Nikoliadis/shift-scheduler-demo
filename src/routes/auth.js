// Routes σύνδεσης/αποσύνδεσης προϊσταμένων (express-session + bcrypt)
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { audit, recentFailures, ACTIONS } = require('../middleware/audit');

// Κλείδωμα ΑΝΑ ΛΟΓΑΡΙΑΣΜΟ (15/11/2026). Το express-rate-limit είναι ανά IP
// και δεν πιάνει κατανεμημένη επίθεση (credential stuffing από πολλές IP).
// Μετράει αποτυχίες για το ΟΝΟΜΑ ΧΡΗΣΤΗ — υπαρκτό ή όχι, ώστε να μην
// αποκαλύπτεται ποιοι λογαριασμοί υπάρχουν.
const LOCK_THRESHOLD = 10;
const LOCK_WINDOW_MIN = 15;

const router = express.Router();

// POST /api/login — έλεγχος στοιχείων και δημιουργία session
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Συμπλήρωσε όνομα χρήστη και κωδικό' });
  }
  const uname = String(username).slice(0, 100);
  try {
    // Προσωρινό κλείδωμα μετά από επανειλημμένες αποτυχίες
    const fails = await recentFailures(uname, LOCK_WINDOW_MIN);
    if (fails >= LOCK_THRESHOLD) {
      await audit(req, {
        action: ACTIONS.LOGIN_LOCKED, targetType: 'username', targetId: uname,
        success: false, actorName: uname, details: { failures: fails, windowMinutes: LOCK_WINDOW_MIN }
      });
      return res.status(429).json({
        ok: false,
        error: `Ο λογαριασμός κλειδώθηκε προσωρινά μετά από πολλές αποτυχημένες προσπάθειες. Δοκίμασε ξανά σε ${LOCK_WINDOW_MIN} λεπτά.`
      });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [uname]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      // Καταγράφεται ΜΟΝΟ το όνομα χρήστη — ποτέ ο κωδικός
      await audit(req, {
        action: ACTIONS.LOGIN_FAILED, targetType: 'username', targetId: uname,
        success: false, actorName: uname, details: { reason: user ? 'bad_password' : 'unknown_user' }
      });
      // Ίδιο μήνυμα και στις δύο περιπτώσεις — καμία αποκάλυψη λογαριασμών
      return res.status(401).json({ ok: false, error: 'Λάθος όνομα χρήστη ή κωδικός' });
    }
    // (15/11/2026) ΑΠΟΤΡΟΠΗ SESSION FIXATION: νέο session id μετά την επιτυχή
    // σύνδεση. Αν κάποιος «φύτεψε» γνωστό id στον browser του θύματος πριν το
    // login, εκείνο το id παύει να ισχύει τη στιγμή της αυθεντικοποίησης.
    await new Promise((resolve, reject) => {
      req.session.regenerate((e) => (e ? reject(e) : resolve()));
    });

    req.session.userId = user.id;
    req.session.displayName = user.display_name || user.username;
    // Δικαίωμα επεξεργασίας agents (προεπιλογή: ναι· 0 = χωρίς δικαίωμα)
    req.session.canEditAgents = user.can_edit_agents !== 0;
    // RBAC (14/11/2026): ο ρόλος μπαίνει στο session ΜΙΑ φορά, στο login
    req.session.isAdmin = user.is_admin === 1;

    // Αποθήκευση ΠΡΙΝ την απάντηση: το session ζει στη βάση και ο client
    // μπορεί να στείλει το επόμενο request πριν προλάβει να γραφτεί.
    await new Promise((resolve, reject) => {
      req.session.save((e) => (e ? reject(e) : resolve()));
    });

    await audit(req, { action: ACTIONS.LOGIN_SUCCESS, targetType: 'username', targetId: uname });

    res.json({
      ok: true,
      displayName: req.session.displayName,
      canEditAgents: req.session.canEditAgents,
      isAdmin: req.session.isAdmin
    });
  } catch (err) {
    // Μη συνδεδεμένος χρήστης: ΠΟΤΕ εσωτερικές λεπτομέρειες (SQL/σχήμα) προς τα έξω
    console.error('login error:', err.message);
    res.status(500).json({ ok: false, error: 'Προσωρινό πρόβλημα. Δοκίμασε ξανά.' });
  }
});

// POST /api/logout — καταστροφή session
router.post('/logout', async (req, res) => {
  if (req.session && req.session.userId) {
    await audit(req, { action: ACTIONS.LOGOUT, targetType: 'user', targetId: req.session.userId });
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/me — ποιος είναι συνδεδεμένος (για έλεγχο από το frontend)
router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({
      ok: true,
      displayName: req.session.displayName,
      canEditAgents: req.session.canEditAgents !== false,
      isAdmin: req.session.isAdmin === true
    });
  }
  res.status(401).json({ ok: false });
});

module.exports = router;
