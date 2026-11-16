// Οθόνη Περιόδου: υπολογισμός εβδομάδων Δευ-Κυρ + άδειες/αιτήματα ρεπό.
// Οι καταχωρήσεις time_off γίνονται ανά ημερομηνία στη βάση, αλλά το API
// δέχεται ΔΙΑΣΤΗΜΑ (π.χ. άδεια 10/7-17/7 μονομιάς) και στη λίστα οι
// συνεχόμενες μέρες ομαδοποιούνται ξανά σε διαστήματα.
const express = require('express');
const { fail } = require('../middleware/errors');
const pool = require('../db/pool');
const { weeksCovering, monthBounds, addDays, isValidDate } = require('../utils/dates');

const router = express.Router();

const TIME_OFF_TYPES = ['repo_request', 'leave', 'sick'];

// GET /api/period/weeks?month=YYYY-MM  ή  ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Στρογγυλοποιεί σε πλήρεις εβδομάδες Δευτέρα-Κυριακή που καλύπτουν την περίοδο.
router.get('/period/weeks', (req, res) => {
  let { from, to, month } = req.query;

  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ ok: false, error: 'Μη έγκυρος μήνας (μορφή YYYY-MM)' });
    }
    ({ from, to } = monthBounds(month));
  }
  if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
    return res.status(400).json({ ok: false, error: 'Δώσε έγκυρες ημερομηνίες από/έως' });
  }
  if (from > to) {
    return res.status(400).json({ ok: false, error: 'Η ημερομηνία "από" είναι μετά την "έως"' });
  }

  const weeks = weeksCovering(from, to);
  if (weeks.length > 10) {
    return res.status(400).json({ ok: false, error: `Η περίοδος καλύπτει ${weeks.length} εβδομάδες — μέγιστο 10. Διάλεξε μικρότερο διάστημα.` });
  }
  res.json({ ok: true, from, to, weeks });
});

// GET /api/timeoff?from=&to= — λίστα καταχωρήσεων, ομαδοποιημένες σε διαστήματα
router.get('/timeoff', async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = [];
    const params = [];
    if (from && isValidDate(from)) { where.push('t.date >= ?'); params.push(from); }
    if (to && isValidDate(to)) { where.push('t.date <= ?'); params.push(to); }

    const [rows] = await pool.query(
      `SELECT t.id, t.agent_id, t.date, t.type, t.notes, a.full_name
       FROM time_off t JOIN agents a ON a.id = t.agent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.full_name, t.type, t.date`,
      params
    );

    // Ομαδοποίηση συνεχόμενων ημερών ίδιου agent + τύπου σε ένα διάστημα
    const groups = [];
    for (const r of rows) {
      const last = groups[groups.length - 1];
      if (
        last &&
        last.agent_id === r.agent_id &&
        last.type === r.type &&
        addDays(last.date_to, 1) === r.date
      ) {
        last.date_to = r.date;
        last.ids.push(r.id);
      } else {
        groups.push({
          ids: [r.id],
          agent_id: r.agent_id,
          agent_name: r.full_name,
          type: r.type,
          date_from: r.date,
          date_to: r.date,
          notes: r.notes
        });
      }
    }
    res.json({ ok: true, entries: groups });
  } catch (err) {
    fail(res, err, 'period');
  }
});

// POST /api/timeoff — καταχώρηση μεμονωμένης μέρας ή διαστήματος μονομιάς
router.post('/timeoff', async (req, res) => {
  const { agent_id, type, date_from, notes } = req.body || {};
  const date_to = req.body.date_to || date_from;

  if (!agent_id) return res.status(400).json({ ok: false, error: 'Επίλεξε agent' });
  if (!TIME_OFF_TYPES.includes(type)) return res.status(400).json({ ok: false, error: 'Μη έγκυρος τύπος καταχώρησης' });
  if (!date_from || !isValidDate(date_from) || !isValidDate(date_to)) {
    return res.status(400).json({ ok: false, error: 'Μη έγκυρες ημερομηνίες' });
  }
  if (date_from > date_to) return res.status(400).json({ ok: false, error: 'Η ημερομηνία "από" είναι μετά την "έως"' });

  // Όριο ασφαλείας: μέχρι 60 μέρες σε μία καταχώρηση
  const dates = [];
  let d = date_from;
  while (d <= date_to && dates.length <= 60) {
    dates.push(d);
    d = addDays(d, 1);
  }
  if (dates.length > 60) return res.status(400).json({ ok: false, error: 'Το διάστημα ξεπερνά τις 60 ημέρες' });

  const conn = await pool.getConnection();
  try {
    const [[agent]] = await conn.query('SELECT id, full_name, active FROM agents WHERE id = ?', [agent_id]);
    if (!agent) return res.status(404).json({ ok: false, error: 'Δεν βρέθηκε ο agent' });
    if (!agent.active) return res.status(400).json({ ok: false, error: 'Ο agent είναι ανενεργός' });

    // Έλεγχος επικάλυψης: ήδη υπάρχουσα καταχώρηση οποιουδήποτε τύπου τις ίδιες μέρες
    const [existing] = await conn.query(
      'SELECT date, type FROM time_off WHERE agent_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      [agent_id, date_from, date_to]
    );
    if (existing.length) {
      const typeLabels = { repo_request: 'αίτημα ρεπό', leave: 'άδεια', sick: 'ασθένεια' };
      const what = existing.map((e) => `${e.date} (${typeLabels[e.type]})`).slice(0, 5).join(', ');
      return res.status(409).json({
        ok: false,
        error: `Υπάρχει ήδη καταχώρηση για τον/την ${agent.full_name}: ${what}${existing.length > 5 ? '…' : ''}. Διάγραψέ την πρώτα.`
      });
    }

    await conn.beginTransaction();
    for (const date of dates) {
      await conn.query(
        'INSERT INTO time_off (agent_id, date, type, notes) VALUES (?, ?, ?, ?)',
        [agent_id, date, type, notes || null]
      );
    }
    await conn.commit();
    res.json({ ok: true, days: dates.length });
  } catch (err) {
    await conn.rollback();
    fail(res, err, 'period');
  } finally {
    conn.release();
  }
});

// DELETE /api/timeoff — διαγραφή ομάδας καταχωρήσεων (λίστα ids)
router.delete('/timeoff', async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => Number.isInteger(x))) {
    return res.status(400).json({ ok: false, error: 'Μη έγκυρη λίστα ids' });
  }
  try {
    const [r] = await pool.query('DELETE FROM time_off WHERE id IN (?)', [ids]);
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    fail(res, err, 'period');
  }
});

// ==================== ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ ΕΡΓΑΣΙΑΣ (15/11/2026) ====================
// Soft αιτήματα: ο generator προσπαθεί να τα ικανοποιήσει ΧΩΡΙΣ να παραβιάσει
// κανέναν υποχρεωτικό κανόνα. Ένα αίτημα ανά (agent, ημερομηνία) — ένα άτομο
// δουλεύει μία βάρδια τη μέρα (Κ2).

const HHMM = /^([01]\d|2[0-4]):[0-5]\d$/;

// ΟΙ ΥΠΑΡΧΟΥΣΕΣ ΒΑΡΔΙΕΣ ΤΟΥ ΣΥΣΤΗΜΑΤΟΣ. Τα αιτήματα επιτρέπεται να δείχνουν
// ΜΟΝΟ σε αυτές — δεν επινοούνται νέα ωράρια. Πηγές:
//   · shift_requirements : οι θέσεις του πίνακα απαιτήσεων
//   · FILLER_* του engine : τα ωράρια που χρησιμοποιεί η φάση συμπλήρωσης
//                           για να φτάσει κάποιος τις 5 εργάσιμες
const { FILLER_MORNING, FILLER_AFTERNOON } = require('../scheduler/engine');

// Επιπλέον ωράρια που επιτρέπονται ΜΟΝΟ ως επιθυμία (15/11/2026).
// ΔΕΝ είναι απαιτήσεις κάλυψης: δεν δημιουργούν θέση που πρέπει να γεμίσει
// και δεν τα χρησιμοποιεί ο generator από μόνος του για κανέναν. Μπαίνουν
// στο πρόγραμμα μόνο όταν ένας συγκεκριμένος εργαζόμενος τα ζητήσει ΚΑΙ
// περάσουν όλους τους ελέγχους (άδειες, Κ8, Κ10, ατομικοί κανόνες).
const WISH_ONLY_SHIFTS = [['12:00', '20:00'], ['15:00', '23:00']];

async function allowedShifts() {
  const [rows] = await pool.query(
    'SELECT DISTINCT start_time AS s, end_time AS e FROM shift_requirements ORDER BY start_time'
  );
  const set = new Map();
  const add = (s, e) => { if (s && e) set.set(`${s}-${e}`, { start: s, end: e }); };
  for (const r of rows) add(String(r.s).slice(0, 5), String(r.e).slice(0, 5));
  for (const [s, e] of [...FILLER_MORNING, ...FILLER_AFTERNOON, ...WISH_ONLY_SHIFTS]) add(s, e);
  return [...set.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// Έλεγχος εγκυρότητας ωραρίου. Δέχεται και βάρδιες που περνούν μεσάνυχτα
// (23:00-07:00), απορρίπτει μόνο start === end.
function validTimes(start, end) {
  if (!HHMM.test(start || '') || !HHMM.test(end || '')) return 'Μη έγκυρη ώρα (μορφή ΩΩ:ΛΛ)';
  if (start === end) return 'Η ώρα έναρξης και λήξης είναι ίδιες';
  return null;
}

// Έλεγχος ότι το ωράριο ΥΠΑΡΧΕΙ στο σύστημα — δεν επινοούνται νέες βάρδιες
async function validShift(start, end) {
  const list = await allowedShifts();
  if (list.some((x) => x.start === start && x.end === end)) return null;
  return `Το ωράριο ${start}-${end} δεν αντιστοιχεί σε υπάρχουσα βάρδια του συστήματος. ` +
    `Διαθέσιμες: ${list.map((x) => x.start + '-' + x.end).join(', ')}`;
}

// GET /api/wishes/shifts — οι διαθέσιμες βάρδιες για το dropdown
router.get('/wishes/shifts', async (req, res) => {
  try {
    res.json({ ok: true, shifts: await allowedShifts() });
  } catch (err) {
    fail(res, err, 'period');
  }
});

// GET /api/wishes?from=&to=
router.get('/wishes', async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = [];
    const params = [];
    if (from && isValidDate(from)) { where.push('w.date >= ?'); params.push(from); }
    if (to && isValidDate(to)) { where.push('w.date <= ?'); params.push(to); }

    const [rows] = await pool.query(
      `SELECT w.id, w.agent_id, w.date, w.start_time, w.end_time, w.notes,
              a.full_name, a.active,
              t.type AS conflict_type
       FROM shift_wishes w
       JOIN agents a ON a.id = w.agent_id
       LEFT JOIN time_off t ON t.agent_id = w.agent_id AND t.date = w.date
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY w.date, a.full_name`,
      params
    );
    res.json({ ok: true, entries: rows });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json({ ok: true, entries: [], needsMigration: true });
    fail(res, err, 'period');
  }
});

// POST /api/wishes — νέο αίτημα
router.post('/wishes', async (req, res) => {
  const { agent_id, date, start_time, end_time, notes } = req.body || {};

  if (!agent_id) return res.status(400).json({ ok: false, error: 'Επίλεξε εργαζόμενο' });
  if (!date || !isValidDate(date)) return res.status(400).json({ ok: false, error: 'Μη έγκυρη ημερομηνία' });
  const tErr = validTimes(start_time, end_time);
  if (tErr) return res.status(400).json({ ok: false, error: tErr });

  try {
    const sErr = await validShift(start_time, end_time);
    if (sErr) return res.status(400).json({ ok: false, error: sErr });

    const [[agent]] = await pool.query('SELECT id, full_name, active FROM agents WHERE id = ?', [agent_id]);
    if (!agent) return res.status(404).json({ ok: false, error: 'Δεν βρέθηκε ο εργαζόμενος' });
    if (!agent.active) return res.status(400).json({ ok: false, error: 'Ο εργαζόμενος είναι ανενεργός' });

    const [[dup]] = await pool.query('SELECT id FROM shift_wishes WHERE agent_id = ? AND date = ?', [agent_id, date]);
    if (dup) {
      return res.status(409).json({
        ok: false,
        error: `Υπάρχει ήδη αίτημα για τον/την ${agent.full_name} στις ${date}. Επεξεργάσου το υπάρχον.`
      });
    }

    // Η άδεια ΔΕΝ μπλοκάρει την καταχώρηση (συχνά η άδεια μπαίνει μετά), αλλά
    // επιστρέφεται προειδοποίηση: το αίτημα δεν θα μπορεί να ικανοποιηθεί.
    const [[conflict]] = await pool.query('SELECT type FROM time_off WHERE agent_id = ? AND date = ?', [agent_id, date]);

    const [r] = await pool.query(
      'INSERT INTO shift_wishes (agent_id, date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?)',
      [agent_id, date, start_time, end_time, notes || null]
    );
    res.json({
      ok: true,
      id: r.insertId,
      warning: conflict
        ? `Προσοχή: ο/η ${agent.full_name} έχει ήδη καταχώρηση (${conflict.type}) στις ${date} — το αίτημα δεν θα μπορεί να ικανοποιηθεί.`
        : null
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ ok: false, error: 'Ο πίνακας επιθυμητών ωρών δεν έχει δημιουργηθεί ακόμα (migration).' });
    }
    fail(res, err, 'period');
  }
});

// PUT /api/wishes/:id — επεξεργασία
router.put('/wishes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'Μη έγκυρο id' });

  const { date, start_time, end_time, notes } = req.body || {};
  if (!date || !isValidDate(date)) return res.status(400).json({ ok: false, error: 'Μη έγκυρη ημερομηνία' });
  const tErr = validTimes(start_time, end_time);
  if (tErr) return res.status(400).json({ ok: false, error: tErr });

  try {
    const sErr = await validShift(start_time, end_time);
    if (sErr) return res.status(400).json({ ok: false, error: sErr });

    const [[row]] = await pool.query('SELECT agent_id FROM shift_wishes WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ ok: false, error: 'Δεν βρέθηκε το αίτημα' });

    const [[dup]] = await pool.query(
      'SELECT id FROM shift_wishes WHERE agent_id = ? AND date = ? AND id <> ?',
      [row.agent_id, date, id]
    );
    if (dup) return res.status(409).json({ ok: false, error: 'Υπάρχει ήδη άλλο αίτημα του ίδιου εργαζομένου για αυτή την ημερομηνία' });

    await pool.query(
      'UPDATE shift_wishes SET date = ?, start_time = ?, end_time = ?, notes = ? WHERE id = ?',
      [date, start_time, end_time, notes || null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'period');
  }
});

// DELETE /api/wishes — διαγραφή (λίστα ids, όπως στο /timeoff)
router.delete('/wishes', async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => Number.isInteger(x))) {
    return res.status(400).json({ ok: false, error: 'Μη έγκυρη λίστα ids' });
  }
  try {
    const [r] = await pool.query('DELETE FROM shift_wishes WHERE id IN (?)', [ids]);
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    fail(res, err, 'period');
  }
});

module.exports = router;
