// ==================== ΑΣΦΑΛΗΣ ΧΕΙΡΙΣΜΟΣ ΣΦΑΛΜΑΤΩΝ (15/11/2026) ====================
//
// Πριν: 23 endpoints επέστρεφαν `err.message` κατευθείαν στον client. Σε
// σφάλμα βάσης αυτό αποκαλύπτει ονόματα πινάκων και στηλών, SQL και δομή
// σχήματος — πολύτιμη πληροφορία για επιτιθέμενο και άχρηστη για τον χρήστη.
//
// Τώρα: η πραγματική αιτία πηγαίνει ΜΟΝΟ στα logs του server· ο client
// παίρνει γενικό μήνυμα. Τα μηνύματα ΕΠΙΚΥΡΩΣΗΣ (4xx) δεν θίγονται καθόλου —
// είναι γραμμένα για τον χρήστη και πρέπει να τα βλέπει.

const GENERIC = 'Προσωρινό πρόβλημα. Δοκίμασε ξανά.';

// Σφάλματα που ΠΡΟΟΡΙΖΟΝΤΑΙ για τον χρήστη φέρουν status 4xx (π.χ. err400
// στο import). Αυτά περνούν αυτούσια· όλα τα υπόλοιπα κρύβονται.
function isClientError(err) {
  const st = err && err.status;
  return Number.isInteger(st) && st >= 400 && st < 500;
}

/**
 * Απάντηση σε σφάλμα μέσα σε handler.
 * @param {object} res   Express response
 * @param {Error}  err   το σφάλμα
 * @param {string} where αναγνωριστικό για τα logs (π.χ. 'agents.create')
 */
function fail(res, err, where) {
  if (isClientError(err)) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  // ΠΟΤΕ δεν καταγράφουμε body/credentials — μόνο σημείο και μήνυμα σφάλματος
  console.error(`[error] ${where}:`, (err && err.message) || err);
  if (res.headersSent) return undefined;
  return res.status(500).json({ ok: false, error: GENERIC });
}

/**
 * Τελευταίο δίχτυ του Express: πιάνει ό,τι ξέφυγε (π.χ. κακοσχηματισμένο
 * JSON από το body-parser) ώστε να μη φύγει ποτέ stack trace προς τα έξω.
 * Μπαίνει ΤΕΛΕΥΤΑΙΟ, μετά από όλα τα routes.
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (isClientError(err)) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  // Κακοσχηματισμένο JSON ή υπέρβαση ορίου body: χρήσιμο να το ξέρει ο χρήστης
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Μη έγκυρο JSON στο αίτημα' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Το αίτημα είναι πολύ μεγάλο' });
  }
  console.error('[error] unhandled:', (err && err.message) || err);
  return res.status(500).json({ ok: false, error: GENERIC });
}

module.exports = { fail, errorHandler, GENERIC };
