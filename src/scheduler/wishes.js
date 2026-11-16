// ==================== ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ ΕΡΓΑΣΙΑΣ (15/11/2026) ====================
//
// Soft αιτήματα εργαζομένων για συγκεκριμένο ωράριο σε συγκεκριμένη ημερομηνία.
//
// ΒΑΣΙΚΗ ΑΡΧΗ: τα αιτήματα προσαρμόζονται στο πρόγραμμα, ΟΧΙ το πρόγραμμα στα
// αιτήματα. Κανένα αίτημα δεν υπερισχύει υποχρεωτικού κανόνα (άδειες Κ6, 11ωρη
// ανάπαυση Κ8, 6ήμερο Κ2/Κ10, ατομικοί κανόνες Κ3/Κ5, απαιτήσεις κάλυψης Κ1).
//
// Σειρά προτεραιότητας (δεν αλλάζει από αυτό το module):
//   1. Υποχρεωτικά constraints / νομιμότητα
//   2. Κάλυψη όλων των απαιτούμενων ωρών και θέσεων
//   3. Υφιστάμενη λογική κατανομής και scoring
//   4. Ικανοποίηση επιθυμητών ωρών — ΜΟΝΟ όπου είναι εφικτό
//
// Το module είναι σκόπιμα ΧΩΡΙΣ βάση και ΧΩΡΙΣ εξάρτηση από τον engine, ώστε
// να ελέγχεται απομονωμένα. Ο engine δίνει ο ίδιος τα predicates του μέσω
// της παραμέτρου `probe` (dependency injection) — έτσι η αιτιολόγηση βγαίνει
// από τους ΠΡΑΓΜΑΤΙΚΟΥΣ ελέγχους του generator και όχι από αντίγραφό τους.

const { toMin, shiftAbs, isMorning, isAfternoon } = require('./time');

// Βάρη στο scoring. ΣΚΟΠΙΜΑ ΜΙΚΡΑ: η παράγραφος 4 της προδιαγραφής βάζει τα
// αιτήματα ΚΑΤΩ από την υφιστάμενη λογική κατανομής, άρα το μπόνους πρέπει να
// λειτουργεί ως tie-breaker — να κρίνει μόνο μεταξύ υποψηφίων που η υπάρχουσα
// λογική θεωρεί σχεδόν ισοδύναμους. Για σύγκριση, υπάρχοντα βάρη του engine:
//   κάλυψη ΣΚ needWknd*60 · sunday_worker +40 · prefer_morning +20
//   avoid_weekend_62 −300 · escort −200 · prefer_morning strong −250
// Με +12 ένα αίτημα ΔΕΝ μπορεί να ανατρέψει καμία από αυτές τις αποφάσεις.
//
// Η ΠΡΑΓΜΑΤΙΚΗ ικανοποίηση των αιτημάτων δεν προέρχεται από αυτά τα βάρη αλλά
// από την αναδιάταξη των υποψήφιων ωραρίων (preferredOrder): ίδιο άτομο, ίδια
// θέση, ίδια κάλυψη — απλώς η ώρα που ζήτησε δοκιμάζεται πρώτη.
const WISH_BONUS_EXACT = 12;    // τοποθέτηση ακριβώς στο αιτούμενο ωράριο
const WISH_BONUS_PARTIAL = 4;   // συμβατό ωράριο (ίδια κατηγορία, επικάλυψη ≥50%)
const WISH_OFF_PENALTY = 10;    // ρεπό σε μέρα με αίτημα εργασίας

// Ποινή όταν η τοποθέτηση σε ΜΙΑ μέρα κάνει ΑΝΕΦΙΚΤΗ μεταγενέστερη μέρα που
// ζήτησε ο ΙΔΙΟΣ ο εργαζόμενος (θα ξεπερνούσε τις 5 συνεχόμενες — Κ10).
// Μεγαλύτερη από τα υπόλοιπα βάρη επειδή δεν εκφράζει προτίμηση αλλά
// ΑΔΥΝΑΜΙΑ: χωρίς αυτήν το αίτημα είναι μαθηματικά ανέφικτο, όχι απλώς
// λιγότερο πιθανό. Παραμένει soft — αν ο agent είναι ο μόνος υποψήφιος για
// τη θέση, την παίρνει κανονικά και η κάλυψη δεν θυσιάζεται ποτέ.
const WISH_BLOCK_PENALTY = 60;

// Ποινή όταν σε μέρα ΜΕ αίτημα δίνεται ΑΣΥΜΒΑΤΗ βάρδια.
// Κάθε εργαζόμενος δουλεύει μία βάρδια την ημέρα (Κ2): αν πάρει το πρωινό
// της Παρασκευής, το απόγευμα που ζήτησε γίνεται αδύνατο — δεν είναι απλώς
// «λιγότερο προτιμητέο». Χωρίς αυτήν την ποινή το μπόνους των +12 δεν
// προλαβαίνει καν να παίξει, γιατί η μέρα έχει ήδη καταναλωθεί.
// Soft: αν ο agent είναι ο μόνος υποψήφιος για τη θέση, την παίρνει κανονικά.
const WISH_CONFLICT_PENALTY = 40;

// Ελάχιστη επικάλυψη για να θεωρηθεί ένα ωράριο «μερικώς» συμβατό
const PARTIAL_MIN_RATIO = 0.5;

const STATUS = {
  OK: 'satisfied',
  PARTIAL: 'partial',
  NO: 'unsatisfied'
};

const STATUS_LABEL = {
  satisfied: 'Ικανοποιήθηκε',
  partial: 'Ικανοποιήθηκε μερικώς',
  unsatisfied: 'Δεν ικανοποιήθηκε'
};

// ---------- Κατηγορία ημι-ημέρας ----------
// Χρησιμοποιεί τους ΥΠΑΡΧΟΝΤΕΣ ορισμούς του time.js — δεν φτιάχνει δεύτερους.
//   morning   : έναρξη 05:00-11:59 χωρίς μεσάνυχτα  (06:00-14:00, 08:00-16:00, 10:00-18:00)
//   afternoon : έναρξη 12:00-18:59                  (14:00-22:00, 15:30-23:30, 16:00-24:00)
//   evening   : έναρξη 19:00 και μετά               (23:00-07:00, 23:30-07:30)
function shiftClass(start, end) {
  if (toMin(start) >= 1140) return 'evening';
  if (isMorning(start, end)) return 'morning';
  if (isAfternoon(start)) return 'afternoon';
  return 'other';
}

// ---------- Επικάλυψη δύο ωραρίων σε λεπτά ----------
// Και τα δύο αποτιμώνται στην ΙΔΙΑ ημερομηνία, ώστε οι βάρδιες που περνούν
// μεσάνυχτα (23:00-07:00) να συγκρίνονται σωστά.
function overlapMinutes(date, aStart, aEnd, bStart, bEnd) {
  const a = shiftAbs(date, aStart, aEnd);
  const b = shiftAbs(date, bStart, bEnd);
  return Math.max(0, Math.min(a.endAbs, b.endAbs) - Math.max(a.startAbs, b.startAbs));
}

function durationMinutes(date, start, end) {
  const { startAbs, endAbs } = shiftAbs(date, start, end);
  return endAbs - startAbs;
}

// ---------- ΕΛΕΓΧΟΣ ΣΥΜΒΑΤΟΤΗΤΑΣ (παράγραφος 1 της προδιαγραφής) ----------
//
// Επιστρέφει { status, overlap, ratio, sameClass }.
//
// ΑΥΣΤΗΡΟΣ ΚΑΝΟΝΑΣ: για να θεωρηθεί ένα ωράριο έστω και «μερικώς» συμβατό
// πρέπει να ισχύουν ΚΑΙ ΤΑ ΔΥΟ:
//   (α) ίδια κατηγορία ημι-ημέρας, και
//   (β) επικάλυψη τουλάχιστον 50% των αιτούμενων ωρών.
// Έτσι ένα πρωινό 06:00-14:00 ΔΕΝ μπορεί ΠΟΤΕ να «ικανοποιήσει» αίτημα για
// 16:00-24:00 — ούτε μερικώς — όπως απαιτεί ρητά η προδιαγραφή.
function compatibility(date, wish, start, end) {
  const exact = start === wish.start_time && end === wish.end_time;
  if (exact) return { status: STATUS.OK, overlap: durationMinutes(date, start, end), ratio: 1, sameClass: true };

  const sameClass = shiftClass(start, end) === shiftClass(wish.start_time, wish.end_time);
  const want = durationMinutes(date, wish.start_time, wish.end_time);
  const overlap = overlapMinutes(date, wish.start_time, wish.end_time, start, end);
  const ratio = want > 0 ? overlap / want : 0;

  if (sameClass && ratio >= PARTIAL_MIN_RATIO) return { status: STATUS.PARTIAL, overlap, ratio, sameClass };
  return { status: STATUS.NO, overlap, ratio, sameClass };
}

// ---------- Μπόνους scoring ----------
// Καλείται από τον engine ΜΕΣΑ στο υπάρχον scoring, ως ένας ακόμη soft όρος.
// Επιστρέφει 0 όταν δεν υπάρχει αίτημα — δηλαδή για όποιον δεν έχει αίτημα η
// συμπεριφορά του generator παραμένει ΑΚΡΙΒΩΣ η σημερινή.
function scoreBonus(wish, date, start, end) {
  if (!wish) return 0;
  const c = compatibility(date, wish, start, end);
  if (c.status === STATUS.OK) return WISH_BONUS_EXACT;
  if (c.status === STATUS.PARTIAL) return WISH_BONUS_PARTIAL;
  return 0;
}

// Ποινή για ασύμβατη βάρδια σε μέρα με αίτημα (βλ. WISH_CONFLICT_PENALTY).
// 0 όταν δεν υπάρχει αίτημα ή όταν η βάρδια είναι έστω μερικώς συμβατή.
function conflictPenalty(wish, date, start, end) {
  if (!wish) return 0;
  return compatibility(date, wish, start, end).status === STATUS.NO ? WISH_CONFLICT_PENALTY : 0;
}

// ---------- Αναδιάταξη υποψήφιων ωραρίων ----------
// Ο ΚΥΡΙΟΣ μηχανισμός ικανοποίησης. Βάζει μπροστά το ωράριο που ζητήθηκε,
// ΧΩΡΙΣ να αφαιρεί ή να προσθέτει επιλογές: η λίστα παραμένει η ίδια, αλλάζει
// μόνο η σειρά δοκιμής. Αν το αιτούμενο ωράριο δεν περνά τους ελέγχους
// (canPlace), ο engine προχωρά στο επόμενο ακριβώς όπως σήμερα.
//
// ΟΤΑΝ ΔΕΝ ΥΠΑΡΧΕΙ ΑΙΤΗΜΑ επιστρέφει την ΙΔΙΑ αναφορά πίνακα (όχι αντίγραφο),
// ώστε να είναι προφανές ότι δεν μεσολαβεί καμία αλλαγή.
function preferredOrder(options, wish, date) {
  if (!wish || !Array.isArray(options) || options.length < 2) return options;
  const scored = options.map((opt, i) => {
    const c = compatibility(date, wish, opt[0], opt[1]);
    const rank = c.status === STATUS.OK ? 0 : c.status === STATUS.PARTIAL ? 1 : 2;
    return { opt, rank, i, ratio: c.ratio };
  });
  // Ταξινόμηση:
  //   1. πρώτα κατά συμβατότητα (ακριβής → μερική → ασύμβατη)
  //   2. μέσα στις ΣΥΜΒΑΤΕΣ, η πιο κοντινή πρώτη (μεγαλύτερη επικάλυψη)
  //   3. ισοπαλία → διατηρείται η αρχική σειρά προτίμησης του engine
  //
  // Οι ΑΣΥΜΒΑΤΕΣ (rank 2) ΔΕΝ αναταξινομούνται ποτέ: όταν το αίτημα δεν μπορεί
  // να ικανοποιηθεί από καμία επιλογή, η σειρά μένει ΑΚΡΙΒΩΣ η σημερινή και ο
  // generator συμπεριφέρεται σαν να μην υπήρχε αίτημα.
  scored.sort((x, y) => {
    if (x.rank !== y.rank) return x.rank - y.rank;
    if (x.rank < 2 && y.ratio !== x.ratio) return y.ratio - x.ratio;
    return x.i - y.i;
  });
  return scored.map((x) => x.opt);
}

// ---------- Προσθήκη του αιτούμενου ωραρίου στις επιλογές ----------
// Χρησιμοποιείται ΜΟΝΟ από τη φάση συμπλήρωσης (fillers), όπου ο generator
// διαλέγει ελεύθερα ωράριο για να φτάσει ο agent τις 5 εργάσιμες.
//
// Αν ο εργαζόμενος ζήτησε ωράριο που δεν είναι στη λίστα των fillers (π.χ.
// 12:00-20:00), προστίθεται ΜΠΡΟΣΤΑ ως υποψήφιο — ακριβώς όπως κάνει ήδη ο
// κανόνας κοινής βάρδιας ζεύγους (prefer_same_shift) στον engine.
//
// ΔΕΝ χρησιμοποιείται στη φάση απαιτήσεων: εκεί οι θέσεις έχουν συγκεκριμένο
// ωράριο και δεν επιτρέπεται να καλυφθούν με άλλες ώρες.
//
// Το νέο υποψήφιο ωράριο περνά τον ΙΔΙΟ canPlace με όλα τα άλλα, άρα δεν
// παρακάμπτεται κανένας κανόνας. Αν δεν περάσει, ο engine συνεχίζει κανονικά.
function withWishOption(options, wish, date) {
  const ordered = preferredOrder(options, wish, date);
  if (!wish) return ordered;
  const want = [wish.start_time, wish.end_time];
  if (ordered.some(([s, e]) => s === want[0] && e === want[1])) return ordered;
  return [want, ...ordered];
}

// ---------- Χάρτης αιτημάτων ----------
// ctx.wishes είναι flat λίστα από τη βάση. Ο engine θέλει O(1) πρόσβαση
// ανά (agentId, date).
function indexWishes(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(`${r.agent_id}|${r.date}`, r);
  return m;
}

function wishFor(index, agentId, date) {
  return (index && index.get(`${agentId}|${date}`)) || null;
}

// ---------- ΑΞΙΟΛΟΓΗΣΗ ΑΠΟΤΕΛΕΣΜΑΤΩΝ ----------
//
// wishes   : [{ id, agent_id, date, start_time, end_time, notes, full_name }]
// entryFor : (agentId, date) → { type:'work'|'off', start, end, reqLabel, offType } | null
// probe    : προαιρετικό (agentId, date, start, end) → string|null
//            Ο engine δίνει εδώ τους ΠΡΑΓΜΑΤΙΚΟΥΣ του ελέγχους ώστε η
//            αιτιολόγηση να μην είναι εικασία.
//
// Επιστρέφει έναν πίνακα αποτελεσμάτων, ένα ανά αίτημα.
function evaluate(wishes, entryFor, probe) {
  const out = [];
  for (const w of wishes || []) {
    const name = w.full_name || `agent ${w.agent_id}`;
    const want = `${w.start_time}-${w.end_time}`;
    const e = entryFor(w.agent_id, w.date);

    // --- Δεν δουλεύει εκείνη τη μέρα ---
    if (!e || e.type !== 'work') {
      let reason;
      if (e && e.type === 'off' && e.offType === 'leave') reason = 'άδεια εκείνη την ημέρα (Κ6) — η άδεια υπερισχύει του αιτήματος';
      else if (e && e.type === 'off' && e.offType === 'sick') reason = 'ασθένεια εκείνη την ημέρα (Κ6)';
      else if (e && e.type === 'off' && e.offType === 'repo_request') reason = 'αίτημα ρεπό την ίδια ημέρα — αντικρουόμενες καταχωρήσεις';
      else reason = (probe && probe(w.agent_id, w.date, w.start_time, w.end_time)) || 'ρεπό εκείνη την ημέρα';
      out.push({
        id: w.id, agentId: w.agent_id, name, date: w.date, want, notes: w.notes || null,
        status: STATUS.NO, got: null, ratio: 0, reason
      });
      continue;
    }

    // --- Δουλεύει: έλεγχος συμβατότητας ---
    const got = `${e.start}-${e.end}`;
    const c = compatibility(w.date, w, e.start, e.end);
    let reason = null;
    if (c.status === STATUS.PARTIAL) {
      reason = `τοποθετήθηκε σε συμβατή βάρδια ${got} (επικάλυψη ${Math.round(c.ratio * 100)}%)`;
    } else if (c.status === STATUS.NO) {
      const why = probe && probe(w.agent_id, w.date, w.start_time, w.end_time);
      reason = why
        ? `τοποθετήθηκε σε ${got}· το αιτούμενο ${want} δεν ήταν εφικτό: ${why}`
        : `τοποθετήθηκε σε ${got}, ασύμβατη με το αιτούμενο ${want}`
          + (c.sameClass ? ` (επικάλυψη μόνο ${Math.round(c.ratio * 100)}%)` : ' (διαφορετική κατηγορία βάρδιας)');
    }
    out.push({
      id: w.id, agentId: w.agent_id, name, date: w.date, want, notes: w.notes || null,
      status: c.status, got, ratio: c.ratio, reason
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'el'));
  return out;
}

// Σύνοψη για το UI και τα tests
function summarize(results) {
  const s = { total: results.length, satisfied: 0, partial: 0, unsatisfied: 0 };
  for (const r of results) {
    if (r.status === STATUS.OK) s.satisfied++;
    else if (r.status === STATUS.PARTIAL) s.partial++;
    else s.unsatisfied++;
  }
  s.pct = s.total ? Math.round(((s.satisfied + s.partial) / s.total) * 100) : 0;
  return s;
}

module.exports = {
  STATUS, STATUS_LABEL,
  WISH_BONUS_EXACT, WISH_BONUS_PARTIAL, WISH_OFF_PENALTY, WISH_BLOCK_PENALTY,
  WISH_CONFLICT_PENALTY, PARTIAL_MIN_RATIO,
  shiftClass, overlapMinutes, durationMinutes, compatibility,
  scoreBonus, conflictPenalty, preferredOrder, withWishOption, indexWishes, wishFor, evaluate, summarize
};
