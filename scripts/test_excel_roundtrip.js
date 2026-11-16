// Integration test ΟΛΗΣ της διαδρομής, ΧΩΡΙΣ πραγματική βάση (14/11/2026):
//
//   generateWeek → Excel export → Excel import → ανακατασκευή assignments
//   → computeStateFromAssignments → validateWeek → επόμενη εβδομάδα
//
// Το κρίσιμο που ελέγχει: οι ΔΥΟ βάρδιες 23:00-07:00 («Vega Bank» Κ9 και
// «Νυχτερινή Atlas») έχουν ΙΔΙΟ ωράριο και ξεχωρίζουν μόνο από την
// ετικέτα. Στο Excel η πληροφορία επιβιώνει ως ΧΡΩΜΑ ρόλου· το import την
// μεταφράζει πίσω σε reqLabel.
//
// Η βάση αντικαθίσταται από in-memory fake pool μέσω require.cache — ΔΕΝ
// χρειάζεται MySQL και ΔΕΝ αγγίζει κανένα πραγματικό περιβάλλον.
//
// Χρήση: node scripts/test_excel_roundtrip.js
const path = require('path');
const ExcelJS = require('exceljs');

let fail = 0;
let pass = 0;
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}

// ══════════════════════════════════════════════════════════════════
// 1. In-memory βάση + fake pool (πριν από κάθε require που το χρησιμοποιεί)
// ══════════════════════════════════════════════════════════════════
const K9_LBL = 'Verification & call υπόλοιπα';
const NIGHT_LBL = 'Νυχτερινή Atlas';
const C_VERIF = 'FFA6A6A6';
const C_EURO = 'FF66CCFF';

const DB = {
  roles: [
    { id: 1, name: 'Verification', color_argb: C_VERIF },
    { id: 2, name: 'Atlas', color_argb: C_EURO }
  ],
  skills: [{ id: 1, name: 'ATLAS' }],
  agents: [
    // Στη λίστα Κ9, ΧΩΡΙΣ can_night — αυτός παίρνει την Vega Bank
    { id: 1, full_name: 'ΑΛΕΞΙΟΥ ΔΙΟΝΥΣΗΣ', company: 'T', departments: '["verification","call"]', active: 1, can_night: 0, is_new: 0, fixed_shift_start: null, fixed_shift_end: null, fixed_days: null, fixed_days_off: null, weekend_shift: null, work_location: 'office' },
    // ΕΚΤΟΣ λίστας, ΜΕ can_night + ATLAS — αυτός παίρνει τη νυχτερινή
    { id: 2, full_name: 'ΠΑΠΑΔΟΠΟΥΛΟΣ ΑΝΔΡΕΑΣ', company: 'T', departments: '["call"]', active: 1, can_night: 1, is_new: 0, fixed_shift_start: null, fixed_shift_end: null, fixed_days: null, fixed_days_off: null, weekend_shift: null, work_location: 'office' },
    { id: 3, full_name: 'ΛΑΖΑΡΙΔΟΥ ΔΑΝΑΗ', company: 'T', departments: '["call"]', active: 1, can_night: 0, is_new: 0, fixed_shift_start: null, fixed_shift_end: null, fixed_days: null, fixed_days_off: null, weekend_shift: null, work_location: 'office' },
    { id: 4, full_name: 'ΜΠΑΛΤΑ ΕΦΗ', company: 'T', departments: '["call"]', active: 1, can_night: 0, is_new: 0, fixed_shift_start: null, fixed_shift_end: null, fixed_days: null, fixed_days_off: null, weekend_shift: null, work_location: 'office' },
    { id: 5, full_name: 'ΓΙΑΝΝΑΚΟΥ ΓΕΩΡΓΙΑ', company: 'T', departments: '["call"]', active: 1, can_night: 0, is_new: 0, fixed_shift_start: null, fixed_shift_end: null, fixed_days: null, fixed_days_off: null, weekend_shift: null, work_location: 'office' }
  ],
  agent_skills: [
    { agent_id: 2, skill_id: 1 }, { agent_id: 3, skill_id: 1 },
    { agent_id: 4, skill_id: 1 }, { agent_id: 5, skill_id: 1 }
  ],
  agent_constraints: [],
  shift_requirements: [],
  shift_eligibility: [
    { id: 1, agent_id: 1, shift_start: '23:00', shift_end: '07:00', max_per_week: 3, location: 'office', not_alone: 0, notes: null }
  ],
  time_off: [],
  schedules: []
};

// Απαιτήσεις: ΟΙ ΔΥΟ βάρδιες 23:00-07:00 με διαφορετικό ρόλο/χρώμα + μία πρωινή
let rid = 0;
for (const day_type of ['weekday', 'weekend']) {
  DB.shift_requirements.push(
    { id: ++rid, day_type, start_time: '08:00', end_time: '16:00', skill_id: 1, department: 'call', period: 'morning', headcount: 2, label: 'Atlas (μόνο)', role_id: 2 },
    { id: ++rid, day_type, start_time: '23:00', end_time: '07:00', skill_id: null, department: null, period: null, headcount: 1, label: K9_LBL, role_id: 1 },
    { id: ++rid, day_type, start_time: '23:00', end_time: '07:00', skill_id: 1, department: null, period: null, headcount: 1, label: NIGHT_LBL, role_id: 2 }
  );
}

const q = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const fakePool = {
  async query(sql, params = []) {
    const s = q(sql);
    if (/FROM agents WHERE active = 1/.test(s)) return [DB.agents.filter((a) => a.active === 1), []];
    if (/FROM agent_skills/.test(s)) {
      return [DB.agent_skills.map((x) => ({ agent_id: x.agent_id, name: DB.skills.find((s2) => s2.id === x.skill_id).name })), []];
    }
    if (/FROM agent_constraints/.test(s)) return [DB.agent_constraints, []];
    if (/FROM shift_requirements sr/.test(s) && /roles ro/.test(s) && /DISTINCT/.test(s)) {
      // nightLabelsByColor του import
      return [DB.shift_requirements
        .filter((r) => r.start_time === '23:00' && r.end_time === '07:00')
        .map((r) => ({ label: r.label, color_argb: DB.roles.find((x) => x.id === r.role_id).color_argb })), []];
    }
    if (/FROM shift_requirements sr/.test(s)) {
      return [DB.shift_requirements.map((r) => ({
        ...r,
        skill_name: r.skill_id ? DB.skills.find((x) => x.id === r.skill_id).name : null,
        role_name: r.role_id ? DB.roles.find((x) => x.id === r.role_id).name : null,
        color_argb: r.role_id ? DB.roles.find((x) => x.id === r.role_id).color_argb : null
      })), []];
    }
    if (/FROM shift_eligibility/.test(s)) return [DB.shift_eligibility, []];
    // Επιθυμητές ώρες (15/11/2026): το fixture δεν έχει αιτήματα — κενή λίστα
    if (/FROM shift_wishes/.test(s)) return [DB.shift_wishes || [], []];
    if (/FROM time_off/.test(s)) return [DB.time_off, []];
    if (/FROM roles/.test(s)) return [DB.roles, []];
    if (/FROM schedules/.test(s)) return [DB.schedules, []];
    throw new Error('fakePool: αταίριαστο SQL → ' + s.slice(0, 120));
  },
  async getConnection() { return { query: fakePool.query, release() {}, async beginTransaction() {}, async commit() {}, async rollback() {} }; },
  async end() {}
};

// Εμφύτευση του fake pool ΠΡΙΝ φορτωθούν τα modules που το χρησιμοποιούν
const poolPath = require.resolve('../src/db/pool');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };

const { generateWeek, K9_LABEL, NIGHT_LABEL } = require('../src/scheduler/engine');
const { loadContext } = require('../src/scheduler/context');
const { computeStateFromAssignments, validateWeek } = require('../src/scheduler/validate');
const { buildWeekSheet } = require('../src/routes/export')._test;
const { loadAndParse, tagNightShifts, ARGB } = require('../src/routes/import')._test;
const { addDays } = require('../src/utils/dates');

ta('canonical labels: engine == test fixtures', K9_LABEL === K9_LBL && NIGHT_LABEL === NIGHT_LBL,
  `engine: "${K9_LABEL}" / "${NIGHT_LABEL}"`);

const WEEK = '2026-11-16';  // Δευτέρα
const NEXT = addDays(WEEK, 7);
const isK9 = (a) => !a.off && a.start === '23:00' && a.end === '07:00' && a.reqLabel === K9_LBL;
const isNight = (a) => !a.off && a.start === '23:00' && a.end === '07:00' && a.reqLabel === NIGHT_LBL;

(async () => {
  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 1. Δημιουργία εβδομάδας ===');
  const ctx = await loadContext(WEEK, addDays(WEEK, 6));
  const gen = generateWeek(ctx, WEEK, {});
  const genK9 = gen.assignments.filter(isK9);
  const genNight = gen.assignments.filter((a) => !a.off && a.reqLabel === NIGHT_LBL);
  ta(`παρήχθησαν βραδινές Κ9: ${genK9.length}`, genK9.length > 0);
  ta(`παρήχθησαν νυχτερινές Atlas: ${genNight.length}`, genNight.length > 0);
  ta('η Κ9 πήγε στον ΑΛΕΞΙΟΥ (λίστα, χωρίς can_night)', genK9.every((a) => a.agentId === 1));
  ta('η νυχτερινή πήγε στον ΠΑΠΑΔΟΠΟΥΛΟΣ (can_night+ATLAS)', genNight.every((a) => a.agentId === 2));
  ta('τα χρώματα των δύο βαρδιών διαφέρουν στην παραγωγή',
    genK9.every((a) => a.color === C_VERIF) && genNight.every((a) => a.color === C_EURO),
    `Κ9=${[...new Set(genK9.map((a) => a.color))]} νύχτα=${[...new Set(genNight.map((a) => a.color))]}`);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Export σε Excel ===');
  const wb = new ExcelJS.Workbook();
  buildWeekSheet(wb, 'test', WEEK, gen.assignments);
  const buf = await wb.xlsx.writeBuffer();
  ta(`το αρχείο γράφτηκε (${Math.round(buf.length / 1024)} KB)`, buf.length > 3000);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 3-4. Import του ΙΔΙΟΥ Excel + ανακατασκευή ===');
  const parsed = await loadAndParse({ weekStart: WEEK, fileBase64: Buffer.from(buf).toString('base64') });
  const imp = parsed.assignments;
  const impK9 = imp.filter(isK9);
  const impNight = imp.filter(isNight);
  console.log(`       (διαβάστηκαν ${imp.length} βάρδιες, αγνώριστα ονόματα: ${parsed.unmatched.length})`);
  console.log(`       (nightShifts: tagged=${parsed.nightInfo.tagged}, ambiguous=${parsed.nightInfo.ambiguous})`);

  ta('Η Κ9 ΠΑΡΑΜΕΝΕΙ Κ9 μετά το import',
    impK9.length === genK9.length,
    `πριν ${genK9.length} → μετά ${impK9.length}`);
  ta('Η νυχτερινή Atlas ΠΑΡΑΜΕΝΕΙ νυχτερινή Atlas',
    impNight.length === genNight.filter((a) => a.start === '23:00' && a.end === '07:00').length,
    `πριν ${genNight.length} → μετά ${impNight.length}`);
  ta('καμία βάρδια 23:00-07:00 δεν έμεινε ΧΩΡΙΣ ταυτότητα',
    imp.filter((a) => a.start === '23:00' && a.end === '07:00' && !a.reqLabel).length === 0);
  ta('ΚΑΜΙΑ διασταύρωση εργαζομένων μεταξύ των δύο βαρδιών',
    impK9.every((a) => a.agentId === 1) && impNight.every((a) => a.agentId === 2),
    `Κ9 → ${[...new Set(impK9.map((a) => a.agentId))]}, νύχτα → ${[...new Set(impNight.map((a) => a.agentId))]}`);
  ta('οι ημερομηνίες των Κ9 διατηρήθηκαν',
    JSON.stringify(impK9.map((a) => a.date).sort()) === JSON.stringify(genK9.map((a) => a.date).sort()),
    `πριν ${genK9.map((a) => a.date).sort()} → μετά ${impK9.map((a) => a.date).sort()}`);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 5. computeStateFromAssignments ===');
  const stImported = await computeStateFromAssignments(WEEK, imp, null);
  const stGenerated = gen.nextState;
  const s1 = stImported[1] || {};
  const s1g = stGenerated[1] || {};

  const c1903Import = s1.count1903;  // σωρευτικό — το μεταλλάσσει η επόμενη εβδομάδα
  ta(`count1903 του Κ9 διατηρείται: import ${s1.count1903} == generator ${s1g.count1903}`,
    s1.count1903 === s1g.count1903 && s1.count1903 > 0,
    'χάθηκε το ιστορικό της βραδινής Κ9');
  ta(`η Κ9 ΔΕΝ μετράει ως νυχτερινή: nights=${s1.nights}`, (s1.nights || 0) === 0,
    'η βραδινή Κ9 προσμετρήθηκε λανθασμένα στις νυχτερινές (Κ7)');
  ta(`η Κ9 ΔΕΝ αυξάνει λανθασμένα το pendingNightRest: ${s1.pendingNightRest}`,
    (s1.pendingNightRest || 0) === (s1g.pendingNightRest || 0),
    `import ${s1.pendingNightRest} vs generator ${s1g.pendingNightRest}`);
  // Ο νυχτερινός ΠΡΕΠΕΙ να μετράει ως νυχτερινός
  ta(`ο νυχτερινός μετράει κανονικά: nights=${(stImported[2] || {}).nights}`,
    ((stImported[2] || {}).nights || 0) > 0);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 6. validateWeek ===');
  const v = await validateWeek({ weekStart: WEEK, assignments: imp, prevAssignments: [], prevState: null, nextAssignments: [] });
  const k7 = v.warnings.filter((w) => /Κ7/.test(w.text));
  const k9w = v.warnings.filter((w) => /Κ9/.test(w.text));
  ta(`ΚΑΝΕΝΑ ψευδές warning Κ7 (βρήκα ${k7.length})`, k7.length === 0,
    k7.map((w) => `${w.date}: ${w.text}`).join('\n          '));
  ta(`ΚΑΝΕΝΑ warning Κ9 (βρήκα ${k9w.length})`, k9w.length === 0,
    k9w.map((w) => `${w.date}: ${w.text}`).join('\n          '));

  // ΨΕΥΔΩΣ ακάλυπτη = ακάλυπτη στον validator αλλά ΟΧΙ στον generator.
  // (Το fixture έχει επίτηδες λίγα άτομα — κάποια slots είναι ΟΝΤΩΣ ακάλυπτα
  // και ο generator τα αναφέρει. Το κρίσιμο είναι να μην ΠΡΟΣΘΕΣΕΙ το import.)
  const sigU = (arr) => new Set(arr
    .filter((u) => u.label === K9_LBL || u.label === NIGHT_LBL)
    .map((u) => `${u.date}|${u.label}`));
  const genUnc = sigU(gen.report.uncovered);
  const valUnc = sigU(v.uncovered);
  const extra = [...valUnc].filter((x) => !genUnc.has(x));
  const missing = [...genUnc].filter((x) => !valUnc.has(x));
  console.log(`       (ακάλυπτα 23:00-07:00 — generator: ${genUnc.size}, validator μετά το import: ${valUnc.size})`);
  ta(`ΚΑΜΙΑ ψευδώς ακάλυπτη απαίτηση 23:00-07:00 (έξτρα: ${extra.length})`, extra.length === 0,
    extra.join(', '));
  ta(`δεν «εξαφανίστηκε» ακάλυπτο slot (λείπουν: ${missing.length})`, missing.length === 0,
    missing.join(', '));
  // Τα slots που ΚΑΛΥΦΘΗΚΑΝ πραγματικά αναγνωρίζονται μετά το import
  ta('όλες οι τοποθετημένες 23:00-07:00 αναγνωρίστηκαν ως καλυμμένες',
    genUnc.size + impK9.length + impNight.length === 14,
    `${genUnc.size} ακάλυπτα + ${impK9.length} Κ9 + ${impNight.length} νύχτα ≠ 14 (2 βάρδιες × 7 μέρες)`);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 7. Δημιουργία ΕΠΟΜΕΝΗΣ εβδομάδας από το εισηγμένο ===');
  const ctx2 = await loadContext(NEXT, addDays(NEXT, 6));
  const nextW = generateWeek(ctx2, NEXT, stImported);
  const nK9 = nextW.assignments.filter(isK9);
  const nNight = nextW.assignments.filter(isNight);
  ta(`η επόμενη εβδομάδα παρήγαγε Κ9: ${nK9.length}`, nK9.length > 0);
  ta(`η επόμενη εβδομάδα παρήγαγε νυχτερινές: ${nNight.length}`, nNight.length > 0);
  ta('η ταυτότητα διατηρείται και στην επόμενη εβδομάδα',
    nK9.every((a) => a.agentId === 1) && nNight.every((a) => a.agentId === 2));
  // Σύγκριση με τη ΓΕΝΝΗΜΕΝΗ κατάσταση: ίδιο αποτέλεσμα = δεν χάθηκε πληροφορία
  const nextFromGen = generateWeek(await loadContext(NEXT, addDays(NEXT, 6)), NEXT, stGenerated);
  const sig = (r) => r.assignments.filter((a) => !a.off).map((a) => `${a.agentId}|${a.date}|${a.start}-${a.end}`).sort().join(';');
  ta('επόμενη εβδομάδα ΙΔΙΑ από εισηγμένη και από παραγόμενη κατάσταση',
    sig(nextW) === sig(nextFromGen),
    'η κατάσταση που βγαίνει από το Excel διαφέρει από του generator');
  const audit = nextW.report.soft.filter((s) => String(s).startsWith('ΕΛΕΓΧΟΣ ΚΑΝΟΝΩΝ:'));
  ta('phaseRulesAudit καθαρό στην επόμενη εβδομάδα', audit.length === 0, audit.join('\n          '));

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 8. Οριακές περιπτώσεις χρώματος (καμία αυθαίρετη ταξινόμηση) ===');
  const map = new Map([[C_VERIF, K9_LBL], [C_EURO, NIGHT_LBL]]);
  const probe = (color) => {
    const rows = [{ start: '23:00', end: '07:00', color }];
    const info = tagNightShifts(rows, map);
    return { label: rows[0].reqLabel, info };
  };
  ta('γκρι FFA6A6A6 → Κ9', probe(C_VERIF).label === K9_LBL);
  ta('μπλε FF66CCFF → νυχτερινή Atlas', probe(C_EURO).label === NIGHT_LBL);
  ta('πεζά ffa6a6a6 → Κ9 (κανονικοποίηση)', probe('ffa6a6a6').label === K9_LBL);
  ta('6ψήφιο A6A6A6 → Κ9 (χωρίς κανάλι διαφάνειας)', probe('A6A6A6').label === K9_LBL);
  ta('μορφή #A6A6A6 → Κ9', probe('#A6A6A6').label === K9_LBL);
  ta('ΑΓΝΩΣΤΟ χρώμα FF123456 → ΚΑΜΙΑ ετικέτα', probe('FF123456').label === undefined);
  ta('ΚΕΝΟ χρώμα (null) → ΚΑΜΙΑ ετικέτα', probe(null).label === undefined);
  ta('άδειο string → ΚΑΜΙΑ ετικέτα', probe('').label === undefined);
  ta('άκυρη μορφή "theme" → ΚΑΜΙΑ ετικέτα', probe('theme').label === undefined);
  ta('άγνωστο χρώμα μετράται ως ambiguous', probe('FF123456').info.ambiguous === 1);
  // Διφορούμενος χάρτης (δύο βάρδιες με ΙΔΙΟ χρώμα) → καμία εικασία
  {
    const ambiguousMap = new Map([[C_VERIF, null]]);
    const rows = [{ start: '23:00', end: '07:00', color: C_VERIF }];
    tagNightShifts(rows, ambiguousMap);
    ta('ΔΙΦΟΡΟΥΜΕΝΟ χρώμα (ίδιο σε δύο βάρδιες) → ΚΑΜΙΑ ετικέτα', rows[0].reqLabel === undefined);
  }
  // Η αντιστοίχιση ΔΕΝ αγγίζει άλλες ώρες
  {
    const rows = [
      { start: '08:00', end: '16:00', color: C_VERIF },
      { start: '23:30', end: '07:30', color: C_EURO },
      { start: '16:00', end: '24:00', color: C_EURO }
    ];
    tagNightShifts(rows, map);
    ta('ΜΟΝΟ οι 23:00-07:00 παίρνουν ετικέτα (08:00/23:30/16:00 άθικτες)',
      rows.every((r) => r.reqLabel === undefined));
  }
  ta('ARGB: 8ψήφιο αμετάβλητο', ARGB('FFA6A6A6') === 'FFA6A6A6');
  ta('ARGB: άκυρο → null', ARGB('zz') === null && ARGB(undefined) === null);

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 9. Negative control: ΧΩΡΙΣ την αντιστοίχιση η αλυσίδα ΣΠΑΖΕΙ ===');
  // Τεκμηριώνει ΓΙΑΤΙ υπάρχει η διόρθωση: με τις ίδιες γραμμές αλλά χωρίς
  // reqLabel, η βραδινή Κ9 περνά ως νυχτερινή και χαλάει η συνέχεια.
  // Αν κάποιος αφαιρέσει το tagNightShifts, το test 5/6 παραπάνω θα πέσει —
  // εδώ κλειδώνουμε και το ΑΝΤΙΣΤΡΟΦΟ, ώστε να μη «περνά» κατά λάθος.
  {
    const stripped = imp.map((a) => {
      const c = { ...a };
      if (c.start === '23:00' && c.end === '07:00') delete c.reqLabel;
      return c;
    });
    const stBad = await computeStateFromAssignments(WEEK, stripped, null);
    const bad1 = stBad[1] || {};
    ta(`χωρίς reqLabel: η Κ9 μετριέται ως νυχτερινή (nights=${bad1.nights} > 0)`,
      (bad1.nights || 0) > 0, 'το negative control δεν αναπαράγει το bug — έλεγξε το test');
    ta(`χωρίς reqLabel: χάνεται το count1903 (${bad1.count1903 || 0} αντί ${c1903Import})`,
      (bad1.count1903 || 0) === 0);
    const vBad = await validateWeek({ weekStart: WEEK, assignments: stripped, prevAssignments: [], prevState: null, nextAssignments: [] });
    const k7Bad = vBad.warnings.filter((w) => /Κ7/.test(w.text));
    ta(`χωρίς reqLabel: εμφανίζονται ψευδή warnings Κ7 (${k7Bad.length})`, k7Bad.length > 0);
    const uncBad = sigU(vBad.uncovered);
    ta(`χωρίς reqLabel: ψευδώς ακάλυπτα (${uncBad.size} αντί ${valUnc.size})`, uncBad.size > valUnc.size);
  }

  console.log(`\n${fail === 0 ? '✔ ΟΛΑ ΠΕΡΑΣΑΝ' : '✘ ' + fail + ' ΑΠΕΤΥΧΑΝ'}  (${pass} ok, ${fail} fail)\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nΣΦΑΛΜΑ ΕΚΤΕΛΕΣΗΣ:', e && e.stack ? e.stack : e);
  process.exit(1);
});
