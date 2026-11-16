// Migration: πίνακας ΗΜΕΡΟΛΟΓΙΟΥ ΑΣΦΑΛΕΙΑΣ audit_log (15/11/2026).
//
// ΜΟΝΟ προσθήκη. Δεν αγγίζει agents, agent_constraints, shift_requirements,
// shift_eligibility, schedules, assignments, time_off, users, reports.
//
// Idempotent: στη 2η εκτέλεση δεν κάνει καμία αλλαγή.
//
// ΑΝΑΣΤΡΕΨΙΜΟ: `DROP TABLE audit_log;` επαναφέρει πλήρως την προηγούμενη
// κατάσταση — ο πίνακας δεν έχει foreign keys ούτε τον αναφέρει άλλος πίνακας.
//
// ΣΥΜΒΑΤΟ ΠΡΟΣ ΤΑ ΠΙΣΩ: η εφαρμογή λειτουργεί και ΧΩΡΙΣ τον πίνακα — η
// καταγραφή αποτυγχάνει σιωπηλά (μόνο log) και το κλείδωμα λογαριασμού
// απενεργοποιείται. Άρα η σειρά deploy κώδικα/migration δεν έχει σημασία.
//
// ΠΡΟΣΟΧΗ (MySQL/MariaDB): το CREATE TABLE είναι DDL και κάνει implicit
// commit — δεν καλύπτεται από transaction. Η εντολή είναι ΜΙΑ και μόνη.
//
// Χρήση:
//   node scripts/add_audit_log.js --dry      (δείχνει τι θα κάνει)
//   node scripts/add_audit_log.js            (εκτελεί)
const pool = require('../src/db/pool');

const DRY = process.argv.includes('--dry');

const DDL = `CREATE TABLE audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actor_user_id INT NULL,
  actor_name VARCHAR(100) NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(30) NULL,
  target_id VARCHAR(64) NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  ip VARCHAR(45) NULL,
  details TEXT NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_actor (actor_user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const WATCH = ['agents', 'agent_constraints', 'shift_requirements', 'shift_eligibility',
  'schedules', 'assignments', 'time_off', 'users', 'reports'];

(async () => {
  const [[info]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS v, USER() AS u');
  console.log(`Βάση: ${info.u}/${info.db}  (MySQL/MariaDB ${info.v})`);
  console.log(DRY ? '--- DRY RUN: δεν γράφεται τίποτα ---\n' : '--- ΕΚΤΕΛΕΣΗ ---\n');

  const before = {};
  for (const t of WATCH) {
    try {
      const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      before[t] = Number(r.n);
    } catch { before[t] = null; }
  }
  console.log('Υπάρχοντα δεδομένα (πρέπει να μείνουν ΑΜΕΤΑΒΛΗΤΑ):');
  for (const [t, n] of Object.entries(before)) console.log(`    ${t.padEnd(20)} ${n === null ? '—' : n}`);
  console.log('');

  const [[exists]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'audit_log'`
  );

  if (exists.n) {
    const [[rows]] = await pool.query('SELECT COUNT(*) AS n FROM audit_log');
    console.log(`= Ο πίνακας audit_log υπάρχει ήδη (${rows.n} εγγραφές) — καμία αλλαγή.`);
  } else if (DRY) {
    console.log('+ Θα δημιουργηθεί ο πίνακας audit_log:');
    console.log(DDL.split('\n').map((l) => '    ' + l).join('\n'));
  } else {
    await pool.query(DDL);
    const [[chk]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'audit_log'`
    );
    console.log(chk.n ? '✓ Ο πίνακας audit_log δημιουργήθηκε.' : '✘ Η δημιουργία ΑΠΕΤΥΧΕ.');
    if (!chk.n) { await pool.end(); process.exit(1); }
  }

  console.log('\nΕπαλήθευση ακεραιότητας:');
  let bad = 0;
  for (const [t, n] of Object.entries(before)) {
    if (n === null) continue;
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const ok = Number(r.n) === n;
    if (!ok) bad++;
    console.log(`    ${t.padEnd(20)} ${n} → ${r.n}  ${ok ? '✓' : '✘ ΑΛΛΑΞΕ'}`);
  }
  console.log(bad ? `\n✘ ${bad} πίνακες άλλαξαν — εκτός scope!` : '\n✓ Κανένας άλλος πίνακας δεν άλλαξε.');
  console.log('\nΑναστροφή: DROP TABLE audit_log;');

  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.error('ΣΦΑΛΜΑ:', e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
