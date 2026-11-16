// Κεντρικός Express server.
// ΒΗΜΑ 2: login (session + bcrypt) και API agents. Οι επόμενες οθόνες
// (περίοδος, generator, export) προστίθενται στα επόμενα βήματα.
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const pool = require('./db/pool');
const config = require('./db/config');
const { requireAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const agentsRoutes = require('./routes/agents');
const metaRoutes = require('./routes/meta');
const periodRoutes = require('./routes/period');
const scheduleRoutes = require('./routes/schedule');
const exportRoutes = require('./routes/export');
const importRoutes = require('./routes/import');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// Πίσω από το HTTPS proxy του Railway/Render: σωστό req.ip και ασφαλή cookies
app.set('trust proxy', 1);

const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- Ασφάλεια (18/07/2026) ----------
// Κεφαλίδες: anti-clickjacking, anti-MIME-sniffing, HSTS, CSP.
// Το CSP επιτρέπει inline STYLES (τα χρησιμοποιεί το UI) αλλά ΟΧΙ inline
// scripts — όλη η JS είναι σε εξωτερικά αρχεία, οπότε κόβει XSS στη ρίζα.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Brute-force προστασία στο login: 10 ΑΠΟΤΥΧΗΜΕΝΕΣ προσπάθειες ανά IP / 15'
// (οι επιτυχημένες δεν μετράνε, ώστε να μην ενοχλείται ο κανονικός χρήστης)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Πολλές προσπάθειες σύνδεσης. Δοκίμασε ξανά σε λίγα λεπτά.' }
});
app.use('/api/login', loginLimiter);

// Μεγαλύτερο όριο body: οι validate/save κλήσεις στέλνουν ολόκληρες εβδομάδες αναθέσεων
app.use(express.json({ limit: '5mb' }));

// Τα sessions αποθηκεύονται ΣΤΗ ΒΑΣΗ (πίνακας `sessions`, δημιουργείται
// αυτόματα) — έτσι δεν χάνεται το login σε κάθε deploy/restart στο cloud.
const sessionStore = new MySQLStore({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  createDatabaseTable: true,
  charset: 'utf8mb4_general_ci'
});

app.use(
  session({
    key: 'programa_vardion_sid',
    secret: process.env.SESSION_SECRET || 'programa-vardion-dev-secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,               // δεν διαβάζεται από JavaScript
      sameSite: 'lax',              // προστασία CSRF
      secure: IS_PROD,              // μόνο μέσω HTTPS στην παραγωγή
      maxAge: 8 * 60 * 60 * 1000    // 8 ώρες
    }
  })
);

// ---------- Admin Panel: φράγμα ΠΡΙΝ από τα static ----------
// (14/11/2026) Το express.static θα σερβίριζε το admin.html σε οποιονδήποτε.
// Ο έλεγχος μπαίνει ΠΡΙΝ, ώστε ένας employee να μην μπορεί να μπει αλλάζοντας
// απλώς το URL. Τα API endpoints ελέγχονται ξεχωριστά με requireAdmin.
app.get(['/admin.html', '/admin'], (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  if (req.session.isAdmin !== true) {
    return res
      .status(403)
      .type('html')
      .send('<!doctype html><meta charset="utf-8"><title>Χωρίς πρόσβαση</title>' +
        '<body style="font-family:Segoe UI,sans-serif;background:#f4f6f9;color:#2c3345;padding:3rem;text-align:center">' +
        '<h1 style="color:#b23030;font-size:1.3rem">Δεν έχεις δικαίωμα πρόσβασης</h1>' +
        '<p>Το Admin Panel είναι διαθέσιμο μόνο σε διαχειριστές.</p>' +
        '<p><a href="/" style="color:#2f5496">Επιστροφή στην εφαρμογή</a></p></body>');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes χωρίς auth: login/logout/me
app.use('/api', authRoutes);

// Routes με auth
app.use('/api/agents', requireAuth, agentsRoutes);
app.use('/api', requireAuth, metaRoutes);
app.use('/api', requireAuth, periodRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/export', requireAuth, exportRoutes);
app.use('/api/import', requireAuth, importRoutes);
// Αναφορές λαθών: requireAuth για όλους· τα admin endpoints βάζουν
// requireAdmin από μέσα (src/routes/reports.js).
// Όριο υποβολών: 20 νέες αναφορές ανά 15' / IP — εμποδίζει το spam χωρίς να
// ενοχλεί κανονική χρήση. Αφορά ΜΟΝΟ την υποβολή (POST), όχι την ανάγνωση.
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Πολλές αναφορές σε λίγο χρόνο. Δοκίμασε ξανά σε λίγα λεπτά.' }
});
app.post('/api/reports', reportLimiter);
app.use('/api/reports', requireAuth, reportsRoutes);

// ---------- Health check (15/11/2026: περιορισμένη αποκάλυψη) ----------
// ΠΡΙΝ: επέστρεφε σε οποιονδήποτε, χωρίς σύνδεση, το όνομα της βάσης και τα
// πλήθη εγγραφών (πόσοι εργαζόμενοι, πόσοι κανόνες) — χρήσιμη αναγνώριση για
// επιτιθέμενο.
//
// ΤΩΡΑ: η δημόσια απόκριση μένει 200 OK με ελάχιστο σώμα, ώστε ΚΑΘΕ εξωτερικό
// uptime probe (Railway, UptimeRobot κ.λπ.) να συνεχίσει να δουλεύει ακριβώς
// όπως πριν. Τα αναλυτικά στοιχεία δίνονται ΜΟΝΟ σε συνδεδεμένο διαχειριστή.
app.get('/api/health', async (req, res) => {
  const isAdmin = !!(req.session && req.session.userId && req.session.isAdmin === true);
  try {
    // Η σύνδεση με τη βάση ελέγχεται πάντα — αλλιώς το probe δεν λέει τίποτα
    await pool.query('SELECT 1');
    if (!isAdmin) return res.json({ ok: true });

    const [[agents]] = await pool.query('SELECT COUNT(*) AS n FROM agents WHERE active = 1');
    const [[reqs]] = await pool.query('SELECT COUNT(*) AS n FROM shift_requirements');
    const [[elig]] = await pool.query('SELECT COUNT(*) AS n FROM shift_eligibility');
    const [[cons]] = await pool.query('SELECT COUNT(*) AS n FROM agent_constraints');
    res.json({
      ok: true,
      database: config.database,
      agents: agents.n,
      shift_requirements: reqs.n,
      shift_eligibility: elig.n,
      agent_constraints: cons.n
    });
  } catch (err) {
    // Το probe πρέπει να μάθει ότι κάτι χάλασε — ΟΧΙ όμως τι ακριβώς
    console.error('[error] health:', err.message);
    res.status(500).json({ ok: false });
  }
});

// Τελευταίο δίχτυ: κανένα stack trace δεν φεύγει ποτέ προς τα έξω
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Ο server τρέχει στο http://localhost:${PORT}`);
});

// Εξαγωγή για τη σουίτα ασφαλείας (scripts/test_security.js), που σηκώνει τον
// ΠΡΑΓΜΑΤΙΚΟ server σε τυχαία θύρα. Στην παραγωγή το αρχείο εκτελείται ως
// entry point και η εξαγωγή δεν χρησιμοποιείται από κανέναν.
module.exports = { app, server };
