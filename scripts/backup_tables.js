// Στοχευμένο backup/restore των πινάκων που αγγίζουν τα migrations (14/11/2026).
//
// Δεν αντικαθιστά το mysqldump — κρατά ΜΟΝΟ τους πίνακες που πρόκειται να
// αλλάξουν, ώστε να υπάρχει σημείο επιστροφής όταν δεν υπάρχει mysql client.
//
//   node scripts/backup_tables.js dump [αρχείο.json]
//   node scripts/backup_tables.js restore <αρχείο.json>            (dry-run)
//   node scripts/backup_tables.js restore <αρχείο.json> --confirm  (γράφει)
//
// Railway: DATABASE_URL="mysql://..." node scripts/backup_tables.js dump
//
// Το restore ΑΔΕΙΑΖΕΙ και ξαναγράφει ΜΟΝΟ τους πίνακες του αρχείου.
const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');
const cfg = require('../src/db/config');

// Οι πίνακες που πειράζουν τα add_rules_1411.js / seed_rules.js / migrate.js.
// Σειρά σημαντική για το restore (τα παιδιά μετά τους γονείς).
const TABLES = [
  'roles',
  'skills',
  'agents',
  'agent_skills',
  'agent_constraints',
  'shift_requirements',
  'shift_eligibility',
  'users'
];

async function tableExists(name) {
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return n > 0;
}

async function dump(file) {
  const out = {
    _meta: {
      createdAt: new Date().toISOString(),
      database: cfg.database,
      host: cfg.host,
      note: 'Στοχευμένο backup πινάκων αναφοράς — ΟΧΙ πλήρες dump (λείπουν schedules/assignments/time_off).'
    }
  };
  let total = 0;
  for (const t of TABLES) {
    if (!(await tableExists(t))) {
      console.log(`  −  ${t}: δεν υπάρχει, παραλείπεται`);
      continue;
    }
    const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
    out[t] = rows;
    total += rows.length;
    console.log(`  ✓  ${t}: ${rows.length} γραμμές`);
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`\nOK: ${total} γραμμές → ${file} (${kb} KB)`);
  console.log('ΠΡΟΣΟΧΗ: δεν περιλαμβάνει schedules/assignments/time_off (ιστορικό προγραμμάτων).');
}

async function restore(file, confirmed) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const present = TABLES.filter((t) => Array.isArray(data[t]));
  console.log(`Αρχείο: ${file}`);
  if (data._meta) console.log(`Δημιουργήθηκε: ${data._meta.createdAt} από ${data._meta.database}@${data._meta.host}`);
  console.log(`Πίνακες στο αρχείο: ${present.length}\n`);
  for (const t of present) {
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(`  ${t}: τώρα ${n} γραμμές → θα γίνουν ${data[t].length}`);
  }
  if (!confirmed) {
    console.log('\nDRY-RUN: δεν γράφτηκε τίποτα. Πρόσθεσε --confirm για να εφαρμοστεί.');
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    for (const t of present) {
      await conn.query(`DELETE FROM \`${t}\``);
      for (const row of data[t]) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        await conn.query(
          `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(', ')})
           VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row[c])
        );
      }
      console.log(`  ✓ ${t}: ${data[t].length} γραμμές`);
    }
    await conn.commit();
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\nOK: η επαναφορά ολοκληρώθηκε.');
  } catch (e) {
    await conn.rollback();
    try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); } catch { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

(async () => {
  const [cmd, fileArg] = process.argv.slice(2);
  const confirmed = process.argv.includes('--confirm');
  console.log(`Βάση: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}\n`);

  if (cmd === 'dump') {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    await dump(fileArg || path.join(process.cwd(), `backup-${cfg.database}-${stamp}.json`));
  } else if (cmd === 'restore') {
    if (!fileArg) throw new Error('Δώσε το αρχείο backup');
    await restore(fileArg, confirmed);
  } else {
    console.log('Χρήση:');
    console.log('  node scripts/backup_tables.js dump [αρχείο.json]');
    console.log('  node scripts/backup_tables.js restore <αρχείο.json> [--confirm]');
  }
  await pool.end();
})().catch((e) => {
  const parts = [e && e.code, e && e.message].filter(Boolean);
  if (e && Array.isArray(e.errors)) for (const s of e.errors) parts.push(`${s.code || ''} ${s.message || ''}`.trim());
  console.error('Σφάλμα:', parts.length ? parts.join(' | ') : e);
  process.exit(1);
});
