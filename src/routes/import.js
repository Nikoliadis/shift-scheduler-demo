// Εισαγωγή Excel εβδομαδιαίου προγράμματος (που έχει ήδη βγει) ώστε ο
// generator να «βλέπει» την προηγούμενη εβδομάδα και να τηρεί Κ8/Κ10 στα
// σύνορα (απαίτηση προϊσταμένου 11/07/2026).
//
// Υποστηρίζει το format του γραφείου/του export μας:
//   - γραμμή 1 κεφαλίδες ημερών, γραμμές 2-25 ωριαίες ζώνες 00:00-24:00
//   - κάθε βάρδια = όνομα επαναλαμβανόμενο στα ωριαία κελιά μιας στήλης
//   - τα μπλοκ ημερών αναγνωρίζονται από την ΕΝΑΛΛΑΓΗ χρώματος γεμίσματος
//     των κενών κελιών (Δευ/Τετ/Παρ γκρι, Τρι/Πεμ γαλαζογκρί, Σαβ, Κυρ)
//   - ζώνη με σκούρο κίτρινο FFFFC000 = μισή ώρα (έναρξη/λήξη :30)
//   - νυχτερινές: κομμάτι 23:00-24:00 + πρωινό κομμάτι (ίδια ή επόμενη μέρα)
// Η εβδομάδα αποθηκεύεται στη βάση σαν κανονικό schedule.
const express = require('express');
const { fail } = require('../middleware/errors');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { computeStateFromAssignments } = require('../scheduler/validate');
const { addDays, dayOfWeek, isValidDate } = require('../utils/dates');

const router = express.Router();

const FILLER_COLORS = new Set(['FFD9D9D9', 'FFD9E1F2', 'FFFFE699', 'FFB8B9E0', 'FFF2F2F2']);
const HALF = 'FFFFC000';

// ---------- Ταυτότητα των ΔΥΟ βαρδιών 23:00-07:00 (14/11/2026) ----------
// Η βραδινή Κ9 («Vega Bank») και η «Νυχτερινή Atlas» έχουν ΤΟ ΙΔΙΟ ωράριο,
// οπότε από τις ώρες ΔΕΝ ξεχωρίζουν. Το export γράφει πάντα το χρώμα του ρόλου
// στο κελί (Verification γκρι vs Atlas μπλε) — αυτή είναι η πληροφορία που
// επιτρέπει τη διάκριση κατά το import.
//
// Ο χάρτης διαβάζεται από τη ΒΑΣΗ (shift_requirements × roles) και ΟΧΙ από
// σταθερές τιμές hex: τα χρώματα ρόλων είναι επεξεργάσιμα από τις Ρυθμίσεις,
// και οι ετικέτες πρέπει να είναι ΑΚΡΙΒΩΣ οι ίδιες που χρησιμοποιεί ο generator.
const ARGB = (c) => {
  if (!c) return null;
  const s = String(c).toUpperCase().replace(/[^0-9A-F]/g, '');
  if (s.length === 8) return s;
  if (s.length === 6) return `FF${s}`; // RGB χωρίς κανάλι διαφάνειας
  return null;
};

async function nightLabelsByColor() {
  const [rows] = await pool.query(
    `SELECT DISTINCT sr.label, ro.color_argb
     FROM shift_requirements sr
     JOIN roles ro ON ro.id = sr.role_id
     WHERE sr.start_time = '23:00' AND sr.end_time = '07:00'`
  );
  const map = new Map(); // ARGB → label | null (null = διφορούμενο)
  for (const r of rows) {
    const key = ARGB(r.color_argb);
    if (!key || !r.label) continue;
    if (map.has(key) && map.get(key) !== r.label) map.set(key, null); // ίδιο χρώμα σε δύο βάρδιες
    else if (!map.has(key)) map.set(key, r.label);
  }
  return map;
}

// Αποδίδει reqLabel ΜΟΝΟ στις βάρδιες 23:00-07:00 και ΜΟΝΟ όταν το χρώμα
// αντιστοιχεί μονοσήμαντα σε μία από τις δύο απαιτήσεις. Σε άγνωστο, κενό,
// διφορούμενο ή μη αναγνωρίσιμο χρώμα το reqLabel ΜΕΝΕΙ κενό — καμία εικασία.
function tagNightShifts(assignments, labelByColor) {
  let tagged = 0;
  let ambiguous = 0;
  for (const a of assignments) {
    if (a.start !== '23:00' || a.end !== '07:00') continue;
    const key = ARGB(a.color);
    const label = key ? labelByColor.get(key) : undefined;
    if (typeof label === 'string') { a.reqLabel = label; tagged++; }
    else ambiguous++;
  }
  return { tagged, ambiguous };
}

const min2t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Κανονικοποίηση ονόματος κελιού → agent.
// - Μεταγραφή ελληνικών→λατινικών ώστε π.χ. «ΑΛΙΓΙΑ» να πιάνει το «ΡΟΥΣΣΟΥ»
// - Αναγνώριση από ΟΠΟΙΟΔΗΠΟΤΕ όνομα (π.χ. «ΖΗΣΗΣ» → ΒΑΣΙΛΕΙΟΥ ΚΩΣΤΑΣ)
// - Σκέτο διφορούμενο επώνυμο (π.χ. «ΧΡΙΣΤΟΔΟΥΛΟΥ») ξεδιαλύνεται από το
//   χρώμα του κελιού (μωβ = supervisor → Τασια)
const GR2LAT = {
  'Α': 'A', 'Β': 'V', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH',
  'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P',
  'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'CH', 'Ψ': 'PS', 'Ω': 'O'
};
const translit = (s) => [...s].map((c) => GR2LAT[c] || c).join('');

function buildNameMatcher(agents) {
  const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const key = (s) => translit(norm(s));

  return (cellVal, fill) => {
    const v = norm(cellVal);
    if (!v || v.length < 3) return null;
    const tokens = v.split(' ');
    const kTokens = tokens.map(translit);

    // 1. Ακριβές πλήρες όνομα (με μεταγραφή)
    let hit = agents.find((a) => key(a.full_name) === key(v));
    if (hit) return hit;

    // 2. Πρώτο token = οποιοδήποτε όνομα του agent (επώνυμο Ή μικρό)
    const tokenMatches = agents.filter((a) =>
      norm(a.full_name).split(' ').some((t) => translit(t) === kTokens[0])
    );
    if (tokenMatches.length === 1) return tokenMatches[0];

    if (tokenMatches.length > 1) {
      // 3. Δεύτερο token του κελιού = πρόθεμα ονόματος
      if (tokens[1]) {
        hit = tokenMatches.find((a) =>
          norm(a.full_name).split(' ').some((t) => translit(t).startsWith(kTokens[1]))
        );
        if (hit) return hit;
      }
      // 4. Χρώμα κελιού: μωβ supervisor → ο supervisor συνονόματος
      if (fill === 'FFC792D6') {
        hit = tokenMatches.find((a) => JSON.parse(a.departments || '[]').includes('supervisor'));
        if (hit) return hit;
      }
    }

    // Τυπογραφικά λάθη στο χειροκίνητο αρχείο (π.χ. «ΚΟΚΟΠΠΟΥΛΟΥ» αντί
    // «ΖΕΡΒΑ»): μοναδικό ταίριασμα επωνύμου με απόσταση ≤2 γραμμάτων
    const dist = (s, t) => {
      if (Math.abs(s.length - t.length) > 2) return 99;
      const m = s.length, n = t.length;
      let prev = Array.from({ length: n + 1 }, (_, j) => j);
      for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
        }
        prev = cur;
      }
      return prev[n];
    };
    const fuzzy = agents.filter((a) => dist(kTokens[0], translit(norm(a.full_name).split(' ')[0])) <= 2);
    if (fuzzy.length === 1) return fuzzy[0];

    return null;
  };
}

// Κείμενα-ετικέτες που ΔΕΝ είναι ονόματα — δεν αναφέρονται ως «αγνώριστα»
const LABEL_TEXTS = /INTERNATIONAL|ΓΡΑΦΕΙΟ|ΤΗΛΕΡΓΑΣΙΑ|VERIFICATION|CALL|ΝΥΧΤΕΡΙΝΗ|ΣΠΑΣΤΟ|ΑΝΟΙΓΜΑ|ΑΙΓΑΙΟΥ|ΖΕΦΥΡΟΣ|\/|--|->/i;

const err400 = (msg) => Object.assign(new Error(msg), { status: 400 });

// Όρια εισαγωγής: ένα εβδομαδιαίο πρόγραμμα είναι ~25 γραμμές × ~170 στήλες
// και λίγες δεκάδες KB. Τα όρια αφήνουν άνετο περιθώριο αλλά κόβουν
// κακόβουλα ή κατά λάθος τεράστια αρχεία πριν εξαντλήσουν τον server.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;  // 4MB αποσυμπιεσμένο base64
const MAX_ROWS = 500;
const MAX_COLS = 1000;

// Ανάλυση φύλλου Excel → βάρδιες. Κοινό για /week (αποθήκευση) και /preview
// (μόνο εμφάνιση). Πετάει err400 με μήνυμα αν το format δεν αναγνωρίζεται.
function parseSchedule(ws, agents, weekStart) {
  const matchAgent = buildNameMatcher(agents);
  const maxCol = ws.columnCount;
    const cellInfo = (r, c) => {
      const cell = ws.getCell(r, c);
      let v = cell.value;
      if (v && typeof v === 'object' && v.richText) v = v.richText.map((t) => t.text).join('');
      const fill = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor ? cell.fill.fgColor.argb || null : null;
      return { v: v == null ? '' : String(v).trim(), fill };
    };

    // ---- 0. Εντοπισμός γραμμής ζωνών: κάθε αρχείο μπορεί να έχει
    // διαφορετικές κεφαλίδες (π.χ. το χειροκίνητο 20-26/7 έχει τις ζώνες
    // μία γραμμή πιο κάτω). Βρες πού είναι το «00:00-01:00» στη στήλη A.
    let zoneRow0 = 0;
    for (let r = 1; r <= 6; r++) {
      const { v } = cellInfo(r, 1);
      if (/^00[.:]00\s*[-–]\s*0?1[.:]00/.test(v)) { zoneRow0 = r; break; }
    }
    if (!zoneRow0) {
      throw err400('Δεν βρέθηκε η ζώνη «00:00-01:00» στη στήλη A — μη αναγνωρίσιμο format');
    }

    // ---- 1. Μπλοκ ημερών από την εναλλαγή χρώματος γεμίσματος των κενών ----
    const fillerOf = [];
    for (let c = 2; c <= maxCol; c++) {
      const counts = new Map();
      for (let r = zoneRow0; r <= zoneRow0 + 23; r++) {
        const { v, fill } = cellInfo(r, c);
        if (!v && fill && FILLER_COLORS.has(fill)) counts.set(fill, (counts.get(fill) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      fillerOf.push(top ? top[0] : null);
    }
    let blocks = []; // {c1, c2}
    for (let i = 0; i < fillerOf.length; i++) {
      const col = i + 2;
      if (!fillerOf[i]) {
        if (blocks.length) blocks[blocks.length - 1].c2 = col; // στήλη γεμάτη βάρδιες — κόλλα στο τρέχον μπλοκ
        continue;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.filler === fillerOf[i]) last.c2 = col;
      else blocks.push({ c1: col, c2: col, filler: fillerOf[i] });
    }
    // Συγχώνευση «διαχωριστικών»: μονές/στενές στήλες με ουδέτερο γέμισμα
    // (π.χ. FFF2F2F2 της κεφαλίδας) ΜΕΣΑ σε μέρα με ίδιο χρώμα δεξιά-αριστερά
    for (let pass = 0; pass < 3; pass++) {
      const merged = [];
      for (const b of blocks) {
        const prev = merged[merged.length - 1];
        const width = b.c2 - b.c1 + 1;
        if (prev && (b.filler === prev.filler || (width <= 2 && b.filler === 'FFF2F2F2'))) {
          // ίδιο χρώμα ή στενό ουδέτερο διαχωριστικό: κόλλα στο προηγούμενο
          prev.c2 = b.c2;
          if (b.filler !== 'FFF2F2F2') prev.filler = prev.filler === 'FFF2F2F2' ? b.filler : prev.filler;
        } else {
          merged.push({ ...b });
        }
      }
      // Δεύτερο μισό της συγχώνευσης: [Χρώμα Α][διαχωριστικό][Χρώμα Α] έγιναν
      // ήδη ένα· ξαναπέρασε μέχρι να σταθεροποιηθεί
      const again = [];
      for (const b of merged) {
        const prev = again[again.length - 1];
        if (prev && prev.filler === b.filler) prev.c2 = b.c2;
        else again.push(b);
      }
      blocks = again;
      if (blocks.length === 7) break;
    }
    if (blocks.length !== 7) {
      throw err400(`Αναγνωρίστηκαν ${blocks.length} μπλοκ ημερών αντί για 7 — μη αναμενόμενο format αρχείου`);
    }

    // ---- 2. Σάρωση στηλών: συνεχόμενα «τρεξίματα» ίδιου ονόματος ----
    // Ζώνη z = γραμμή r - zoneRow0 (z=0 → 00:00-01:00 … z=23 → 23:00-24:00)
    const lastZoneRow = zoneRow0 + 23;
    const rawRuns = []; // {dayIdx, agent, zFrom, zTo (inclusive), halfFirst, halfLast, color}
    const unmatched = new Set();
    for (let b = 0; b < 7; b++) {
      for (let c = blocks[b].c1; c <= blocks[b].c2; c++) {
        let run = null;
        for (let r = zoneRow0; r <= lastZoneRow + 1; r++) {
          const { v, fill } = r <= lastZoneRow ? cellInfo(r, c) : { v: '', fill: null };
          const agent = v && !FILLER_COLORS.has(fill || '') ? matchAgent(v, fill) : null;
          if (v && !agent && r <= lastZoneRow && fill && !FILLER_COLORS.has(fill) && !LABEL_TEXTS.test(v)) unmatched.add(v);

          if (run && agent && agent.id === run.agent.id) {
            run.zTo = r - zoneRow0;
            run.halfLast = fill === HALF;
            if (fill && fill !== HALF && !run.color) run.color = fill;
          } else {
            if (run) rawRuns.push(run);
            run = agent
              ? {
                  dayIdx: b, agent, zFrom: r - zoneRow0, zTo: r - zoneRow0,
                  halfFirst: fill === HALF, halfLast: fill === HALF,
                  color: fill && fill !== HALF ? fill : null
                }
              : null;
          }
        }
        if (run) rawRuns.push(run);
      }
    }

    // ---- 3. Τρεξίματα → βάρδιες (με ένωση νυχτερινών & βραδινής Κ9) ----
    // start = αρχή πρώτης ζώνης (+30' αν μισή), end = τέλος τελευταίας (-30' αν
    // μισή). Ειδική περίπτωση: μονό κελί στη ζώνη 23:00-24:00 με σκούρο
    // κίτρινο = ΕΝΑΡΞΗ νυχτερινής 23:30 (όχι λήξη 23:30).
    const partial = rawRuns.map((r) => {
      const nightStartCell = r.zFrom === 23 && r.zTo === 23;
      return {
        dayIdx: r.dayIdx,
        agent: r.agent,
        from: r.zFrom * 60 + (r.halfFirst ? 30 : 0),
        to: (r.zTo + 1) * 60 - (r.halfLast && !nightStartCell ? 30 : 0),
        color: r.color
      };
    });

    const used = new Set();
    const assignments = [];

    // Πέρασμα Α: ένωση βραδινών (…-24:00) με τα πρωινά τους κομμάτια (00:00-…)
    // ΠΡΙΝ από οτιδήποτε άλλο, ώστε να μην «καταναλωθούν» τα πρωινά μεμονωμένα
    for (let i = 0; i < partial.length; i++) {
      const p = partial[i];
      if (used.has(i) || !(p.to === 1440 && p.from >= 1140)) continue;
      const morning = partial.findIndex((q, j) =>
        !used.has(j) && j !== i && q.agent.id === p.agent.id && q.from === 0 && q.to < 720 &&
        (q.dayIdx === p.dayIdx || q.dayIdx === p.dayIdx + 1)
      );
      if (morning >= 0) {
        used.add(i);
        used.add(morning);
        assignments.push({
          agentId: p.agent.id, agentName: p.agent.full_name,
          date: addDays(weekStart, p.dayIdx),
          start: min2t(p.from), end: min2t(partial[morning].to),
          color: p.color || partial[morning].color || null,
          label: null, isManualEdit: false
        });
      }
    }

    // Πέρασμα Β: υπόλοιπα τρεξίματα → απλές βάρδιες
    for (let i = 0; i < partial.length; i++) {
      if (used.has(i)) continue;
      const p = partial[i];
      // Πρωινό κομμάτι 00:00-xx της Δευτέρας χωρίς βραδινό ζευγάρι = συνέχεια
      // νυχτερινής της ΠΡΟΗΓΟΥΜΕΝΗΣ εβδομάδας — αγνοείται (ανήκει στην άλλη εβδομάδα)
      if (p.from === 0 && p.dayIdx === 0 && p.to < 720) {
        used.add(i);
        continue;
      }
      used.add(i);
      assignments.push({
        agentId: p.agent.id, agentName: p.agent.full_name,
        date: addDays(weekStart, p.dayIdx),
        start: min2t(p.from), end: p.to === 1440 ? '24:00' : min2t(p.to),
        color: p.color || null, label: null, isManualEdit: false
      });
    }

    if (assignments.length === 0) {
      throw err400('Δεν αναγνωρίστηκε καμία βάρδια στο αρχείο');
    }

    return { assignments, unmatched: [...unmatched] };
}

// Φόρτωση + parse του base64 αρχείου. Επιστρέφει {assignments, unmatched, weekStart}.
async function loadAndParse(body) {
  const { weekStart, fileBase64 } = body || {};
  if (!weekStart || !isValidDate(weekStart) || dayOfWeek(weekStart) !== 1) {
    throw err400('Δώσε τη Δευτέρα της εβδομάδας του αρχείου');
  }
  if (!fileBase64) throw err400('Δεν στάλθηκε αρχείο');

  const wb = new ExcelJS.Workbook();
  // ---------- Όρια εισαγωγής (15/11/2026) ----------
  // Το .xlsx είναι zip: μικρό αρχείο μπορεί να αποσυμπιεστεί σε τεράστιο
  // φύλλο (decompression bomb) και να εξαντλήσει μνήμη/CPU του server.
  const approxBytes = Math.floor(String(fileBase64).length * 0.75);
  if (approxBytes > MAX_UPLOAD_BYTES) {
    throw err400(`Το αρχείο είναι πολύ μεγάλο (${Math.round(approxBytes / 1024 / 1024)}MB). Όριο: ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`);
  }
  await wb.xlsx.load(Buffer.from(fileBase64, 'base64'));

  // Μετά την αποσυμπίεση: έλεγχος πραγματικού μεγέθους φύλλου
  for (const sheet of wb.worksheets) {
    if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLS) {
      throw err400(
        `Το φύλλο «${sheet.name}» είναι ${sheet.rowCount}×${sheet.columnCount} — ` +
        `πάνω από το όριο ${MAX_ROWS}×${MAX_COLS}. Έλεγξε ότι είναι εβδομαδιαίο πρόγραμμα.`
      );
    }
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 20) throw err400('Μη αναγνωρίσιμο φύλλο');

  const [agents] = await pool.query('SELECT id, full_name, departments FROM agents WHERE active = 1');
  const { assignments, unmatched } = parseSchedule(ws, agents, weekStart);

  // Ταυτότητα των δύο βαρδιών 23:00-07:00 από το χρώμα του κελιού
  const nightInfo = tagNightShifts(assignments, await nightLabelsByColor());

  return { weekStart, assignments, unmatched, nightInfo };
}

// POST /api/import/week  body: {weekStart:'YYYY-MM-DD' (Δευτέρα), fileBase64}
router.post('/week', async (req, res) => {
  try {
    const { weekStart, assignments, unmatched, nightInfo } = await loadAndParse(req.body);

    // ---- 4. Αποθήκευση ως schedule (ίδια λογική με το /api/schedule/save) ----
    const [prevRows] = await pool.query(
      'SELECT data FROM schedules WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1',
      [weekStart]
    );
    const prevState = prevRows[0] ? JSON.parse(prevRows[0].data).state : null;
    const state = await computeStateFromAssignments(weekStart, assignments, prevState);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [ins] = await conn.query(
        'INSERT INTO schedules (week_start, data) VALUES (?, ?)',
        [weekStart, JSON.stringify({ assignments, state, report: { imported: true } })]
      );
      for (const a of assignments) {
        await conn.query(
          `INSERT INTO assignments
           (schedule_id, agent_id, date, start_time, end_time, color_argb, is_manual_edit)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [ins.insertId, a.agentId, a.date, a.start, a.end, a.color]
        );
      }
      await conn.commit();
      res.json({
        ok: true,
        weekStart,
        imported: assignments.length,
        unmatchedNames: [...unmatched],
        note: 'Οι ώρες προκύπτουν από τις ωριαίες ζώνες (οι μισές ώρες από τα σκούρα κίτρινα κελιά).',
        nightShifts: nightInfo
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    fail(res, err, 'import');
  }
});

// POST /api/import/preview  body: {weekStart, fileBase64}
// Διαβάζει το Excel ΧΩΡΙΣ αποθήκευση και επιστρέφει ανά agent τι διάβασε +
// το «σερί» με το οποίο μπαίνει στην επόμενη εβδομάδα (για να ελέγξει ο
// χρήστης ότι διαβάστηκε σωστά ΠΡΙΝ πατήσει SOS — 15/07/2026).
router.post('/preview', async (req, res) => {
  try {
    const { weekStart, assignments, unmatched, nightInfo } = await loadAndParse(req.body);

    const [prevRows] = await pool.query(
      'SELECT data FROM schedules WHERE week_start < ? ORDER BY week_start DESC, id DESC LIMIT 1',
      [weekStart]
    );
    const prevState = prevRows[0] ? JSON.parse(prevRows[0].data).state : null;
    const endState = await computeStateFromAssignments(weekStart, assignments, prevState);

    const [agents] = await pool.query('SELECT id, full_name FROM agents WHERE active = 1 ORDER BY full_name');
    const dates = [];
    for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i));

    // Χάρτης agentId|date → βάρδια
    const byKey = new Map();
    for (const a of assignments) byKey.set(`${a.agentId}|${a.date}`, a);

    const rows = agents.map((ag) => {
      const days = dates.map((d) => {
        const a = byKey.get(`${ag.id}|${d}`);
        return a ? `${a.start}-${a.end}` : null;
      });
      const workDays = days.filter(Boolean).length;
      const st = (endState && endState[ag.id]) || {};
      return {
        agentId: ag.id,
        name: ag.full_name,
        days,
        workDays,
        // σερί με το οποίο ΜΠΑΙΝΕΙ στην επόμενη εβδομάδα (πόσες συνεχόμενες
        // εργάσιμες κλείνει η Κυριακή) — αυτό ελέγχει το Κ10 στη Δευτέρα
        streakInto: st.streak || 0,
        pendingNightRest: st.pendingNightRest || 0,
        inFile: workDays > 0
      };
    });

    res.json({
      ok: true,
      weekStart,
      dates,
      rows,
      unmatchedNames: unmatched,
      totalShifts: assignments.length,
      nightShifts: nightInfo
    });
  } catch (err) {
    fail(res, err, 'import');
  }
});

module.exports = router;
// Εσωτερικά — ΜΟΝΟ για tests (ο router μένει το κανονικό export)
module.exports._test = { parseSchedule, loadAndParse, tagNightShifts, nightLabelsByColor, ARGB };
