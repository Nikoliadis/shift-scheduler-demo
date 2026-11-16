// Migration: πίνακας ΕΠΙΘΥΜΗΤΩΝ ΩΡΩΝ ΕΡΓΑΣΙΑΣ (15/11/2026).
//
// ΜΟΝΟ προσθήκη: δημιουργεί τον πίνακα shift_wishes και τίποτε άλλο.
// Δεν αγγίζει agents, agent_constraints, shift_requirements, shift_eligibility,
// schedules, assignments, time_off, users ή reports.
//
// Idempotent: στη 2η εκτέλεση δεν κάνει καμία αλλαγή.
//
// ΠΡΟΣΟΧΗ (MySQL/MariaDB): το CREATE TABLE είναι DDL και κάνει implicit commit —
// δεν καλύπτεται από transaction. Γι' αυτό η εντολή είναι ΜΙΑ και μόνη: είτε
// εκτελείται ολόκληρη είτε καθόλου, οπότε δεν χρειάζεται rollback.
//
// Χρήση:
//   node scripts/add_shift_wishes.js --dry      (δείχνει τι θα κάνει)
//   node scripts/add_shift_wishes.js            (εκτελεί)
const pool = require('../src/db/pool');

const DRY = process.argv.includes('--dry');

const DDL = `CREATE TABLE shift_wishes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wish_agent_date (agent_id, date),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  INDEX idx_shift_wishes_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

(async () => {
  const [[info]] = await pool.query('SELECT DATABASE() AS db, VERSION() AS v, USER() AS u');
  console.log(`Βάση: ${info.u}/${info.db}  (MySQL/MariaDB ${info.v})`);
  console.log(DRY ? '--- DRY RUN: δεν γράφεται τίποτα ---\n' : '--- ΕΚΤΕΛΕΣΗ ---\n');

  // Στιγμιότυπο ΠΡΙΝ: αποδεικνύει ότι δεν πειράχτηκε τίποτε άλλο
  const counts = {};
  for (const t of ['agents', 'agent_constraints', 'shift_requirements', 'shift_eligibility',
    'schedules', 'assignments', 'time_off', 'users']) {
    try {
      const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counts[t] = r.n;
    } catch { counts[t] = '—'; }
  }
  console.log('Υπάρχοντα δεδομένα (πρέπει να μείνουν ΑΜΕΤΑΒΛΗΤΑ):');
  for (const [t, n] of Object.entries(counts)) console.log(`    ${t.padEnd(20)} ${n}`);
  console.log('');

  const [[exists]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'shift_wishes'`
  );

  if (exists.n) {
    const [cols] = await pool.query(
      `SELECT column_name AS c, column_type AS t FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'shift_wishes' ORDER BY ordinal_position`
    );
    const [[rows]] = await pool.query('SELECT COUNT(*) AS n FROM shift_wishes');
    console.log(`= Ο πίνακας shift_wishes υπάρχει ήδη (${rows.n} αιτήματα) — καμία αλλαγή.`);
    console.log('  στήλες: ' + cols.map((x) => `${x.c} ${x.t}`).join(', '));
  } else if (DRY) {
    console.log('+ Θα δημιουργηθεί ο πίνακας shift_wishes:');
    console.log(DDL.split('\n').map((l) => '    ' + l).join('\n'));
  } else {
    await pool.query(DDL);
    const [[chk]] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'shift_wishes'`
    );
    console.log(chk.n ? '✓ Ο πίνακας shift_wishes δημιουργήθηκε.' : '✘ Η δημιουργία ΑΠΕΤΥΧΕ.');
    if (!chk.n) { await pool.end(); process.exit(1); }
  }

  // Επαλήθευση: τίποτα άλλο δεν άλλαξε
  console.log('\nΕπαλήθευση ακεραιότητας:');
  let bad = 0;
  for (const [t, before] of Object.entries(counts)) {
    if (before === '—') continue;
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const ok = Number(r.n) === Number(before);
    if (!ok) bad++;
    console.log(`    ${t.padEnd(20)} ${before} → ${r.n}  ${ok ? '✓' : '✘ ΑΛΛΑΞΕ'}`);
  }
  console.log(bad ? `\n✘ ${bad} πίνακες άλλαξαν — εκτός scope!` : '\n✓ Κανένας άλλος πίνακας δεν άλλαξε.');

  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.error('ΣΦΑΛΜΑ:', e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
