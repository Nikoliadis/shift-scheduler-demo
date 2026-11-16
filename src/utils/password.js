// ==================== ΠΟΛΙΤΙΚΗ ΚΩΔΙΚΩΝ (15/11/2026) ====================
//
// Ισχύει ΜΟΝΟ όταν ορίζεται ΝΕΟΣ κωδικός (δημιουργία χρήστη, αλλαγή κωδικού).
// ΔΕΝ ακυρώνει και ΔΕΝ επαναφέρει υπάρχοντες κωδικούς — καμία διακοπή για
// τους σημερινούς χρήστες.
//
// Βασισμένη στις συστάσεις NIST SP 800-63B: προτεραιότητα στο ΜΗΚΟΣ και στον
// αποκλεισμό προβλέψιμων επιλογών, αντί για υποχρεωτικά σύμβολα που οδηγούν
// σε μοτίβα τύπου «Password1!».

const MIN_LENGTH = 12;

// Μικρή λίστα προφανών επιλογών. Δεν αντικαθιστά πλήρη λίστα παραβιασμένων
// κωδικών — αποτρέπει όμως τις χειρότερες περιπτώσεις.
const COMMON = new Set([
  'password', 'password1', 'password123', '123456', '1234567', '12345678',
  '123456789', '1234567890', 'qwerty', 'qwerty123', 'admin', 'admin123',
  'administrator', 'welcome', 'welcome1', 'letmein', 'iloveyou', 'abc123',
  'passw0rd', 'p@ssw0rd', 'monkey', 'dragon', 'football', 'baseball',
  'master', 'login', 'test', 'test123', 'guest', 'changeme', 'secret',
  '111111', '000000', 'aaaaaa', 'κωδικος', 'κωδικός'
]);

/**
 * Ελέγχει έναν ΝΕΟ κωδικό.
 * @param {string} password
 * @param {string} [username] για να μην είναι ο κωδικός το ίδιο το username
 * @returns {string[]} λίστα προβλημάτων (κενή = εντάξει)
 */
function validatePassword(password, username) {
  const errors = [];
  const pw = String(password == null ? '' : password);

  if (pw.length < MIN_LENGTH) {
    errors.push(`Ο κωδικός πρέπει να έχει τουλάχιστον ${MIN_LENGTH} χαρακτήρες (έχει ${pw.length}).`);
  }
  if (pw.trim() !== pw) {
    errors.push('Ο κωδικός δεν πρέπει να ξεκινά ή να τελειώνει με κενό.');
  }
  const low = pw.toLowerCase();
  if (COMMON.has(low)) {
    errors.push('Ο κωδικός είναι από τους πιο συνηθισμένους — διάλεξε άλλον.');
  }
  if (username && low === String(username).toLowerCase()) {
    errors.push('Ο κωδικός δεν επιτρέπεται να είναι ίδιος με το όνομα χρήστη.');
  }
  if (username && low.includes(String(username).toLowerCase()) && String(username).length >= 4) {
    errors.push('Ο κωδικός δεν πρέπει να περιέχει το όνομα χρήστη.');
  }
  if (/^(.)\1+$/.test(pw)) {
    errors.push('Ο κωδικός δεν μπορεί να είναι ο ίδιος χαρακτήρας επαναλαμβανόμενος.');
  }
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(pw)) {
    errors.push('Ο κωδικός δεν πρέπει να είναι απλή ακολουθία πληκτρολογίου.');
  }
  return errors;
}

// Για χρήση σε CLI scripts: τυπώνει τα προβλήματα και σταματά
function assertStrongPassword(password, username) {
  const errors = validatePassword(password, username);
  if (errors.length) {
    console.error('Ο κωδικός δεν πληροί την πολιτική ασφαλείας:');
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
}

module.exports = { validatePassword, assertStrongPassword, MIN_LENGTH };
