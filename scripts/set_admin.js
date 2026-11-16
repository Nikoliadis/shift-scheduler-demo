// Ορισμός/αφαίρεση δικαιώματος Admin σε χρήστη (14/11/2026).
//   node scripts/set_admin.js <username> on|off
//   node scripts/set_admin.js --list
//
// Το RBAC βασίζεται στη στήλη users.is_admin (0 = EMPLOYEE, 1 = ADMIN).
// Δεν δημιουργείται δεύτερο σύστημα χρηστών — ο ίδιος πίνακας users.
//
// Railway: DATABASE_URL="mysql://..." node scripts/set_admin.js <username> on
const pool = require('../src/db/pool');
const cfg = require('../src/db/config');

(async () => {
  const args = process.argv.slice(2);
  console.log(`Βάση: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}\n`);

  // Η στήλη μπορεί να λείπει αν δεν έχει τρέξει το migrate — idempotent έλεγχος
  const [[col]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'`
  );
  if (col.n === 0) {
    console.error('ΣΦΑΛΜΑ: λείπει η στήλη users.is_admin — τρέξε πρώτα: node src/db/migrate.js');
    process.exitCode = 1;
    await pool.end();
    return;
  }

  if (args[0] === '--list' || args.length === 0) {
    const [rows] = await pool.query(
      'SELECT id, username, display_name, is_admin, can_edit_agents FROM users ORDER BY id'
    );
    console.log('ID  ADMIN  EDIT  USERNAME            DISPLAY NAME');
    for (const u of rows) {
      console.log(
        String(u.id).padEnd(4),
        (u.is_admin ? ' ✔  ' : ' —  ').padEnd(6),
        (u.can_edit_agents ? ' ✔ ' : ' — ').padEnd(5),
        String(u.username).padEnd(20),
        u.display_name || ''
      );
    }
    if (args.length === 0) {
      console.log('\nΧρήση: node scripts/set_admin.js <username> on|off');
    }
    await pool.end();
    return;
  }

  const [username, mode] = args;
  if (!username || !['on', 'off'].includes(mode)) {
    console.error('Χρήση: node scripts/set_admin.js <username> on|off   (ή --list)');
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const [[user]] = await pool.query('SELECT id, username, is_admin FROM users WHERE username = ?', [username]);
  if (!user) {
    console.error(`Δεν βρέθηκε χρήστης «${username}».`);
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const want = mode === 'on' ? 1 : 0;
  if (user.is_admin === want) {
    console.log(`Ο χρήστης «${username}» είναι ήδη ${want ? 'ADMIN' : 'EMPLOYEE'} — καμία αλλαγή.`);
  } else {
    await pool.query('UPDATE users SET is_admin = ? WHERE id = ?', [want, user.id]);
    console.log(`OK: ο χρήστης «${username}» είναι τώρα ${want ? 'ADMIN' : 'EMPLOYEE'}.`);
    console.log('ΠΡΟΣΟΧΗ: ο ρόλος μπαίνει στο session στο login — χρειάζεται νέα σύνδεση.');
  }
  await pool.end();
})().catch((e) => {
  const parts = [e && e.code, e && e.message].filter(Boolean);
  if (e && Array.isArray(e.errors)) for (const s of e.errors) parts.push(`${s.code || ''} ${s.message || ''}`.trim());
  console.error('Σφάλμα:', parts.length ? parts.join(' | ') : e);
  process.exit(1);
});
