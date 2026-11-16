// Έλεγχος εξαημέρου που ΑΠΟΤΡΕΠΕΙ την οριστικοποίηση (14/11/2026).
//
// Μέχρι τώρα το 6ήμερο μόνο ΑΝΑΦΕΡΟΤΑΝ (report.soft / warnings). Απόφαση:
// δεν αποθηκεύεται και δεν εξάγεται σε Excel πρόγραμμα με εξαήμερο.
//
// Τι μετράει ως «συνεχόμενη ημέρα» (Κ10, απόφαση 13/07/2026):
//   - βάρδια                      → ναι
//   - άδεια / ασθένεια            → ναι (συνεχίζει τη σειρά)
//   - ρεπό                        → ΟΧΙ, κόβει τη σειρά
//
// ΟΜΩΣ: σειρά που αποτελείται ΜΟΝΟ από άδεια ΔΕΝ είναι εξαήμερο εργασίας —
// κανείς δεν δούλεψε. Παράβαση υπάρχει μόνο όταν ΔΟΥΛΕΨΕ την 6η (ή μετά)
// συνεχόμενη ημέρα. Έτσι ένας εργαζόμενος με 17 μέρες άδεια δεν μπλοκάρει
// την αποθήκευση, ενώ 5 μέρες άδεια + 1 βάρδια μπλοκάρει σωστά.
const { dayNum } = require('./time');
const { addDays } = require('../utils/dates');

const MAX_STREAK = 5;

// Μέρες που «μετράνε» ανά agent, από ένα σύνολο αναθέσεων
function collect(map, assignments, worked) {
  for (const a of assignments || []) {
    if (a.off && a.reason !== 'leave' && a.reason !== 'sick') continue; // ρεπό: κόβει
    if (!map.has(a.agentId)) map.set(a.agentId, new Map());
    const d = dayNum(a.date);
    // true = πραγματική βάρδια, false = άδεια/ασθένεια
    const isWork = !a.off;
    map.get(a.agentId).set(d, (map.get(a.agentId).get(d) || false) || isWork);
    if (isWork) worked.add(`${a.agentId}|${d}`);
  }
}

/**
 * Βρίσκει παραβιάσεις εξαημέρου.
 * @param {object} o
 * @param {Array}  o.assignments      η εβδομάδα που οριστικοποιείται
 * @param {Array}  [o.prevAssignments] προηγούμενη εβδομάδα (π.χ. από Excel import)
 * @param {Array}  [o.nextAssignments] επόμενη, αν είναι γνωστή
 * @param {object} [o.prevState]      κατάσταση όταν λείπουν οι prevAssignments
 * @param {Map}    [o.names]          agentId → όνομα, για ευανάγνωστο μήνυμα
 * @param {Set}    [o.exemptIds]      agents με no_streak_limit
 * @returns {Array} [{agentId, name, days, from, to, lastWorkDate}]
 */
function findSixDay({ assignments, prevAssignments, nextAssignments, prevState, names, exemptIds }) {
  const map = new Map();   // agentId → Map(dayNum → δούλεψε;)
  const worked = new Set();
  collect(map, prevAssignments, worked);
  collect(map, assignments, worked);
  collect(map, nextAssignments, worked);

  // Όταν λείπει η προηγούμενη εβδομάδα, χρησιμοποιούμε το αποθηκευμένο streak
  const carry = new Map();
  if ((!prevAssignments || prevAssignments.length === 0) && prevState) {
    for (const [id, st] of Object.entries(prevState)) {
      if (st && st.streak > 0) carry.set(Number(id), st.streak);
    }
  }

  const firstDay = Math.min(...(assignments || []).map((a) => dayNum(a.date)));
  const out = [];

  for (const [agentId, days] of map) {
    if (exemptIds && exemptIds.has(agentId)) continue;
    const sorted = [...days.keys()].sort((x, y) => x - y);
    let runStart = null;
    let prev = null;
    let lenBefore = 0;      // μέρες που κουβαλάει από την προηγούμενη εβδομάδα

    const close = (endDay) => {
      if (runStart === null) return;
      const runDays = [];
      for (let d = runStart; d <= endDay; d++) if (days.has(d)) runDays.push(d);
      const total = lenBefore + runDays.length;
      if (total <= MAX_STREAK) return;
      // Παράβαση ΜΟΝΟ αν δούλεψε την 6η ή μεταγενέστερη μέρα της σειράς
      const offending = runDays.filter((d, i) => lenBefore + i + 1 > MAX_STREAK && worked.has(`${agentId}|${d}`));
      if (!offending.length) return;
      out.push({
        agentId,
        name: (names && names.get(agentId)) || String(agentId),
        days: total,
        from: isoOf(runStart - lenBefore),
        to: isoOf(endDay),
        lastWorkDate: isoOf(offending[offending.length - 1])
      });
    };

    for (const d of sorted) {
      if (prev === null || d !== prev + 1) {
        close(prev);
        runStart = d;
        // Η σειρά ξεκινά στην 1η μέρα της εβδομάδας → κουβαλάει το streak
        lenBefore = (d === firstDay && carry.has(agentId)) ? carry.get(agentId) : 0;
      }
      prev = d;
    }
    close(prev);
  }
  return out;
}

const isoOf = (dn) => addDays('1970-01-01', dn);

// Ένα μήνυμα για τον χρήστη, έτοιμο για εμφάνιση
function describe(violations) {
  return violations
    .map((v) => `${v.name}: ${v.days} συνεχόμενες ημέρες (${v.from} → ${v.to}) — δούλεψε ${v.lastWorkDate}`)
    .join(' · ');
}


/**
 * ΚΑΝΟΝΑΣ 2 ΡΕΠΟ (15/11/2026) — ο σημαντικότερος κανόνας του συστήματος.
 *
 * Κάθε εργαζόμενος πρέπει να έχει ΤΟΥΛΑΧΙΣΤΟΝ 2 ημέρες ρεπό στην εβδομάδα.
 * Υπερισχύει ΑΠΟΛΥΤΑ των επιθυμητών ωρών, του scoring και της κάλυψης:
 * δεν θυσιάζεται ποτέ το δεύτερο ρεπό για να καλυφθεί βάρδια.
 *
 * Κατώφλι, όχι ακριβής αριθμός: 3+ ρεπό είναι ΝΟΜΙΜΑ και συμβαίνουν όταν
 * κάποιος δεν μπορεί να φτάσει τις 5 εργάσιμες (π.χ. σειρά από την
 * προηγούμενη εβδομάδα, ή καμία ελεύθερη θέση το ΣΚ). Αυτά αναφέρονται
 * χωριστά (`extraOff`) και ΔΕΝ μπλοκάρουν — αλλιώς δεν θα αποθηκευόταν
 * κανένα πρόγραμμα.
 *
 * Οι ημέρες άδειας/ασθένειας ΜΕΤΡΑΝΕ ως μη-εργάσιμες εδώ: ο εργαζόμενος
 * πράγματι δεν δουλεύει. (Για τη ΣΕΙΡΑ συνεχόμενων ημερών ισχύει το
 * αντίθετο — βλ. findSixDay.)
 *
 * @returns {{violations: Array, extraOff: Array}}
 */
function findLowRest({ assignments, dates, names }) {
  const worked = new Map();  // agentId → Set(date) με ΠΡΑΓΜΑΤΙΚΗ βάρδια
  const seen = new Map();    // agentId → Set(date) με οποιαδήποτε εγγραφή
  for (const a of assignments || []) {
    if (!worked.has(a.agentId)) { worked.set(a.agentId, new Set()); seen.set(a.agentId, new Set()); }
    seen.get(a.agentId).add(a.date);
    if (!a.off) worked.get(a.agentId).add(a.date);
  }

  // Οι 7 ημέρες της εβδομάδας: από το dates όταν δίνεται, αλλιώς από τα δεδομένα
  let days = dates;
  if (!days || !days.length) {
    const all = new Set();
    for (const a of assignments || []) all.add(a.date);
    days = [...all].sort();
  }

  const violations = [];
  const extraOff = [];
  for (const [agentId, w] of worked) {
    // Αγνόησε όποιον δεν εμφανίζεται καθόλου στην εβδομάδα
    if (!seen.get(agentId).size) continue;
    const workDays = days.filter((d) => w.has(d)).length;
    const offDays = days.length - workDays;
    const row = { agentId, name: (names && names.get(agentId)) || String(agentId), workDays, offDays };
    if (offDays < 2) violations.push(row);
    else if (offDays > 2) extraOff.push(row);
  }
  violations.sort((a, b) => a.offDays - b.offDays || a.name.localeCompare(b.name, 'el'));
  extraOff.sort((a, b) => a.name.localeCompare(b.name, 'el'));
  return { violations, extraOff };
}

// Μήνυμα για τον χρήστη
function describeRest(violations) {
  return violations
    .map((v) => `${v.name}: ${v.workDays} ημέρες εργασίας, μόνο ${v.offDays} ρεπό`)
    .join(' · ');
}


/**
 * ΚΑΝΟΝΑΣ «ΑΚΡΙΒΩΣ 5 ΕΡΓΑΣΙΜΕΣ / 2 ΡΕΠΟ» (15/11/2026).
 *
 * Στόχος ανά εργαζόμενο = ο ΙΔΙΟΣ που χρησιμοποιεί ο generator:
 *     workTarget = max(0, 5 − ημέρες άδειας/ασθένειας)
 * Έτσι η άδεια εξαιρείται αυτόματα: 2 ημέρες άδεια → στόχος 3 εργάσιμες.
 *
 * Διάκριση ΔΥΟ ειδών απόκλισης — καθοριστική για το αν μπλοκάρει:
 *
 *   blocking   Ο εργαζόμενος ΜΠΟΡΟΥΣΕ να πιάσει τον στόχο (είχε αρκετές
 *              διαθέσιμες ημέρες) αλλά δεν τον έπιασε, Ή δουλεύει
 *              ΠΑΡΑΠΑΝΩ από τον στόχο. Φταίει η κατανομή → δεν οριστικοποιείται.
 *
 *   impossible Ο εργαζόμενος ΔΕΝ ΕΧΕΙ αρκετές διαθέσιμες ημέρες (άδειες,
 *              σταθερά ρεπό, weekly_schedule, περιορισμοί ωραρίου). Κανένας
 *              αλγόριθμος δεν το λύνει με τα σημερινά δεδομένα → ΑΝΑΦΕΡΕΤΑΙ
 *              με την αιτία, ΔΕΝ μπλοκάρει.
 *
 * Η διάκριση είναι ρητή απαίτηση: «Αν δεν είναι εφικτή η κάλυψη όλων των
 * θέσεων με αυτούς τους περιορισμούς, να εμφανίζει τις ακάλυπτες θέσεις και
 * την αιτία» — δηλαδή ανέφερε το αδύνατο, μην το κρύβεις και μην κολλήσεις.
 */
// ΔΙΑΚΟΠΤΗΣ ΕΠΙΒΟΛΗΣ του «ακριβώς 5 εργάσιμες / 2 ρεπό».
//
//   false (προεπιλογή) → ΑΝΑΦΕΡΕΤΑΙ έντονα στην απόκριση, ΔΕΝ μπλοκάρει
//   true               → ΜΠΛΟΚΑΡΕΙ την αποθήκευση και το export
//
// ΓΙΑΤΙ ΔΕΝ ΕΙΝΑΙ ΗΔΗ true (μέτρηση 15/11/2026, 9 εβδομάδες σε αντίγραφο
// παραγωγής): με τα σημερινά headcount ο generator αφήνει 35 εργαζόμενους
// κάτω από τον στόχο, σε ΚΑΙ ΤΙΣ 9 εβδομάδες. Αν γινόταν true σήμερα, ΚΑΜΙΑ
// εβδομάδα δεν θα αποθηκευόταν. Κυριαρχούν δύο δομικές περιπτώσεις:
//   · ΧΡΙΣΤΟΔΟΥΛΟΥ ΤΑΣΙΑ (9/9): 4 supervisors για 2 θέσεις/καθημερινή +
//     4 θέσεις ΣΚ = 14 θέσεις έναντι 20 ανθρωποημερών
//   · ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ (8/9): ο weekly_schedule κλείνει Τετ+Πεμ, άρα
//     έχει ΑΚΡΙΒΩΣ 5 διαθέσιμες ημέρες και πρέπει να πιάνει ΚΑΙ ΤΙΣ ΔΥΟ
//     ημέρες ΣΚ κάθε εβδομάδα
// Γίνεται true μόλις ο αριθμός πέσει στο μηδέν (ή αυξηθούν οι θέσεις).
const EXACT_DAYS_ENFORCED = false;

function findExactDays({ agents, assignments, dates, leaveByAgent, availByAgent }) {
  const worked = new Map();
  for (const a of assignments || []) {
    if (a.off) continue;
    if (!worked.has(a.agentId)) worked.set(a.agentId, new Set());
    worked.get(a.agentId).add(a.date);   // ΗΜΕΡΕΣ, όχι γραμμές (σπαστά ωράρια)
  }

  const blocking = [];
  const impossible = [];
  for (const ag of agents) {
    const leave = (leaveByAgent && leaveByAgent.get(ag.id)) || 0;
    const target = Math.max(0, 5 - leave);
    const days = (worked.get(ag.id) || new Set()).size;
    if (days === target) continue;

    const avail = availByAgent ? (availByAgent.get(ag.id) || 0) : dates.length - leave;
    const row = { agentId: ag.id, name: ag.name, workDays: days, target, leave, avail };

    if (days > target) {
      row.reason = `δουλεύει ${days} ημέρες αντί για ${target}`;
      blocking.push(row);
    } else if (avail < target) {
      row.reason = leave
        ? `${leave} ημέρες άδειας — διαθέσιμες μόνο ${avail}, στόχος ${target}`
        : `διαθέσιμες μόνο ${avail} ημέρες (σταθερά ρεπό / περιορισμοί ωραρίου), στόχος ${target}`;
      impossible.push(row);
    } else {
      row.reason = `${days} ημέρες αντί για ${target} ενώ είχε ${avail} διαθέσιμες`;
      blocking.push(row);
    }
  }
  const srt = (a, b) => a.name.localeCompare(b.name, 'el');
  return { blocking: blocking.sort(srt), impossible: impossible.sort(srt) };
}

function describeExact(rows) {
  return rows.map((v) => `${v.name}: ${v.reason}`).join(' · ');
}

/**
 * Φορτώνει ό,τι χρειάζεται και ελέγχει τον κανόνα για μία εβδομάδα.
 * Οι διαθέσιμες ημέρες υπολογίζονται με τα ΠΡΑΓΜΑΤΙΚΑ predicates του engine
 * (shiftAllowedByRules πάνω στα ωράρια του συστήματος) — όχι με αντίγραφο.
 */
async function checkExactDays(pool, weekStart, assignments) {
  const { addDays: add } = require('../utils/dates');
  const { loadContext } = require('./context');
  const eng = require('./engine');

  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(add(weekStart, i));
  const ctx = await loadContext(dates[0], dates[6]);

  // Ωράρια του συστήματος για τον έλεγχο διαθεσιμότητας
  const [rows] = await pool.query('SELECT DISTINCT start_time s, end_time e FROM shift_requirements');
  const probe = new Map();
  for (const r of rows) probe.set(`${String(r.s).slice(0, 5)}-${String(r.e).slice(0, 5)}`, [String(r.s).slice(0, 5), String(r.e).slice(0, 5)]);
  for (const [s, e] of [...eng.FILLER_MORNING, ...eng.FILLER_AFTERNOON]) probe.set(`${s}-${e}`, [s, e]);
  // Σπαστά ωράρια: τα μέρη τους είναι νόμιμες βάρδιες για τον κάτοχο του κανόνα
  for (const a of ctx.agents) {
    const sp = eng.rule(a, 'split_shift');
    if (sp) for (const [s, e] of sp.parts) probe.set(`${s}-${e}`, [s, e]);
  }
  const SHIFTS = [...probe.values()];

  const leaveByAgent = new Map();
  const availByAgent = new Map();
  for (const a of ctx.agents) {
    let leave = 0;
    let avail = 0;
    for (let d = 0; d < 7; d++) {
      if (ctx.timeOff.get(`${a.id}|${dates[d]}`)) { leave++; continue; }
      if ((a.fixedDaysOff || []).includes(d + 1)) continue;
      if (SHIFTS.some(([s, e]) => eng.shiftAllowedByRules(a, d, s, e, { date: dates[d] }))) avail++;
    }
    leaveByAgent.set(a.id, leave);
    availByAgent.set(a.id, avail);
  }

  return findExactDays({ agents: ctx.agents, assignments, dates, leaveByAgent, availByAgent });
}

/**
 * Φορτώνει ονόματα και ελέγχει τον κανόνα των 2 ρεπό για μία εβδομάδα.
 * Κοινό για αποθήκευση και export, ώστε να μην αποκλίνουν οι έλεγχοι.
 */
async function checkRest(pool, weekStart, assignments) {
  const { addDays: add } = require('../utils/dates');
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(add(weekStart, i));
  const [agents] = await pool.query('SELECT id, full_name FROM agents');
  const names = new Map(agents.map((a) => [a.id, a.full_name]));
  return findLowRest({ assignments, dates, names });
}

/**
 * Φορτώνει ό,τι χρειάζεται από τη βάση και ελέγχει μία εβδομάδα.
 * Κοινό για αποθήκευση και για export, ώστε να μην αποκλίνουν οι έλεγχοι.
 * @returns {Promise<Array>} οι παραβιάσεις (κενό = εντάξει)
 */
async function checkWeek(pool, weekStart, assignments) {
  const { addDays: add } = require('../utils/dates');
  const prevStart = add(weekStart, -7);
  const nextStart = add(weekStart, 7);

  const [[prevRow]] = await pool.query(
    'SELECT data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1', [prevStart]
  );
  const [[nextRow]] = await pool.query(
    'SELECT data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1', [nextStart]
  );
  const [[stateRow]] = await pool.query(
    'SELECT data FROM schedules WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1', [weekStart]
  );
  const parse = (row, key) => {
    if (!row) return null;
    try { return JSON.parse(row.data)[key] || null; } catch { return null; }
  };

  // Ονόματα + όσοι εξαιρούνται από το 6ήμερο (no_streak_limit)
  const [agents] = await pool.query('SELECT id, full_name FROM agents');
  const names = new Map(agents.map((a) => [a.id, a.full_name]));
  const [rules] = await pool.query('SELECT agent_id, rule FROM agent_constraints WHERE rule IS NOT NULL');
  const exemptIds = new Set();
  for (const r of rules) {
    try {
      const parsed = typeof r.rule === 'string' ? JSON.parse(r.rule) : r.rule;
      if (parsed && parsed.type === 'no_streak_limit') exemptIds.add(r.agent_id);
    } catch { /* αγνόησέ το */ }
  }

  return findSixDay({
    assignments,
    prevAssignments: parse(prevRow, 'assignments'),
    nextAssignments: parse(nextRow, 'assignments'),
    prevState: parse(stateRow, 'state'),
    names,
    exemptIds
  });
}

module.exports = {
  findSixDay, describe, checkWeek,
  findLowRest, describeRest, checkRest,
  findExactDays, describeExact, checkExactDays, EXACT_DAYS_ENFORCED,
  MAX_STREAK
};
