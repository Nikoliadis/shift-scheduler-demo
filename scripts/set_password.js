// Αλλαγή κωδικού χρήστη (για ασφαλές deployment — φύγε από το admin/admin).
// Τοπικά:   node scripts/set_password.js admin <νέος-κωδικός>
// Στο cloud: τρέξε το ίδιο με τις env vars της βάσης παραγωγής ρυθμισμένες.
const bcrypt = require('bcryptjs');
const { assertStrongPassword } = require('../src/utils/password');
const pool = require('../src/db/pool');

(async () => {
  const [, , username, password] = process.argv;
  if (!username || !password) {
    console.error('Χρήση: node scripts/set_password.js <username> <νέος-κωδικός>');
    process.exit(1);
  }
  // Πολιτική κωδικών (15/11/2026): ισχύει ΜΟΝΟ για ΝΕΟΥΣ κωδικούς —
  // οι υπάρχοντες δεν θίγονται και κανείς δεν αναγκάζεται σε αλλαγή.
  assertStrongPassword(password, typeof username !== 'undefined' ? username : undefined);
  const hash = bcrypt.hashSync(password, 10);
  const [r] = await pool.query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, username]);
  console.log(
    r.affectedRows
      ? `OK: άλλαξε ο κωδικός του χρήστη «${username}».`
      : `Δεν βρέθηκε χρήστης «${username}».`
  );
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
