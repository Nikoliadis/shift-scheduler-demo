// Middleware ελέγχου σύνδεσης: όλα τα API εκτός του login απαιτούν session.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ ok: false, error: 'Απαιτείται σύνδεση' });
}

// RBAC (14/11/2026): ο ρόλος κρατιέται στο session από το login (users.is_admin)
// και ελέγχεται ΣΤΟ BACKEND. Δεν αρκεί να κρύβονται κουμπιά στο frontend —
// ούτε αλλαγή URL ούτε απευθείας κλήση API δίνει πρόσβαση σε employee.
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Απαιτείται σύνδεση' });
  }
  if (req.session.isAdmin !== true) {
    // 403 και ΟΧΙ λεπτομέρειες: ο employee δεν μαθαίνει τι υπάρχει πίσω
    return res.status(403).json({ ok: false, error: 'Δεν έχεις δικαίωμα πρόσβασης' });
  }
  next();
}

// Δικαίωμα ΕΓΓΡΑΦΗΣ σε agents (users.can_edit_agents).
//
// (15/11/2026) Ο έλεγχος υπήρχε inline ΜΟΝΟ στο PUT /:id· το POST / και το
// PUT /:id/active τον είχαν ΠΑΡΑΛΕΙΨΕΙ, οπότε χρήστης με can_edit_agents = 0
// μπορούσε να δημιουργήσει agent ή να απενεργοποιήσει υπάρχοντα με απευθείας
// κλήση API. Μπαίνει εδώ ως middleware ώστε να εφαρμόζεται ΟΜΟΙΟΜΟΡΦΑ και να
// μην μπορεί να ξεχαστεί σε μελλοντικό endpoint.
//
// Το μήνυμα και ο κωδικός 403 είναι ΑΚΡΙΒΩΣ τα ίδια με πριν, ώστε το frontend
// να μη χρειάζεται καμία αλλαγή.
function requireAgentEdit(req, res, next) {
  if (req.session && req.session.canEditAgents === false) {
    return res.status(403).json({ ok: false, error: 'Δεν έχεις δικαίωμα επεξεργασίας agents.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireAgentEdit };
