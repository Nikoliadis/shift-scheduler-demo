// Excel export — ΠΙΣΤΗ αναπαραγωγή του στυλ του χειροκίνητου αρχείου
// (δείγμα: «Weekly Program 13-19.07.2026.xlsx»):
//   * Γραμμή 1: κεφαλίδες ημερών (fill FFF2F2F2, Calibri Light 8)
//   * Γραμμές 2-25: ωριαίες ζώνες 00:00-01:00 … 23:00-24:00 στη στήλη A
//     με τα fills του δείγματος (νύχτα σκούρο γκρι, 06-07 σομόν, πρωί/απόγευμα γκρι)
//   * ΧΩΡΙΣ merges στο σώμα: το όνομα του agent επαναλαμβάνεται σε ΚΑΘΕ
//     ωριαίο κελί της βάρδιας με το χρώμα της
//   * Ζώνες που καλύπτονται ΜΙΣΗ ώρα (π.χ. έναρξη 07:30) → σκούρο κίτρινο FFFFC000
//   * Ετικέτα ρόλου (ΑΙΓΑΙΟΥ, ΖΕΦΥΡΟΣ, Verification/Call, INTERNATIONAL, CALL)
//     στο κελί ΠΑΝΩ από την έναρξη (Calibri 7 bold), ΤΗΛΕΡΓΑΣΙΑ από πάνω αν χωρά
//   * Κενά κελιά: γέμισμα ανά μέρα — Δευ/Τετ/Παρ FFD9D9D9, Τρι/Πεμ FFD9E1F2,
//     Σάββατο FFFFE699, Κυριακή FFB8B9E0
//   * Στήλες ομαδοποιημένες ανά ρόλο: Αιγαίου → Ζέφυρος → Verification →
//     Supervisor → Atlas → International → Υπόλοιπα call
//   * Πρωί+απόγευμα ίδιου ρόλου μοιράζονται στήλη· στη μοιρασμένη «μισή» ζώνη
//     επικρατεί η επόμενη βάρδια (όπως στο δείγμα)
const express = require('express');
const { fail } = require('../middleware/errors');
const pool = require('../db/pool');
const sixday = require('../scheduler/sixday');
const { audit, ACTIONS } = require('../middleware/audit');
const ExcelJS = require('exceljs');
const { addDays, dayOfWeek, isValidDate } = require('../utils/dates');

const router = express.Router();

const DAY_GR = ['ΔΕΥΤΕΡΑ', 'ΤΡΙΤΗ', 'ΤΕΤΑΡΤΗ', 'ΠΕΜΠΤΗ', 'ΠΑΡΑΣΚΕΥΗ', 'ΣΑΒΒΑΤΟ', 'ΚΥΡΙΑΚΗ'];
// Γέμισμα κενών κελιών ανά μέρα (μετρημένο από το δείγμα)
const DAY_FILLER = ['FFD9D9D9', 'FFD9E1F2', 'FFD9D9D9', 'FFD9E1F2', 'FFD9D9D9', 'FFFFE699', 'FFB8B9E0'];
const HALF_HOUR_FILL = 'FFFFC000'; // ζώνη μισής ώρας (σκούρο κίτρινο του δείγματος)
const HEADER_FILL = 'FFF2F2F2';
// Στυλ στήλης ωρών (μετρημένα από το δείγμα)
const HOUR_STYLES = [
  { fromRow: 2, toRow: 7, fill: 'FFA6A6A6', size: 11 },  // 00:00-06:00
  { fromRow: 8, toRow: 8, fill: 'FFFAD9D2', size: 11 },  // 06:00-07:00
  { fromRow: 9, toRow: 17, fill: 'FFDBDBDB', size: 8 },  // 07:00-16:00
  { fromRow: 18, toRow: 25, fill: 'FFEDEDED', size: 8 }  // 16:00-24:00
];

const NAME_FONT = { name: 'Calibri', size: 8, color: { argb: 'FF000000' } };
const LABEL_FONT = { name: 'Calibri', size: 7, bold: true, color: { argb: 'FF000000' } };
const CENTER = { horizontal: 'center', vertical: 'middle' };

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const dm = (dateStr) => {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d}/${m}`;
};
const pad2 = (n) => String(n).padStart(2, '0');

// Ομάδα στήλης + ετικέτα ρόλου μιας ανάθεσης — σειρά κατά τον προϊστάμενο
// (10/07/2026): Αιγαίου μαζί → ΖΕΦΥΡΟΣ μαζί → Verification (και
// Verification/Call) → Vega/Calls + International → Atlas ΤΕΡΜΑ ΔΕΞΙΑ.
// Όταν λείπουν reqLabel/roleName (fillers, χειροκίνητες αλλαγές), η ομάδα
// προκύπτει από το ΧΡΩΜΑ του κελιού — ό,τι βλέπεις στο preview, εκεί μπαίνει.
const COLOR_GROUP = {
  FFFFE699: { g: 0, label: 'ΑΙΓΑΙΟΥ' },        // κίτρινο Αιγαίου
  FFC6E0B4: { g: 1, label: 'ΖΕΦΥΡΟΣ' },            // πράσινο Ζέφυρος
  FFA6A6A6: { g: 2, label: 'Verification' },    // γκρι Verification
  FFFCE4D6: { g: 2, label: 'Verification' },    // ροδακινί (verification στο δείγμα)
  FFC792D6: { g: 3, label: null },              // μωβ Supervisor
  FFF4B084: { g: 4, label: 'CALL' },            // πορτοκαλί Vega/Calls
  FF66CCFF: { g: 8, label: null },              // μπλε Atlas — τέρμα δεξιά
  FF2F5496: { g: 8, label: null }               // μπλε κλειστό (νέος agent)
};

function groupAndLabel(a) {
  const req = a.reqLabel || '';
  const role = a.roleName || '';
  const skill = a.skill || '';
  if (req === 'Αιγαίου' || skill === 'ΑΙΓΑΙΟΥ') return { g: 0, label: 'ΑΙΓΑΙΟΥ' };
  if (role === 'Ζέφυρος') return { g: 1, label: 'ΖΕΦΥΡΟΣ' };
  if (req.startsWith('Verification & call Atlas')) return { g: 2, label: 'Verification/CallEuro' };
  if (req.startsWith('Verification & call υπόλοιπα')) return { g: 2, label: 'Verification/Call' };
  if (role === 'Verification') return { g: 2, label: 'Verification' };
  if (req === 'Supervisor' || role === 'Supervisor') return { g: 3, label: null };
  if (req === 'International' || (a.label || '').includes('INTERNATIONAL')) return { g: 5, label: 'INTERNATIONAL' };
  if (req === 'Vega/ΑΡΓΩ') return { g: 4, label: 'CALL/ΑΡΓΩ' };
  if (req === 'Vega' || req === 'Υπόλοιπα call' || role === 'Υπόλοιπα call') return { g: 4, label: 'CALL' };
  if (a.night || req === 'Νυχτερινή Atlas') return { g: 8, label: null };
  if (req.startsWith('Atlas') || role === 'Atlas') return { g: 8, label: null };
  if (a.color && COLOR_GROUP[a.color]) return COLOR_GROUP[a.color];
  return { g: 7, label: null };
}

// Σύντομα ονόματα όπως στο δείγμα: επώνυμο, με πρόθεμα ονόματος μόνο όταν
// υπάρχει σύγκρουση (π.χ. ΟΙΚΟΝΟΜΟΥ ΑΛΕΞ / ΟΙΚΟΝΟΜΟΥ ΛΕΩΝ)
function shortNames(assignments) {
  const fulls = [...new Set((assignments || []).filter((a) => !a.off && a.agentName).map((a) => a.agentName))];
  const bySurname = new Map();
  for (const f of fulls) {
    const sur = f.split(' ')[0];
    if (!bySurname.has(sur)) bySurname.set(sur, []);
    bySurname.get(sur).push(f);
  }
  const map = new Map();
  for (const [sur, list] of bySurname) {
    if (list.length === 1) {
      map.set(list[0], sur);
    } else {
      for (const f of list) {
        const first = f.split(' ')[1] || '';
        let len = 1;
        // Μήκος προθέματος αρκετό για να ξεχωρίζουν
        while (len < first.length && list.some((o) => o !== f && (o.split(' ')[1] || '').slice(0, len) === first.slice(0, len))) len++;
        map.set(f, `${sur} ${first.slice(0, Math.max(len, 4))}`.trim());
      }
    }
  }
  return map;
}

// Τμήματα ημέρας. ΚΑΘΕ βάρδια που περνά τα μεσάνυχτα (νυχτερινή 23:00/23:30
// ΚΑΙ η βραδινή Κ9) εμφανίζεται ΟΛΟΚΛΗΡΗ στη μέρα που ξεκινά — το κομμάτι
// μετά τις 00:00 «ανεβαίνει» στις ζώνες 00:00+ της ΙΔΙΑΣ στήλης
// (πρακτική του γραφείου — αποφάσεις 11/07 & 14/07/2026).
function daySegments(dates, assignments) {
  const segs = [];
  for (const a of assignments || []) {
    if (a.off) continue;
    const d = dates.indexOf(a.date);
    if (d === -1) continue;
    const s = toMin(a.start);
    let e = toMin(a.end);
    if (e <= s) {
      segs.push({ d, from: s, to: 1440, a, cont: false });
      segs.push({ d, from: 0, to: e, a, cont: true });
    } else {
      segs.push({ d, from: s, to: e, a, cont: false });
    }
  }
  return segs;
}

function buildWeekSheet(wb, name, weekStart, assignments) {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i));

  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 0 }]
  });

  const nameMap = shortNames(assignments);
  const segs = daySegments(dates, assignments);

  // ---- Πακετάρισμα: ανά μέρα και ανά ομάδα ρόλου, σε στήλες-λωρίδες.
  // Μη επικάλυψη σε ΑΚΡΙΒΗ λεπτά — έτσι πρωί 07:30-15:30 και απόγευμα
  // 15:30-23:30 μοιράζονται στήλη, και το κοινό «μισό» κελί το παίρνει
  // η επόμενη βάρδια (γράφεται δεύτερη).
  const lanesPerDay = []; // [d] → λίστα λωρίδων {g, segs:[]}
  for (let d = 0; d < 7; d++) {
    const daySegs = segs
      .filter((s) => s.d === d)
      .map((s) => ({ ...s, gl: groupAndLabel(s.a) }))
      .sort((x, y) => x.gl.g - y.gl.g || x.from - y.from || y.to - x.to);
    const lanes = [];
    for (const sg of daySegs) {
      let lane = lanes.find((L) => L.g === sg.gl.g && L.segs[L.segs.length - 1].to <= sg.from);
      if (!lane) {
        lane = { g: sg.gl.g, segs: [] };
        lanes.push(lane);
      }
      lane.segs.push(sg);
    }
    lanes.sort((x, y) => x.g - y.g);
    if (lanes.length === 0) lanes.push({ g: 99, segs: [] });
    lanesPerDay.push(lanes);
  }

  const laneCount = lanesPerDay.map((l) => l.length);
  const colStart = [2]; // στήλη B η πρώτη μέρα
  for (let d = 0; d < 7; d++) colStart.push(colStart[d] + laneCount[d]);
  const lastCol = colStart[7] - 1;

  // ---- Γραμμή 1: κεφαλίδες ημερών (banner σε όλο το μπλοκ) ----
  ws.getRow(1).height = 15.75;
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(1, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  }
  for (let d = 0; d < 7; d++) {
    const c1 = colStart[d];
    const c2 = colStart[d] + laneCount[d] - 1;
    if (c2 > c1) ws.mergeCells(1, c1, 1, c2);
    const cell = ws.getCell(1, c1);
    cell.value = `${DAY_GR[d]} ${dm(dates[d])}`;
    cell.font = { name: 'Calibri Light', size: 8, color: { argb: 'FF000000' } };
    cell.alignment = CENTER;
  }

  // ---- Στήλη A: ωριαίες ζώνες με τα στυλ του δείγματος ----
  ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  for (let h = 0; h < 24; h++) {
    const r = 2 + h;
    const st = HOUR_STYLES.find((x) => r >= x.fromRow && r <= x.toRow);
    const c = ws.getCell(r, 1);
    c.value = `${pad2(h)}:00-${pad2(h + 1)}:00`;
    c.font = { name: 'Calibri', size: st.size, color: { argb: 'FF000000' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
  }
  ws.getColumn(1).width = 11;

  // ---- Γέμισμα κενών κελιών με το χρώμα της μέρας ----
  for (let d = 0; d < 7; d++) {
    for (let lane = 0; lane < laneCount[d]; lane++) {
      const col = colStart[d] + lane;
      for (let r = 2; r <= 25; r++) {
        ws.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DAY_FILLER[d] } };
      }
    }
  }

  // ---- Βάρδιες: όνομα σε κάθε ωριαίο κελί, μισές ώρες σκούρο κίτρινο ----
  for (let d = 0; d < 7; d++) {
    lanesPerDay[d].forEach((lane, laneIdx) => {
      const col = colStart[d] + laneIdx;
      // Με τη σειρά έναρξης — η επόμενη βάρδια «κερδίζει» το κοινό μισό κελί
      const ordered = [...lane.segs].sort((x, y) => x.from - y.from);
      for (const sg of ordered) {
        const a = sg.a;
        const short = nameMap.get(a.agentName) || (a.agentName || '').split(' ')[0];
        const zFrom = Math.floor(sg.from / 60);
        const zTo = Math.ceil(sg.to / 60); // exclusive
        for (let z = zFrom; z < zTo; z++) {
          const partial = (z === zFrom && sg.from % 60 !== 0) || (z === zTo - 1 && sg.to % 60 !== 0);
          const cell = ws.getCell(2 + z, col);
          cell.value = short;
          cell.font = NAME_FONT;
          cell.alignment = CENTER;
          const fill = partial ? HALF_HOUR_FILL : (a.color || 'FFFFFFFF');
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        }

        // Ετικέτα ρόλου στο κελί πάνω από την έναρξη — μόνο αν είναι ελεύθερο
        if (!sg.cont) {
          const labelRow = 2 + zFrom - 1;
          const telework = (a.label || '').includes('ΤΗΛΕΡΓΑΣΙΑ');
          if (labelRow >= 2 && !ws.getCell(labelRow, col).value && sg.gl.label) {
            const lc = ws.getCell(labelRow, col);
            lc.value = sg.gl.label;
            lc.font = LABEL_FONT;
            lc.alignment = CENTER;
            // ΤΗΛΕΡΓΑΣΙΑ μία γραμμή πιο πάνω, αν χωρά
            if (telework && labelRow - 1 >= 2 && !ws.getCell(labelRow - 1, col).value) {
              const tc = ws.getCell(labelRow - 1, col);
              tc.value = 'ΤΗΛΕΡΓΑΣΙΑ';
              tc.font = LABEL_FONT;
              tc.alignment = CENTER;
            }
          } else if (labelRow >= 2 && telework && !ws.getCell(labelRow, col).value) {
            const tc = ws.getCell(labelRow, col);
            tc.value = 'ΤΗΛΕΡΓΑΣΙΑ';
            tc.font = LABEL_FONT;
            tc.alignment = CENTER;
          }
        }
      }
    });
  }

  return ws;
}

// Όνομα αρχείου: Weekly_Program_DD_MM-DD_MM_YYYY.xlsx
function weekFilename(weekStart) {
  const end = addDays(weekStart, 6);
  const [ys, ms, ds] = weekStart.split('-');
  const [, me, de] = end.split('-');
  return `Weekly_Program_${ds}_${ms}-${de}_${me}_${ys}.xlsx`;
}

// Όνομα φύλλου: «29.06-05.07»
function sheetName(weekStart) {
  const end = addDays(weekStart, 6);
  const [, ms, ds] = weekStart.split('-');
  const [, me, de] = end.split('-');
  return `${ds}.${ms}-${de}.${me}`;
}

async function sendWorkbook(res, wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buf));
}

// POST /api/export/week  body: {weekStart, assignments}
router.post('/week', async (req, res) => {
  try {
    const { weekStart, assignments } = req.body || {};
    // (14/11/2026) ΑΠΟΤΡΟΠΗ εξαγωγής Excel με εξαήμερο — ίδιος έλεγχος με την
    // αποθήκευση, ώστε να μη βγει «οριστικό» πρόγραμμα που δεν αποθηκεύεται.
    {
      const v = await sixday.checkWeek(pool, weekStart, assignments || []);
      if (v.length) {
        return res.status(409).json({
          ok: false, code: 'SIX_DAY',
          error: `Δεν εξήχθη: εξαήμερο εργασίας. ${sixday.describe(v)}`, violations: v
        });
      }
      // (15/11/2026) ΚΑΝΟΝΑΣ 2 ΡΕΠΟ — ίδιο φράγμα με την αποθήκευση
      const r = await sixday.checkRest(pool, weekStart, assignments || []);
      if (r.violations.length) {
        return res.status(409).json({
          ok: false, code: 'LOW_REST',
          error: `Δεν εξήχθη: εργαζόμενος με λιγότερα από 2 ρεπό. ${sixday.describeRest(r.violations)}`,
          violations: r.violations
        });
      }
      const ex = await sixday.checkExactDays(pool, weekStart, assignments || []);
      if (sixday.EXACT_DAYS_ENFORCED && ex.blocking.length) {
        return res.status(409).json({
          ok: false, code: 'EXACT_DAYS',
          error: `Δεν εξήχθη: δεν τηρείται το «ακριβώς 5 εργάσιμες / 2 ρεπό». ${sixday.describeExact(ex.blocking)}`,
          violations: ex.blocking, impossible: ex.impossible
        });
      }
    }
    if (!weekStart || !isValidDate(weekStart) || dayOfWeek(weekStart) !== 1) {
      return res.status(400).json({ ok: false, error: 'Μη έγκυρη εβδομάδα (απαιτείται Δευτέρα)' });
    }
    const wb = new ExcelJS.Workbook();
    buildWeekSheet(wb, sheetName(weekStart), weekStart, assignments || []);
    // Εξαγωγή δεδομένων εργαζομένων εκτός συστήματος — καταγράφεται πάντα
    await audit(req, {
      action: ACTIONS.EXPORT_WEEK, targetType: 'week', targetId: weekStart,
      details: { rows: (assignments || []).length }
    });
    await sendWorkbook(res, wb, weekFilename(weekStart));
  } catch (err) {
    fail(res, err, 'export');
  }
});

// POST /api/export/period  body: {weeks: [{weekStart, assignments}]}
router.post('/period', async (req, res) => {
  try {
    const { weeks } = req.body || {};
    // Ίδιο φράγμα για ΚΑΘΕ εβδομάδα της περιόδου
    for (const w of weeks || []) {
      const v = await sixday.checkWeek(pool, w.weekStart, w.assignments || []);
      if (v.length) {
        return res.status(409).json({
          ok: false, code: 'SIX_DAY',
          error: `Δεν εξήχθη: εξαήμερο εργασίας στην εβδομάδα ${w.weekStart}. ${sixday.describe(v)}`,
          violations: v
        });
      }
      const r = await sixday.checkRest(pool, w.weekStart, w.assignments || []);
      if (r.violations.length) {
        return res.status(409).json({
          ok: false, code: 'LOW_REST',
          error: `Δεν εξήχθη: εργαζόμενος με λιγότερα από 2 ρεπό στην εβδομάδα ${w.weekStart}. ${sixday.describeRest(r.violations)}`,
          violations: r.violations
        });
      }
      const ex = await sixday.checkExactDays(pool, w.weekStart, w.assignments || []);
      if (sixday.EXACT_DAYS_ENFORCED && ex.blocking.length) {
        return res.status(409).json({
          ok: false, code: 'EXACT_DAYS',
          error: `Δεν εξήχθη: «ακριβώς 5 εργάσιμες / 2 ρεπό» στην εβδομάδα ${w.weekStart}. ${sixday.describeExact(ex.blocking)}`,
          violations: ex.blocking, impossible: ex.impossible
        });
      }
    }
    if (!Array.isArray(weeks) || weeks.length === 0 || weeks.some((w) => !w.weekStart || !isValidDate(w.weekStart))) {
      return res.status(400).json({ ok: false, error: 'Μη έγκυρες εβδομάδες' });
    }
    const wb = new ExcelJS.Workbook();
    for (const w of weeks) {
      buildWeekSheet(wb, sheetName(w.weekStart), w.weekStart, w.assignments || []);
    }
    await audit(req, {
      action: ACTIONS.EXPORT_PERIOD, targetType: 'period',
      targetId: `${weeks[0].weekStart}..${weeks[weeks.length - 1].weekStart}`,
      details: { weeks: weeks.length, rows: weeks.reduce((n, w) => n + ((w.assignments || []).length), 0) }
    });
    const first = weeks[0].weekStart;
    const lastEnd = addDays(weeks[weeks.length - 1].weekStart, 6);
    const [ys, ms, ds] = first.split('-');
    const [, me, de] = lastEnd.split('-');
    await sendWorkbook(res, wb, `Period_Program_${ds}_${ms}-${de}_${me}_${ys}.xlsx`);
  } catch (err) {
    fail(res, err, 'export');
  }
});

module.exports = router;
// Εσωτερικά — ΜΟΝΟ για tests (ο router μένει το κανονικό export, το format
// του Excel δεν αλλάζει από αυτό)
module.exports._test = { buildWeekSheet, groupAndLabel };
