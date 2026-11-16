// API προγράμματος: παραγωγή, live έλεγχος χειροκίνητων αλλαγών,
// αποθήκευση/φόρτωση εβδομάδων.
const express = require('express');
const { fail } = require('../middleware/errors');
const pool = require('../db/pool');
const { generatePeriod } = require('../scheduler');
const { validateWeek, computeStateFromAssignments } = require('../scheduler/validate');
const sixday = require('../scheduler/sixday');
const { audit, ACTIONS } = require('../middleware/audit');

// Σύνοψη «πριν/μετά» για το ημερολόγιο ασφαλείας.
// ΔΕΝ αντιγράφει το πρόγραμμα: κρατά πλήθη και το ΠΟΣΕΣ αναθέσεις άλλαξαν,
// ώστε να φαίνεται η έκταση μιας επέμβασης χωρίς διπλασιασμό προσωπικών
// δεδομένων. Σε μικρή αλλαγή (≤10 κελιά) καταγράφονται και τα κελιά, γιατί
// εκεί το «από → σε» είναι όντως χρήσιμο για διερεύνηση.
function diffAssignments(before, after) {
  const key = (a) => `${a.agentId}|${a.date}`;
  const val = (a) => (a.off ? 'ΡΕΠΟ' : `${a.start}-${a.end}`);
  const B = new Map((before || []).map((a) => [key(a), val(a)]));
  const A = new Map((after || []).map((a) => [key(a), val(a)]));
  const changed = [];
  for (const [k, v] of A) if (B.has(k) && B.get(k) !== v) changed.push({ cell: k, from: B.get(k), to: v });
  const added = [...A.keys()].filter((k) => !B.has(k)).length;
  const removed = [...B.keys()].filter((k) => !A.has(k)).length;
  const out = {
    total: A.size, previousTotal: B.size,
    added, removed, changed: changed.length,
    manualEdits: (after || []).filter((a) => a.isManualEdit).length
  };
  if (changed.length && changed.length <= 10) out.cells = changed;
  return out;
}
const { weeksCovering, monthBounds, isValidDate, addDays } = require('../utils/dates');

const router = express.Router();

// POST /api/schedule/generate  body: {month:'YYYY-MM'} ή {from,to}
router.post('/generate', async (req, res) => {
  try {
    let { from, to, month } = req.body || {};
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ ok: false, error: 'Μη έγκυρος μήνας' });
      ({ from, to } = monthBounds(month));
    }
    if (!from || !to || !isValidDate(from) || !isValidDate(to) || from > to) {
      return res.status(400).json({ ok: false, error: 'Μη έγκυρη περίοδος' });
    }
    const weeks = weeksCovering(from, to);
    if (weeks.length > 10) return res.status(400).json({ ok: false, error: 'Μέγιστο 10 εβδομάδες' });

    const result = await generatePeriod(weeks);
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, 'schedule');
  }
});

// POST /api/schedule/validate — live έλεγχος εβδομάδας μετά από χειροκίνητες
// αλλαγές. Ο client στέλνει και τις γειτονικές εβδομάδες όπως τις έχει στη
// μνήμη (με τυχόν μη αποθηκευμένες αλλαγές) — αλλιώς φορτώνονται από τη βάση.
router.post('/validate', async (req, res) => {
  try {
    const { weekStart, assignments, prevAssignments, nextAssignments } = req.body || {};
    if (!weekStart || !isValidDate(weekStart)) {
      return res.status(400).json({ ok: false, error: 'Μη έγκυρη εβδομάδα' });
    }

    let prev = prevAssignments;
    let prevState = null;
    if (!prev) {
      const [rows] = await pool.query(
        'SELECT data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1',
        [addDays(weekStart, -7)]
      );
      if (rows[0]) {
        const data = JSON.parse(rows[0].data);
        prev = data.assignments;
        prevState = data.state;
      } else {
        // Κατάσταση από την τελευταία αποθηκευμένη εβδομάδα πριν την τρέχουσα
        const [st] = await pool.query(
          'SELECT data FROM schedules WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1',
          [weekStart]
        );
        if (st[0]) prevState = JSON.parse(st[0].data).state;
      }
    }
    let next = nextAssignments;
    if (!next) {
      const [rows] = await pool.query(
        'SELECT data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1',
        [addDays(weekStart, 7)]
      );
      if (rows[0]) next = JSON.parse(rows[0].data).assignments;
    }

    const result = await validateWeek({
      weekStart,
      assignments: assignments || [],
      prevAssignments: prev,
      prevState,
      nextAssignments: next
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    fail(res, err, 'schedule');
  }
});

// POST /api/schedule/save — αποθήκευση εβδομάδας (νέα εγγραφή = ιστορικό).
// Η κατάσταση τέλους εβδομάδας ΞΑΝΑϋπολογίζεται από τις τελικές αναθέσεις.
router.post('/save', async (req, res) => {
  const { weekStart, assignments, report } = req.body || {};
  if (!weekStart || !isValidDate(weekStart) || !Array.isArray(assignments)) {
    return res.status(400).json({ ok: false, error: 'Μη έγκυρα δεδομένα' });
  }

  // (14/11/2026) ΑΠΟΤΡΟΠΗ οριστικοποίησης με εξαήμερο — όχι απλή προειδοποίηση.
  // Ελέγχεται ΚΑΙ η συνέχεια με την προηγούμενη εβδομάδα (π.χ. εισηγμένη από
  // Excel) και με την επόμενη, όταν υπάρχουν. Σειρά μόνο από άδεια ΔΕΝ είναι
  // εξαήμερο εργασίας και δεν μπλοκάρει.
  let exact = null;
  try {
    const violations = await sixday.checkWeek(pool, weekStart, assignments);
    if (violations.length) {
      return res.status(409).json({
        ok: false,
        code: 'SIX_DAY',
        error: `Δεν αποθηκεύτηκε: εξαήμερο εργασίας. ${sixday.describe(violations)}`,
        violations
      });
    }
    const rest = await sixday.checkRest(pool, weekStart, assignments);
    if (rest.violations.length) {
      return res.status(409).json({
        ok: false,
        code: 'LOW_REST',
        error: `Δεν αποθηκεύτηκε: εργαζόμενος με λιγότερα από 2 ρεπό. ${sixday.describeRest(rest.violations)}`,
        violations: rest.violations
      });
    }

    // (15/11/2026) ΑΚΡΙΒΩΣ 5 ΕΡΓΑΣΙΜΕΣ / 2 ΡΕΠΟ. Μπλοκάρει ΜΟΝΟ όταν ο στόχος
    // ήταν εφικτός και δεν επιτεύχθηκε. Οι μαθηματικά αδύνατες περιπτώσεις
    // (άδειες, σταθερά ρεπό, weekly_schedule) επιστρέφονται ως πληροφορία.
    exact = await sixday.checkExactDays(pool, weekStart, assignments);
    if (sixday.EXACT_DAYS_ENFORCED && exact.blocking.length) {
      return res.status(409).json({
        ok: false,
        code: 'EXACT_DAYS',
        error: `Δεν αποθηκεύτηκε: δεν τηρείται το «ακριβώς 5 εργάσιμες / 2 ρεπό». ${sixday.describeExact(exact.blocking)}`,
        violations: exact.blocking,
        impossible: exact.impossible
      });
    }
  } catch (err) {
    console.error('rest/six-day check error:', err.message);
    return res.status(500).json({ ok: false, error: 'Ο έλεγχος εξαημέρου/ρεπό απέτυχε — η αποθήκευση ματαιώθηκε.' });
  }

  // (15/11/2026) ΠΛΗΡΕΣ validation πριν την αποθήκευση: 11ωρη ανάπαυση (Κ8),
  // υπόλοιποι κανόνες, κάλυψη απαιτήσεων και αξιολόγηση των επιθυμητών ωρών.
  //
  // ΔΕΝ προστίθεται νέα συνθήκη μπλοκαρίσματος: το μόνο που εμποδίζει την
  // αποθήκευση παραμένει το εξαήμερο, ΑΚΡΙΒΩΣ όπως πριν. Οι υπόλοιποι έλεγχοι
  // επιστρέφονται στην απόκριση για να εμφανιστούν στον χρήστη — ο προϊστάμενος
  // κάνει χειροκίνητες αλλαγές εν γνώσει του και δεν πρέπει να κλειδώνεται έξω
  // από προγράμματα που σήμερα αποθηκεύει κανονικά.
  let validation = null;
  try {
    const v = await validateWeek({ weekStart, assignments });
    validation = {
      warnings: v.warnings,
      uncovered: v.uncovered,
      wishes: v.wishes,
      wishSummary: v.wishSummary,
      restViolations: v.warnings.filter((x) => /Κ8/.test(x.text)).length,
      sixDay: 0
    };
  } catch (err) {
    console.error('save-time validation error:', err.message);
  }

  const conn = await pool.getConnection();
  try {
    // Κατάσταση προηγούμενης εβδομάδας για σωστούς μετρητές
    const [prevRows] = await conn.query(
      'SELECT data FROM schedules WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1',
      [weekStart]
    );
    const prevState = prevRows[0] ? JSON.parse(prevRows[0].data).state : null;
    const state = await computeStateFromAssignments(weekStart, assignments, prevState);

    // Προηγούμενη αποθηκευμένη έκδοση ΤΗΣ ΙΔΙΑΣ εβδομάδας, για το «πριν/μετά»
    let previousAssignments = null;
    try {
      const [[same]] = await conn.query(
        'SELECT data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1', [weekStart]
      );
      if (same) previousAssignments = JSON.parse(same.data).assignments || null;
    } catch { /* η σύνοψη δεν πρέπει ποτέ να εμποδίσει την αποθήκευση */ }

    await conn.beginTransaction();
    const [ins] = await conn.query(
      'INSERT INTO schedules (week_start, data) VALUES (?, ?)',
      [weekStart, JSON.stringify({
        assignments, state,
        report: report || null,
        // Η αξιολόγηση των επιθυμητών ωρών αποθηκεύεται μαζί, ώστε να φαίνεται
        // και σε μελλοντικό άνοιγμα της εβδομάδας (15/11/2026)
        wishes: validation ? validation.wishes : null
      })]
    );
    const scheduleId = ins.insertId;

    for (const a of assignments) {
      if (a.off) continue;
      await conn.query(
        `INSERT INTO assignments
         (schedule_id, agent_id, date, start_time, end_time, role_id, color_argb, label, is_manual_edit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [scheduleId, a.agentId, a.date, a.start, a.end, a.roleId || null, a.color || null, a.label || null, a.isManualEdit ? 1 : 0]
      );
    }
    await audit(req, {
      action: ACTIONS.SCHEDULE_SAVE, targetType: 'schedule', targetId: scheduleId,
      details: { weekStart, ...diffAssignments(previousAssignments, assignments) }, conn
    });
    await conn.commit();
    res.json({
      ok: true, scheduleId, validation,
      // «Ακριβώς 5 εργάσιμες / 2 ρεπό»: όσο ο διακόπτης είναι κλειστός,
      // επιστρέφονται ως προειδοποιήσεις αντί να μπλοκάρουν
      exactDays: exact ? { blocking: exact.blocking, impossible: exact.impossible } : null
    });
  } catch (err) {
    await conn.rollback();
    fail(res, err, 'schedule');
  } finally {
    conn.release();
  }
});

// GET /api/schedule/week?start=YYYY-MM-DD — τελευταία αποθηκευμένη έκδοση
router.get('/week', async (req, res) => {
  try {
    const { start } = req.query;
    if (!start || !isValidDate(start)) return res.status(400).json({ ok: false, error: 'Μη έγκυρη εβδομάδα' });
    const [rows] = await pool.query(
      'SELECT id, week_start, created_at, data FROM schedules WHERE week_start = ? ORDER BY id DESC LIMIT 1',
      [start]
    );
    if (!rows[0]) return res.json({ ok: true, saved: false });
    const data = JSON.parse(rows[0].data);
    res.json({
      ok: true,
      saved: true,
      scheduleId: rows[0].id,
      savedAt: rows[0].created_at,
      assignments: data.assignments,
      report: data.report,
      wishes: data.wishes || null
    });
  } catch (err) {
    fail(res, err, 'schedule');
  }
});

module.exports = router;
