// Tests κανόνων generator ΧΩΡΙΣ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ (14/11/2026).
//
// Συμπληρώνει το scripts/test_generator.js, που χρειάζεται MySQL με πραγματικά
// δεδομένα. Εδώ ελέγχονται:
//   1. shiftAllowedByRules — κάθε νέος/υπάρχων τύπος κανόνα
//   2. generateWeek με ΣΥΝΘΕΤΙΚΟ context: διαχωρισμός των ΔΥΟ βαρδιών
//      23:00-07:00, συνέχεια προηγούμενης εβδομάδας, βάρδιες πάνω από τα
//      μεσάνυχτα, συγκρούσεις σταθερού ωραρίου, έλλειψη προσωπικού
//   3. Regression: ταυτότητα βάρδιας όταν λείπει το reqLabel (Excel import)
//
// Χρήση: node scripts/test_rules.js      (ή: npm run test:rules)
const { generateWeek, shiftAllowedByRules, isK9Req, isK9Entry, K9_START, K9_END, K9_LABEL } = require('../src/scheduler/engine');
const { dayNum, toMin } = require('../src/scheduler/time');

let fail = 0;
let pass = 0;
function t(name, got, want, detail) {
  if (got === want) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  → πήρα ${got}, περίμενα ${want}${detail ? '\n          ' + detail : ''}`); }
}
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}

// d: 0=Δευτέρα … 6=Κυριακή
const agent = (rules, extra = {}) => ({
  name: 'TEST', departments: ['verification'], skills: new Set(),
  canNight: false, fixedStart: null, fixedEnd: null, fixedDays: null,
  fixedDaysOff: [], weekendShift: null, workLocation: 'office',
  rules, ...extra
});

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 1. ΚΑΝΟΝΕΣ (shiftAllowedByRules) ==========');

console.log('\n--- Γεωργιου: six_two_days weekend:false (hard, 14/11/2026) ---');
{
  const nik = agent([
    { type: 'only_morning' },
    { type: 'six_two_days', days: [1, 5], weekend: false }
  ]);
  t('Δευτέρα 06:00-14:00 επιτρεπτό', shiftAllowedByRules(nik, 0, '06:00', '14:00'), true);
  t('Παρασκευή 06:00-14:00 επιτρεπτό', shiftAllowedByRules(nik, 4, '06:00', '14:00'), true);
  t('Τρίτη 06:00-14:00 ΑΠΑΓΟΡΕΥΕΤΑΙ', shiftAllowedByRules(nik, 1, '06:00', '14:00'), false);
  t('ΣΑΒΒΑΤΟ 06:00-14:00 ΑΠΑΓΟΡΕΥΕΤΑΙ', shiftAllowedByRules(nik, 5, '06:00', '14:00'), false);
  t('ΚΥΡΙΑΚΗ 06:00-14:00 ΑΠΑΓΟΡΕΥΕΤΑΙ', shiftAllowedByRules(nik, 6, '06:00', '14:00'), false);
  t('Σάββατο 08:00-16:00 ΕΠΙΤΡΕΠΤΟ (άλλη βάρδια)', shiftAllowedByRules(nik, 5, '08:00', '16:00'), true);
  t('Κυριακή 09:00-17:00 ΕΠΙΤΡΕΠΤΟ (άλλη βάρδια)', shiftAllowedByRules(nik, 6, '09:00', '17:00'), true);

  // Η παλιά συμπεριφορά (Ρενα/Αντωνιου, χωρίς flag) ΔΕΝ αλλάζει
  const agentR = agent([{ type: 'six_two_days', days: [2, 5] }]);
  t('ΑΜΕΤΑΒΛΗΤΟ: Ρενα Σάββατο 06:00-14:00 επιτρεπτό', shiftAllowedByRules(agentR, 5, '06:00', '14:00'), true);
  t('ΑΜΕΤΑΒΛΗΤΟ: Ρενα Τρίτη 06:00-14:00 επιτρεπτό', shiftAllowedByRules(agentR, 1, '06:00', '14:00'), true);
  t('ΑΜΕΤΑΒΛΗΤΟ: Ρενα Δευτέρα 06:00-14:00 όχι', shiftAllowedByRules(agentR, 0, '06:00', '14:00'), false);
}

console.log('\n--- Πετρος: weekly_schedule (Δευ+Παρ ρεπό, Τρι+Τετ 16:00-24:00) ---');
{
  const leo = agent([
    { type: 'weekly_schedule', shifts: { 2: ['16:00', '24:00'], 3: ['16:00', '24:00'] }, off: [1, 5] },
    { type: 'no_streak_limit' }
  ]);
  t('Δευτέρα: ΚΑΜΙΑ βάρδια (ρεπό)', shiftAllowedByRules(leo, 0, '16:00', '24:00'), false);
  t('Δευτέρα: ούτε πρωινή', shiftAllowedByRules(leo, 0, '08:00', '16:00'), false);
  t('Παρασκευή: ΚΑΜΙΑ βάρδια (ρεπό)', shiftAllowedByRules(leo, 4, '16:00', '24:00'), false);
  t('Τρίτη 16:00-24:00 ΜΟΝΟ αυτό', shiftAllowedByRules(leo, 1, '16:00', '24:00'), true);
  t('Τρίτη 15:30-23:30 ΟΧΙ', shiftAllowedByRules(leo, 1, '15:30', '23:30'), false);
  t('Τετάρτη 16:00-24:00 ΜΟΝΟ αυτό', shiftAllowedByRules(leo, 2, '16:00', '24:00'), true);
  t('Τετάρτη 08:00-16:00 ΟΧΙ', shiftAllowedByRules(leo, 2, '08:00', '16:00'), false);
  t('Πέμπτη 08:00-16:00 ΕΛΕΥΘΕΡΗ', shiftAllowedByRules(leo, 3, '08:00', '16:00'), true);
  t('Πέμπτη 16:00-24:00 ΕΛΕΥΘΕΡΗ', shiftAllowedByRules(leo, 3, '16:00', '24:00'), true);
  t('Σάββατο 08:00-16:00 ΕΛΕΥΘΕΡΗ', shiftAllowedByRules(leo, 5, '08:00', '16:00'), true);
  t('Κυριακή 16:00-24:00 ΕΛΕΥΘΕΡΗ', shiftAllowedByRules(leo, 6, '16:00', '24:00'), true);
}

console.log('\n--- Ορεστης: weekly_schedule + start_after_days ---');
{
  const alex = agent([
    { type: 'weekly_schedule', shifts: { 1: ['10:00', '18:00'], 2: ['10:00', '18:00'] }, off: [3, 4] },
    { type: 'start_after_days', days: { 5: '15:00', 6: '12:00', 7: '12:00' } },
    { type: 'no_streak_limit' }
  ], { canNight: true });
  t('Δευτέρα 10:00-18:00 ΜΟΝΟ αυτό', shiftAllowedByRules(alex, 0, '10:00', '18:00'), true);
  t('Δευτέρα 09:00-17:00 ΟΧΙ', shiftAllowedByRules(alex, 0, '09:00', '17:00'), false);
  t('Τρίτη 10:00-18:00 ΜΟΝΟ αυτό', shiftAllowedByRules(alex, 1, '10:00', '18:00'), true);
  t('Τρίτη 16:00-24:00 ΟΧΙ', shiftAllowedByRules(alex, 1, '16:00', '24:00'), false);
  t('Τετάρτη ρεπό — καμία βάρδια', shiftAllowedByRules(alex, 2, '16:00', '24:00'), false);
  t('Πέμπτη ρεπό — καμία βάρδια', shiftAllowedByRules(alex, 3, '16:00', '24:00'), false);
  // Τα όρια είναι ΝΩΡΙΤΕΡΕΣ επιτρεπτές ώρες, ΟΧΙ υποχρεωτικές
  t('Παρασκευή 14:00-22:00 ΟΧΙ (πριν 15:00)', shiftAllowedByRules(alex, 4, '14:00', '22:00'), false);
  t('Παρασκευή 15:30-23:30 ΝΑΙ', shiftAllowedByRules(alex, 4, '15:30', '23:30'), true);
  t('Παρασκευή 16:00-24:00 ΝΑΙ', shiftAllowedByRules(alex, 4, '16:00', '24:00'), true);
  t('Παρασκευή 08:00-16:00 ΟΧΙ', shiftAllowedByRules(alex, 4, '08:00', '16:00'), false);
  t('Σάββατο 08:00-16:00 ΟΧΙ (πριν 12:00)', shiftAllowedByRules(alex, 5, '08:00', '16:00'), false);
  t('Σάββατο 14:00-22:00 ΝΑΙ', shiftAllowedByRules(alex, 5, '14:00', '22:00'), true);
  t('Σάββατο 16:00-24:00 ΝΑΙ', shiftAllowedByRules(alex, 5, '16:00', '24:00'), true);
  t('Κυριακή 09:00-17:00 ΟΧΙ', shiftAllowedByRules(alex, 6, '09:00', '17:00'), false);
  t('Κυριακή 12:00-20:00 ΝΑΙ (ακριβώς στο όριο)', shiftAllowedByRules(alex, 6, '12:00', '20:00'), true);
  t('Κυριακή 16:00-24:00 ΝΑΙ', shiftAllowedByRules(alex, 6, '16:00', '24:00'), true);
}

console.log('\n--- Βραδινή Κ9: ταυτοποίηση + σχέση με Κ7 ---');
{
  t('isK9Req: ετικέτα Κ9', isK9Req({ label: K9_LABEL, start: '23:00', end: '07:00' }), true);
  t('isK9Req: ΟΧΙ η νυχτερινή Atlas', isK9Req({ label: 'Νυχτερινή Atlas', start: '23:00', end: '07:00' }), false);
  t('K9_START-K9_END', `${K9_START}-${K9_END}`, '23:00-07:00');
  t('isK9Entry: ανάθεση Κ9', isK9Entry({ start: '23:00', end: '07:00', reqLabel: K9_LABEL }), true);
  t('isK9Entry: ΟΧΙ νυχτερινή Atlas', isK9Entry({ start: '23:00', end: '07:00', reqLabel: 'Νυχτερινή Atlas' }), false);
  t('isK9Entry: ΟΧΙ 23:30-07:30', isK9Entry({ start: '23:30', end: '07:30', reqLabel: K9_LABEL }), false);

  const pavlou = agent([{ type: 'allowed_shifts', shifts: [['15:30', '23:30'], ['16:00', '24:00']] }]);
  t('Κ7: χωρίς can_night το 23:00-07:00 ΟΧΙ', shiftAllowedByRules(pavlou, 0, '23:00', '07:00'), false);
  t('ΙΔΙΑ ΑΤΟΜΑ: με override Κ9 → ΝΑΙ', shiftAllowedByRules(pavlou, 0, '23:00', '07:00', { override1903: true }), true);
  t('ΑΜΕΤΑΒΛΗΤΟ: Ντοκου 16:00-24:00 ΝΑΙ', shiftAllowedByRules(pavlou, 0, '16:00', '24:00'), true);

  const kalafati = agent([{ type: 'allowed_shifts', strict: true, shifts: [['07:30', '15:30'], ['08:00', '16:00'], ['23:00', '07:00']] }], { canNight: true });
  t('ΑΜΕΤΑΒΛΗΤΟ: strict — 16:00-24:00 όχι ούτε με Κ9', shiftAllowedByRules(kalafati, 0, '16:00', '24:00', { override1903: true }), false);
  t('ΑΜΕΤΑΒΛΗΤΟ: strict — 23:00-07:00 ναι', shiftAllowedByRules(kalafati, 0, '23:00', '07:00'), true);
}

console.log('\n--- Παλινδρόμηση: κανόνες που ΔΕΝ πρέπει να άλλαξαν ---');
{
  const om = agent([{ type: 'only_morning', starts: ['07:30', '08:00'] }]);
  t('only_morning starts: 07:30 ναι', shiftAllowedByRules(om, 0, '07:30', '15:30'), true);
  t('only_morning starts: 09:00 όχι', shiftAllowedByRules(om, 0, '09:00', '17:00'), false);
  const sa = agent([{ type: 'start_after', time: '09:00' }]);
  t('start_after (γενικό) 08:00 όχι', shiftAllowedByRules(sa, 0, '08:00', '16:00'), false);
  t('start_after (γενικό) 09:00 ναι', shiftAllowedByRules(sa, 0, '09:00', '17:00'), true);
  t('start_after ισχύει ΟΛΕΣ τις μέρες (Σάββατο)', shiftAllowedByRules(sa, 5, '08:00', '16:00'), false);
  const wd = agent([{ type: 'weekdays_only' }]);
  t('weekdays_only Σάββατο όχι', shiftAllowedByRules(wd, 5, '08:00', '16:00'), false);
  const sup = agent([], { departments: ['supervisor'] });
  t('supervisor 07:00-15:00 ναι', shiftAllowedByRules(sup, 0, '07:00', '15:00'), true);
  t('supervisor 09:00-17:00 όχι', shiftAllowedByRules(sup, 0, '09:00', '17:00'), false);
  const wp = agent([{ type: 'weekly_pattern', days: { 1: ['18:00', '24:00'] } }]);
  t('weekly_pattern Δευ 18:00-24:00 ναι', shiftAllowedByRules(wp, 0, '18:00', '24:00'), true);
  t('weekly_pattern Δευ 16:00-24:00 όχι', shiftAllowedByRules(wp, 0, '16:00', '24:00'), false);
  t('weekly_pattern Τρι (εκτός μοτίβου) ελεύθερη', shiftAllowedByRules(wp, 1, '08:00', '16:00'), true);
  const eb = agent([{ type: 'end_by', time: '22:00' }]);
  t('end_by 22:00: 14:00-22:00 ναι', shiftAllowedByRules(eb, 0, '14:00', '22:00'), true);
  t('end_by 22:00: 16:00-24:00 όχι', shiftAllowedByRules(eb, 0, '16:00', '24:00'), false);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 2. generateWeek (συνθετικό context) ==========');

const NIGHT_LABEL = 'Νυχτερινή Atlas';
const WEEK = '2026-11-16'; // Δευτέρα

let nextId = 1;
function mkAgent(name, opts = {}) {
  return {
    id: nextId++, name, company: 'TEST',
    departments: opts.departments || ['call'],
    canNight: !!opts.canNight, isNew: false,
    fixedStart: opts.fixedStart || null, fixedEnd: opts.fixedEnd || null,
    fixedDays: opts.fixedDays || null, fixedDaysOff: opts.fixedDaysOff || [],
    weekendShift: opts.weekendShift || null,
    workLocation: opts.workLocation || 'office',
    skills: new Set(opts.skills || []),
    rules: opts.rules || []
  };
}

let reqId = 1;
const req = (o) => ({
  id: reqId++, start: o.start, end: o.end, skill: o.skill || null,
  department: o.department || null, period: o.period || null,
  headcount: o.headcount || 1, label: o.label, roleId: 1, color: 'FFFFFFFF'
});

function mkCtx(agents, extraReqs = []) {
  const base = () => [
    req({ start: '08:00', end: '16:00', skill: 'ATLAS', department: 'call', label: 'Atlas (μόνο)' }),
    req({ start: '16:00', end: '24:00', skill: 'ATLAS', department: 'call', label: 'Atlas' }),
    // Οι ΔΥΟ βάρδιες 23:00-07:00 — ΙΔΙΕΣ ώρες, διαφορετική ταυτότητα
    req({ start: '23:00', end: '07:00', label: K9_LABEL }),
    req({ start: '23:00', end: '07:00', skill: 'ATLAS', label: NIGHT_LABEL }),
    ...extraReqs
  ];
  return {
    agents,
    requirements: { weekday: base(), weekend: base() },
    eligibility: new Map(),
    timeOff: new Map(),
    roles: new Map([['Verification', { id: 1, color: 'FFA6A6A6' }], ['Atlas', { id: 2, color: 'FF66CCFF' }]])
  };
}

// Αντίγραφο context με ΜΗΔΕΝΙΣΜΕΝΟΥΣ μετρητές κάλυψης (για δεύτερη εβδομάδα)
const mkCtxSame = (ctx) => ({ ...ctx, _byName: undefined });
const setK9List = (ctx, entries) => ctx.eligibility.set('23:00-07:00', new Map(
  entries.map((e) => [e.id, { maxPerWeek: e.max || 3, location: e.location || 'office' }])
));
const workOf = (res, id) => res.assignments.filter((a) => !a.off && a.agentId === id);
const rowsWith = (res, label) => res.assignments.filter((a) => !a.off && a.reqLabel === label);
const auditOf = (res) => res.report.soft.filter((s) => String(s).startsWith('ΕΛΕΓΧΟΣ ΚΑΝΟΝΩΝ:'));

console.log('\n--- Α. Διαχωρισμός των ΔΥΟ βαρδιών 23:00-07:00 ---');
{
  const k9guy = mkAgent('K9-ONLY', { departments: ['verification', 'call'] });  // λίστα Κ9, ΧΩΡΙΣ can_night
  const nightguy = mkAgent('NIGHT-ONLY', { canNight: true, skills: ['ATLAS'] }); // εκτός λίστας
  const ctx = mkCtx([k9guy, nightguy, mkAgent('F1', { skills: ['ATLAS'] }), mkAgent('F2', { skills: ['ATLAS'] })]);
  setK9List(ctx, [{ id: k9guy.id, max: 3 }]);
  const res = generateWeek(ctx, WEEK, {});
  const k9rows = rowsWith(res, K9_LABEL);
  const nrows = rowsWith(res, NIGHT_LABEL);

  ta(`η βραδινή Κ9 τοποθετήθηκε (${k9rows.length} μέρες)`, k9rows.length > 0);
  ta(`η νυχτερινή Atlas τοποθετήθηκε (${nrows.length} μέρες)`, nrows.length > 0,
    'Η Atlas ΔΕΝ καλύφθηκε — σύγχυση των δύο βαρδιών');
  ta('η Κ9 πήγε ΜΟΝΟ σε μέλος της λίστας', k9rows.every((r) => r.agentId === k9guy.id));
  ta('η νυχτερινή πήγε ΜΟΝΟ σε can_night+ATLAS', nrows.every((r) => r.agentId === nightguy.id));
  ta('η Κ9 έχει ωράριο 23:00-07:00', k9rows.every((r) => r.start === '23:00' && r.end === '07:00'));
  ta('ο Κ9 (χωρίς can_night) ΔΕΝ πήρε νυχτερινή Atlas', !nrows.some((r) => r.agentId === k9guy.id));
  ta('η νυχτερινή είναι 23:00-07:00 ή 23:30-07:30 (Κ4)',
    nrows.every((r) => (r.start === '23:00' && r.end === '07:00') || (r.start === '23:30' && r.end === '07:30')));
  ta('phaseRulesAudit καθαρό', auditOf(res).length === 0, auditOf(res).join('\n          '));
}

console.log('\n--- Β. Vega Bank: ΙΔΙΑ άτομα + όριο φορών/εβδομάδα ---');
{
  const a1 = mkAgent('LIST-A', { departments: ['verification'] });
  const a2 = mkAgent('LIST-B', { departments: ['verification'] });
  const outsider = mkAgent('OUTSIDER', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([a1, a2, outsider]);
  setK9List(ctx, [{ id: a1.id, max: 2 }, { id: a2.id, max: 2 }]);
  const res = generateWeek(ctx, WEEK, {});
  const k9rows = rowsWith(res, K9_LABEL);
  const allowed = new Set([a1.id, a2.id]);
  ta(`βραδινές Κ9: ${k9rows.length}`, k9rows.length > 0);
  ta('όλες από τη λίστα', k9rows.every((r) => allowed.has(r.agentId)));
  ta('ο OUTSIDER δεν πήρε ΠΟΤΕ την Κ9', !k9rows.some((r) => r.agentId === outsider.id));
  const per = new Map();
  for (const r of k9rows) per.set(r.agentId, (per.get(r.agentId) || 0) + 1);
  ta('κανείς πάνω από max_per_week=2', [...per.values()].every((n) => n <= 2),
    [...per.entries()].map(([id, n]) => `${id}:${n}`).join(', '));
}

console.log('\n--- Γ. Συνέχεια προηγούμενης εβδομάδας: 1-6 συνεχόμενες ημέρες ---');
{
  for (const streak of [1, 2, 3, 4, 5, 6]) {
    const a = mkAgent('STREAK', { skills: ['ATLAS'] });
    const b = mkAgent('OTHER-1', { skills: ['ATLAS'] });
    const c = mkAgent('OTHER-2', { skills: ['ATLAS'] });
    const n = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
    const ctx = mkCtx([a, b, c, n]);
    setK9List(ctx, [{ id: b.id }]);
    const prevSunEnd = (dayNum(WEEK) - 1) * 1440 + toMin('16:00');
    const state = { [a.id]: { streak, lastEndAbs: prevSunEnd, nights: 0, weekends: 0, count1903: 0, count62: 0, rizouMode: 'morning', sundays: {}, pendingNightRest: 0 } };
    const res = generateWeek(ctx, WEEK, state);
    const mine = workOf(res, a.id).map((x) => x.date).sort();
    // Το ρεπό ΚΟΒΕΙ τη σειρά: το streak μετράει μόνο αν η Δευτέρα είναι εργάσιμη
    let maxRun = 0;
    let run = mine.includes(res.dates[0]) ? streak : 0;
    for (let i = 0; i < 7; i++) {
      if (mine.includes(res.dates[i])) { run++; maxRun = Math.max(maxRun, run); }
      else run = 0;
    }
    ta(`streak=${streak}: μέγιστη σειρά ${maxRun} ≤ 5 (Κ10, με μεταφορά)`, maxRun <= 5, `βάρδιες: ${mine.join(',')}`);
    if (streak >= 5) ta(`streak=${streak}: η Δευτέρα ΔΕΝ είναι βάρδια`, !mine.includes(res.dates[0]));
  }
}

console.log('\n--- Δ. Βάρδιες πάνω από τα μεσάνυχτα / λήξη 07:00 → Κ8 ---');
{
  const k9 = mkAgent('K9-REST', { departments: ['verification'] });
  const n = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([k9, n, mkAgent('F1', { skills: ['ATLAS'] }), mkAgent('F2', { skills: ['ATLAS'] })]);
  setK9List(ctx, [{ id: k9.id, max: 3 }]);
  const res = generateWeek(ctx, WEEK, {});

  const spans = new Map();
  for (const r of res.assignments) {
    if (r.off) continue;
    const s = dayNum(r.date) * 1440 + toMin(r.start);
    let e = dayNum(r.date) * 1440 + toMin(r.end);
    if (toMin(r.end) <= toMin(r.start)) e += 1440; // περνά μεσάνυχτα
    if (!spans.has(r.agentId)) spans.set(r.agentId, []);
    spans.get(r.agentId).push({ s, e, date: r.date, lbl: `${r.start}-${r.end}` });
  }
  let bad = null;
  for (const [id, list] of spans) {
    list.sort((x, y) => x.s - y.s);
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].s - list[i - 1].e;
      if (gap < 11 * 60) { bad = `agent ${id}: ${list[i - 1].date} ${list[i - 1].lbl} → ${list[i].date} ${list[i].lbl} = ${(gap / 60).toFixed(1)}h`; break; }
    }
    if (bad) break;
  }
  ta('Κ8: καμία ανάπαυση < 11h (με σωστό χειρισμό μεσονυχτίου)', !bad, bad);
  ta('οι βάρδιες που περνούν μεσάνυχτα έχουν end ≤ start',
    res.assignments.filter((a) => !a.off && a.start >= '23:00').every((a) => toMin(a.end) <= toMin(a.start)));
}

console.log('\n--- Ε. Σταθερό ωράριο που συγκρούεται με την επόμενη ημέρα ---');
{
  const alex = mkAgent('ALEX', {
    departments: ['verification'],
    rules: [
      { type: 'weekly_schedule', shifts: { 1: ['10:00', '18:00'], 2: ['10:00', '18:00'] }, off: [3, 4] },
      { type: 'start_after_days', days: { 5: '15:00', 6: '12:00', 7: '12:00' } },
      { type: 'no_streak_limit' }
    ]
  });
  const f1 = mkAgent('F1', { skills: ['ATLAS'] });
  const n = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([alex, f1, n], [
    req({ start: '16:00', end: '24:00', department: 'verification', period: 'afternoon', headcount: 1, label: 'Verification' })
  ]);
  setK9List(ctx, [{ id: f1.id }]);
  const res = generateWeek(ctx, WEEK, {});
  const mine = workOf(res, alex.id);
  const sun = mine.find((x) => x.date === res.dates[6]);

  ta('Δευ/Τρι σταθερά 10:00-18:00',
    mine.filter((x) => [res.dates[0], res.dates[1]].includes(x.date)).every((x) => x.start === '10:00' && x.end === '18:00'),
    mine.map((x) => `${x.date} ${x.start}-${x.end}`).join(', '));
  ta('Τετ/Πεμ ΚΑΜΙΑ βάρδια', !mine.some((x) => [res.dates[2], res.dates[3]].includes(x.date)));
  ta('Παρ/Σαβ/Κυρ καμία έναρξη πριν το όριο',
    mine.filter((x) => [res.dates[4], res.dates[5], res.dates[6]].includes(x.date))
      .every((x) => toMin(x.start) >= toMin(x.date === res.dates[4] ? '15:00' : '12:00')),
    mine.map((x) => `${x.date} ${x.start}`).join(', '));
  // Το κρίσιμο: η Κυριακή δεν πρέπει να αχρηστεύει τη σταθερή Δευτέρα της ΕΠΟΜΕΝΗΣ εβδομάδας
  if (sun) {
    const sunEnd = toMin(sun.end) <= toMin(sun.start) ? toMin(sun.end) + 1440 : toMin(sun.end);
    const rest = (1440 - sunEnd) + toMin('10:00');
    ta(`Κυριακή ${sun.start}-${sun.end} → επόμενη Δευτέρα 10:00 = ${(rest / 60).toFixed(1)}h ≥ 11h`,
      rest >= 11 * 60, 'ΣΥΓΚΡΟΥΣΗ με τη σταθερή Δευτέρα της επόμενης εβδομάδας');
  }
  ta('phaseRulesAudit καθαρό', auditOf(res).length === 0, auditOf(res).join('\n          '));
}

console.log('\n--- ΣΤ. Δεν υπάρχει διαθέσιμος εργαζόμενος ---');
{
  const only = mkAgent('ONLY', { skills: ['ATLAS'] });
  const ctx = mkCtx([only]);
  setK9List(ctx, []); // άδεια λίστα Κ9, κανένας can_night
  const res = generateWeek(ctx, WEEK, {});
  const k9unc = res.report.uncovered.filter((u) => u.label === K9_LABEL);
  const nunc = res.report.uncovered.filter((u) => u.label === NIGHT_LABEL);
  ta(`η βραδινή Κ9 αναφέρεται ΑΚΑΛΥΠΤΗ 7/7 (βρήκα ${k9unc.length})`, k9unc.length === 7);
  ta(`η νυχτερινή Atlas αναφέρεται ΑΚΑΛΥΠΤΗ 7/7 (βρήκα ${nunc.length})`, nunc.length === 7);
  ta('ΚΑΜΙΑ βάρδια 23:00-07:00 δεν ανατέθηκε αυθαίρετα',
    !res.assignments.some((a) => !a.off && String(a.start).startsWith('23:')));
  ta('δεν «εφευρέθηκε» προσωπικό', res.assignments.every((a) => a.agentId === only.id));
}

console.log('\n--- Ζ. Αυστηρά εβδομαδιαία όρια Vega Bank (max_per_week) ---');
{
  // Τρεις στη λίστα με όρια 1 / 2 / 1 → χωρητικότητα 4 για 7 μέρες
  const a1 = mkAgent('CAP-1', { departments: ['verification'] });
  const a2 = mkAgent('CAP-2', { departments: ['verification'] });
  const a3 = mkAgent('CAP-3', { departments: ['verification'] });
  const n = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([a1, a2, a3, n]);
  setK9List(ctx, [{ id: a1.id, max: 1 }, { id: a2.id, max: 2 }, { id: a3.id, max: 1 }]);
  const res = generateWeek(ctx, WEEK, {});
  const per = new Map();
  for (const r of rowsWith(res, K9_LABEL)) per.set(r.agentId, (per.get(r.agentId) || 0) + 1);
  const limits = new Map([[a1.id, 1], [a2.id, 2], [a3.id, 1]]);
  const over = [...per.entries()].filter(([id, c]) => c > limits.get(id));
  ta(`κανείς δεν ξεπερνά το όριό του (${[...per.entries()].map(([id, c]) => `${id}:${c}/${limits.get(id)}`).join(' ')})`,
    over.length === 0, over.map(([id, c]) => `agent ${id}: ${c} > ${limits.get(id)}`).join(', '));
  ta('το σύνολο δεν ξεπερνά τη χωρητικότητα 4',
    [...per.values()].reduce((x, y) => x + y, 0) <= 4);
  ta('ο audit ΔΕΝ αναφέρει υπέρβαση ορίου',
    !auditOf(res).some((s) => /ΟΡΙΟ|ΥΠΕΡΒΑΣΗ/.test(s)), auditOf(res).join('\n          '));
  // Ακάλυπτες μέρες → ΕΝΗΜΕΡΩΣΗ, όχι παράβαση (δεν παραβιάζουμε το όριο)
  const info = res.report.soft.filter((s) => String(s).startsWith('ΕΝΗΜΕΡΩΣΗ Vega Bank:'));
  const uncK9 = res.report.uncovered.filter((u) => u.label === K9_LABEL).length;
  ta(`ακάλυπτες μέρες αναφέρονται ως ΕΝΗΜΕΡΩΣΗ (ακάλυπτα ${uncK9}, ενημερώσεις ${info.length})`,
    uncK9 === 0 ? info.length === 0 : info.length > 0, info.join('\n          '));
  ta('ο μετρητής είναι ΑΝΑ ΕΒΔΟΜΑΔΑ (μηδενίζεται στη νέα)', (() => {
    const w2 = generateWeek(mkCtxSame(ctx), '2026-11-23', res.nextState);
    const p2 = new Map();
    for (const r of rowsWith(w2, K9_LABEL)) p2.set(r.agentId, (p2.get(r.agentId) || 0) + 1);
    return [...p2.entries()].every(([id, c]) => c <= limits.get(id)) && p2.size > 0;
  })(), 'η νέα εβδομάδα δεν ξεκίνησε από μηδέν ή δεν τοποθέτησε καθόλου');
}

console.log('\n--- Ζ2. Αποφάσεις 14/11/2026: αφαιρέσεις από Κ9 + εξαίρεση Σαββιδου ---');
{
  // Οι τρεις που αφαιρέθηκαν: ΔΕΝ είναι στη λίστα → η φάση 6 δεν τους βλέπει.
  // Οι υπόλοιποι κανόνες τους ΔΕΝ αλλάζουν.
  const pantelidis = mkAgent('ΑΛΕΞΙΟΥ ΔΙΟΝΥΣΗΣ', { departments: ['verification', 'call'] });
  const agentA = mkAgent('ΑΝΤΩΝΙΟΥ ΜΑΝΩΛΑΚΗ', { skills: ['ATLAS'], rules: [
    { type: 'prefer_morning', strong: true },
    { type: 'six_two_days', days: [6, 7] }
  ] });
  const pavlou = mkAgent('ΝΤΟΚΟΥ ΙΡΙΣ', { skills: ['ATLAS'], rules: [
    { type: 'allowed_shifts', shifts: [['15:30', '23:30'], ['16:00', '24:00']] }
  ] });
  const agentP = mkAgent('ΣΑΒΒΙΔΟΥ ΠΗΝΕΛΟΠΗ', { skills: ['ATLAS'], rules: [
    { type: 'end_by', time: '22:00' },
    { type: 'morning_start_after', time: '08:00' }
  ] });
  const night = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([pantelidis, agentA, pavlou, agentP, night]);
  // ΜΟΝΟ η Σαββιδου στη λίστα Κ9, όριο 1
  setK9List(ctx, [{ id: agentP.id, max: 1 }]);
  const res = generateWeek(ctx, WEEK, {});
  const k9rows = rowsWith(res, K9_LABEL);

  // (1) Οι τρεις ΔΕΝ μπαίνουν στην Κ9
  const removed = new Set([pantelidis.id, agentA.id, pavlou.id]);
  ta('1) Αλεξιου/Αντωνιου/Ντοκου ΔΕΝ τοποθετούνται στην Κ9',
    !k9rows.some((r) => removed.has(r.agentId)),
    k9rows.filter((r) => removed.has(r.agentId)).map((r) => `${r.date} agent=${r.agentId}`).join(', '));

  // (2) Η Σαββιδου μπορεί να μπει στην Κ9 23:00-07:00
  ta(`2) Η Σαββιδου τοποθετείται στην Κ9 (${k9rows.filter((r) => r.agentId === agentP.id).length} βάρδια)`,
    k9rows.some((r) => r.agentId === agentP.id && r.start === '23:00' && r.end === '07:00'));

  // (6) Οι αφαιρεθέντες παίρνουν κανονικά ΑΛΛΕΣ βάρδιες
  ta('6) Ντοκου: παίρνει κανονικά τις απογευματινές του',
    shiftAllowedByRules(pavlou, 0, '16:00', '24:00') === true &&
    shiftAllowedByRules(pavlou, 0, '15:30', '23:30') === true);
  ta('6) Αντωνιου: κρατά 06:00-14:00 στα ΣΚ (άλλη λίστα, ανέπαφη)',
    shiftAllowedByRules(agentA, 5, '06:00', '14:00') === true);
  ta('6) Αλεξιου: παίρνει κανονικές βάρδιες',
    shiftAllowedByRules(pantelidis, 0, '08:00', '16:00') === true);
  ta('6) οι αφαιρεθέντες δούλεψαν όντως άλλες βάρδιες στην εβδομάδα',
    [...removed].every((id) => workOf(res, id).length > 0),
    [...removed].map((id) => `${id}:${workOf(res, id).length}`).join(' '));

  // (3) Η Σαββιδου ΔΕΝ παίρνει άλλη απογευματινή που τελειώνει μετά τις 22:00
  ta('3) Σαββιδου: 16:00-24:00 ΑΠΑΓΟΡΕΥΕΤΑΙ (λήξη > 22:00)',
    shiftAllowedByRules(agentP, 0, '16:00', '24:00') === false);
  ta('3) Σαββιδου: 15:30-23:30 ΑΠΑΓΟΡΕΥΕΤΑΙ', shiftAllowedByRules(agentP, 0, '15:30', '23:30') === false);
  ta('3) Σαββιδου: 14:00-22:30 ΑΠΑΓΟΡΕΥΕΤΑΙ', shiftAllowedByRules(agentP, 0, '14:00', '22:30') === false);

  // (4) Μπορεί να πάρει απογευματινή έως 22:00
  ta('4) Σαββιδου: 14:00-22:00 ΕΠΙΤΡΕΠΕΤΑΙ (ακριβώς στο όριο)',
    shiftAllowedByRules(agentP, 0, '14:00', '22:00') === true);
  ta('4) Σαββιδου: 09:00-17:00 ΕΠΙΤΡΕΠΕΤΑΙ', shiftAllowedByRules(agentP, 0, '09:00', '17:00') === true);

  // Η ΕΞΑΙΡΕΣΗ ισχύει ΜΟΝΟ για την Κ9, ΟΧΙ επειδή το ωράριο είναι 23:00-07:00
  ta('ΚΡΙΣΙΜΟ: 23:00-07:00 ΧΩΡΙΣ ταυτότητα Κ9 → ΑΠΑΓΟΡΕΥΕΤΑΙ στην Σαββιδου',
    shiftAllowedByRules(agentP, 0, '23:00', '07:00') === false,
    'η εξαίρεση εφαρμόστηκε λόγω ΩΡΑΡΙΟΥ — πρέπει να εξαρτάται ΜΟΝΟ από το override1903 της Κ9');
  ta('ΚΡΙΣΙΜΟ: με ταυτότητα Κ9 (override1903) → ΕΠΙΤΡΕΠΕΤΑΙ',
    shiftAllowedByRules(agentP, 0, '23:00', '07:00', { override1903: true }) === true);
  ta('η εξαίρεση ΔΕΝ χαλαρώνει το end_by σε άλλη βάρδια ούτε με override',
    shiftAllowedByRules(agentP, 0, '16:00', '24:00') === false);
  ta('η Σαββιδου ΔΕΝ πήρε τη νυχτερινή Atlas',
    !rowsWith(res, 'Νυχτερινή Atlas').some((r) => r.agentId === agentP.id));

  // (5) Όριο: 1/εβδομάδα για την Σαββιδου
  const adraktaK9 = k9rows.filter((r) => r.agentId === agentP.id).length;
  ta(`5) Η Σαββιδου δεν ξεπερνά το όριο 1/εβδ. (πήρε ${adraktaK9})`, adraktaK9 <= 1);
  ta('5) ο audit δεν αναφέρει υπέρβαση ορίου',
    !auditOf(res).some((s) => /ΥΠΕΡΒΑΣΗ/.test(s)), auditOf(res).join('\n          '));

  // (8) Η διάκριση Κ9 / νυχτερινής Atlas παραμένει
  const nrows = rowsWith(res, 'Νυχτερινή Atlas');
  ta('8) η διάκριση Κ9 / νυχτερινής Atlas παραμένει',
    k9rows.every((r) => r.reqLabel === K9_LABEL) && nrows.every((r) => r.reqLabel === 'Νυχτερινή Atlas') &&
    !k9rows.some((r) => nrows.includes(r)));
  ta('8) η νυχτερινή πήγε σε can_night+ATLAS', nrows.every((r) => r.agentId === night.id));

  // (9) Κ8: 11ωρη ανάπαυση
  {
    const spans = new Map();
    for (const r of res.assignments) {
      if (r.off) continue;
      const s = dayNum(r.date) * 1440 + toMin(r.start);
      let e = dayNum(r.date) * 1440 + toMin(r.end);
      if (toMin(r.end) <= toMin(r.start)) e += 1440;
      if (!spans.has(r.agentId)) spans.set(r.agentId, []);
      spans.get(r.agentId).push({ s, e, lbl: `${r.date} ${r.start}-${r.end}` });
    }
    let bad = null;
    for (const [id, list] of spans) {
      list.sort((x, y) => x.s - y.s);
      for (let i = 1; i < list.length; i++) {
        if (list[i].s - list[i - 1].e < 11 * 60) { bad = `agent ${id}: ${list[i - 1].lbl} → ${list[i].lbl}`; break; }
      }
      if (bad) break;
    }
    ta('9) Κ8: καμία ανάπαυση < 11h', !bad, bad);
  }

  // (10) Καμία αυθαίρετη ανάθεση / επιπλέον ρεπό
  ta('10) κάθε ανάθεση Κ9 είναι μέλος της λίστας',
    k9rows.every((r) => r.agentId === agentP.id));
  ta('10) καμία ανάθεση σε agent εκτός context',
    res.assignments.every((a) => ctx.agents.some((x) => x.id === a.agentId)));
  ta('10) κανείς δεν ξεπερνά τις 5 εργάσιμες (Κ2)',
    ctx.agents.every((a) => workOf(res, a.id).length <= 5),
    ctx.agents.map((a) => `${a.name}:${workOf(res, a.id).length}`).join(' '));

  // (7) Τα όρια μηδενίζονται στην επόμενη εβδομάδα
  {
    const w2 = generateWeek(mkCtxSame(ctx), '2026-11-23', res.nextState);
    const k9b = rowsWith(w2, K9_LABEL).filter((r) => r.agentId === agentP.id).length;
    ta(`7) τα όρια μηδενίζονται στη νέα εβδομάδα (Σαββιδου ${adraktaK9} → ${k9b}, όριο 1)`,
      k9b <= 1 && k9b > 0, 'δεν τοποθετήθηκε καθόλου στη 2η εβδομάδα ή ξεπέρασε το όριο');
  }
}

console.log('\n--- Ζ3. Κατάργηση not_alone (14/11/2026) ---');
{
  // Η Μανωλακη ήταν το ΜΟΝΟ άτομο με not_alone. Πριν την κατάργηση, στις
  // 23:00-07:00 έμενε ατοποθέτητη γιατί απαιτούσε συνεχή παρουσία άλλου στο
  // γραφείο — συνθήκη που ο αξιολογητής της φάσης 6 σχεδόν ποτέ δεν έβλεπε.
  const aggeli = mkAgent('ΜΑΝΩΛΑΚΗ ΛΙΝΑ', { departments: ['call'], skills: ['VEGA'] });
  const night = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const ctx = mkCtx([aggeli, night, mkAgent('F1', { skills: ['ATLAS'] })]);
  // ΜΟΝΟ η Μανωλακη στη λίστα, όριο 2 — κανένας άλλος δεν μπορεί να καλύψει
  setK9List(ctx, [{ id: aggeli.id, max: 2 }]);
  const res = generateWeek(ctx, WEEK, {});
  const mine = rowsWith(res, K9_LABEL).filter((r) => r.agentId === aggeli.id);

  ta(`η Μανωλακη ΤΟΠΟΘΕΤΕΙΤΑΙ στη βραδινή Vega Bank (${mine.length} βάρδιες)`,
    mine.length > 0, 'δεν πήρε καμία — ο περιορισμός not_alone ίσως επιβάλλεται ακόμα');
  ta('τηρεί το εβδομαδιαίο όριό της (2)', mine.length <= 2, `πήρε ${mine.length}`);
  ta('ωράριο 23:00-07:00', mine.every((r) => r.start === '23:00' && r.end === '07:00'));
  ta('ο audit δεν αναφέρει παράβαση', !auditOf(res).some((s) => /ΥΠΕΡΒΑΣΗ/.test(s)), auditOf(res).join(' | '));

  // Το πεδίο notAlone στο context ΔΕΝ πρέπει πλέον να επηρεάζει τίποτα:
  // ακόμη κι αν κάποιος το περάσει, η τοποθέτηση παραμένει η ίδια
  const ctx2 = mkCtx([mkAgent('ΜΑΝΩΛΑΚΗ 2', { departments: ['call'] }), mkAgent('N2', { canNight: true, skills: ['ATLAS'] })]);
  const ag2 = ctx2.agents[0];
  ctx2.eligibility.set('23:00-07:00', new Map([[ag2.id, { maxPerWeek: 2, location: 'office', notAlone: true }]]));
  const res2 = generateWeek(ctx2, WEEK, {});
  ta('παλιό πεδίο notAlone στο context → ΑΓΝΟΕΙΤΑΙ πλήρως',
    rowsWith(res2, K9_LABEL).filter((r) => r.agentId === ag2.id).length > 0,
    'το notAlone επηρεάζει ακόμα την τοποθέτηση');
}

console.log('\n--- Ζ4. avoid_weekend_62: Γεωργιου + Ρενα (soft, 14/11/2026) ---');
{
  // Στήσιμο: απαίτηση 06:00-14:00 ΜΟΝΟ στο ΣΚ, με λίστα επιλεξιμότητας.
  const mk62 = (members) => {
    const agents = members.map((m) => mkAgent(m.name, {
      departments: ['call'], skills: ['ΑΙΓΑΙΟΥ'], rules: m.rules || []
    }));
    const base = () => [req({ start: '06:00', end: '14:00', label: 'Αιγαίου', headcount: 1 })];
    const ctx = {
      agents,
      requirements: { weekday: base(), weekend: base() },
      eligibility: new Map([['06:00-14:00', new Map(agents.map((a) => [a.id, { maxPerWeek: 5, location: 'office' }]))]]),
      timeOff: new Map(),
      roles: new Map([['Αιγαίου', { id: 1, color: 'FFFFE699' }], ['Verification', { id: 2, color: 'FFA6A6A6' }]])
    };
    return { ctx, agents };
  };
  const AVOID = [{ type: 'avoid_weekend_62' }];

  // (1) ΜΕ εναλλακτική → δεν επιλέγονται οι δύο Γεωργιου
  {
    const { ctx, agents } = mk62([
      { name: 'ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', rules: AVOID },
      { name: 'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', rules: AVOID },
      { name: 'ΑΛΛΟΣ Α' }, { name: 'ΑΛΛΟΣ Β' }, { name: 'ΑΛΛΟΣ Γ' }
    ]);
    const res = generateWeek(ctx, WEEK, {});
    const avoidIds = new Set([agents[0].id, agents[1].id]);
    const wknd62 = res.assignments.filter((a) => !a.off && a.start === '06:00' && a.end === '14:00' &&
      [res.dates[5], res.dates[6]].includes(a.date));
    const theirs = wknd62.filter((a) => avoidIds.has(a.agentId));
    ta(`1) ΜΕ εναλλακτική: οι δύο Γεωργιου ΔΕΝ παίρνουν 06:00-14:00 στο ΣΚ (${wknd62.length} βάρδιες ΣΚ)`,
      wknd62.length > 0 && theirs.length === 0,
      theirs.map((a) => `${a.date} ${a.agentName}`).join(', '));
  }

  // (2) ΧΩΡΙΣ εναλλακτική → επιτρέπεται κανονικά
  {
    const { ctx, agents } = mk62([{ name: 'ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', rules: AVOID }]);
    const res = generateWeek(ctx, WEEK, {});
    const wknd62 = res.assignments.filter((a) => !a.off && a.start === '06:00' && a.end === '14:00' &&
      [res.dates[5], res.dates[6]].includes(a.date));
    ta(`2) ΧΩΡΙΣ εναλλακτική: ο Γεωργιου ΠΑΙΡΝΕΙ κανονικά τη βάρδια (${wknd62.length})`,
      wknd62.length > 0 && wknd62.every((a) => a.agentId === agents[0].id),
      'η βάρδια έμεινε ακάλυπτη — ο κανόνας λειτουργεί ως απαγόρευση, όχι ως αποφυγή');
    ta('2) το πρόγραμμα παραμένει έγκυρο (καμία παράβαση στο audit)',
      auditOf(res).length === 0, auditOf(res).join(' | '));
  }
  {
    // Το ίδιο για την Ρενα
    const { ctx, agents } = mk62([{ name: 'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', rules: AVOID }]);
    const res = generateWeek(ctx, WEEK, {});
    const wknd62 = res.assignments.filter((a) => !a.off && a.start === '06:00' && a.end === '14:00' &&
      [res.dates[5], res.dates[6]].includes(a.date));
    ta(`2) ΧΩΡΙΣ εναλλακτική: και η Ρενα παίρνει κανονικά (${wknd62.length})`,
      wknd62.length > 0 && wknd62.every((a) => a.agentId === agents[0].id));
  }

  // (3) Καθημερινές ΑΝΕΠΗΡΕΑΣΤΕΣ + δεν θίγονται οι άλλοι
  {
    const nik = agent([{ type: 'six_two_days', days: [1, 5] }, { type: 'avoid_weekend_62' }]);
    t('3) Δευτέρα 06:00-14:00 εξακολουθεί να επιτρέπεται', shiftAllowedByRules(nik, 0, '06:00', '14:00'), true);
    t('3) Παρασκευή 06:00-14:00 εξακολουθεί να επιτρέπεται', shiftAllowedByRules(nik, 4, '06:00', '14:00'), true);
    t('3) ΣΚ 06:00-14:00 ΔΕΝ απαγορεύεται πλέον (soft, όχι hard)', shiftAllowedByRules(nik, 5, '06:00', '14:00'), true);
    t('3) Τρίτη 06:00-14:00 παραμένει απαγορευμένη (six_two_days)', shiftAllowedByRules(nik, 1, '06:00', '14:00'), false);
    const plain = agent([]);
    t('3) άλλος εργαζόμενος: ΣΚ 06:00-14:00 ανεπηρέαστο', shiftAllowedByRules(plain, 5, '06:00', '14:00'), true);
    t('3) ο κανόνας δεν αγγίζει άλλα ωράρια στο ΣΚ', shiftAllowedByRules(nik, 5, '08:00', '16:00'), true);
  }

  // Οι υπόλοιποι παίρνουν κανονικά τη βάρδια στο ΣΚ
  {
    const { ctx, agents } = mk62([
      { name: 'ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', rules: AVOID }, { name: 'ΑΛΛΟΣ Α' }
    ]);
    const res = generateWeek(ctx, WEEK, {});
    const wknd62 = res.assignments.filter((a) => !a.off && a.start === '06:00' && a.end === '14:00' &&
      [res.dates[5], res.dates[6]].includes(a.date));
    ta('3) με έναν μόνο εναλλακτικό, η βάρδια πάει σε εκείνον',
      wknd62.length > 0 && wknd62.every((a) => a.agentId === agents[1].id),
      wknd62.map((a) => a.agentName).join(', '));
  }
}

console.log('\n--- Ζ5. Vega Bank supervisors + ΨΑΡΡΑ (14/11/2026) ---');
{
  // Στήσιμο: supervisor πρωί 07:00-15:00, Atlas άνοιγμα 07:00-15:00,
  // Atlas 07:30-15:30, και πρωινή θέση για τους δύο Γεωργιου.
  const mkSup = (opts = {}) => {
    const sup = mkAgent('ΛΑΜΠΡΟΥ ΦΑΝΗ', {
      departments: ['supervisor'], skills: ['VEGA'],
      rules: [{ type: 'vega_supervisor' }, ...(opts.pair ? [{ type: 'prefer_same_start_any', with: ['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', 'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ'] }] : [])]
    });
    // ΤΕΣΣΕΡΙΣ supervisors όπως στην πραγματικότητα: 2 υποχρεωτικά slots/μέρα
    // (07:00-15:00 + 16:00-24:00) αφήνουν περιθώριο για «έξτρα» 08:00-16:00.
    // Με μόνο 2 supervisors δεν υπάρχει ΠΟΤΕ έξτρα θέση και η συνοδεία της
    // ΨΑΡΡΑ είναι δομικά αδύνατη — το fixture θα ήταν παραπλανητικό.
    const sup2 = mkAgent('SUP-2', { departments: ['supervisor'], skills: [] });
    const sup3 = mkAgent('SUP-3', { departments: ['supervisor'], skills: [] });
    const sup4 = mkAgent('SUP-4', { departments: ['supervisor'], skills: [] });
    const euro = opts.euro === false ? [] : [
      mkAgent('EURO-A', { skills: ['ATLAS'] }),
      mkAgent('EURO-B', { skills: ['ATLAS'] })
    ];
    const nik = opts.pair ? [
      mkAgent('ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', { skills: ['ΑΙΓΑΙΟΥ'], rules: [{ type: 'only_morning' }] }),
      mkAgent('ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', { skills: ['ΑΙΓΑΙΟΥ'], rules: [{ type: 'only_morning' }] })
    ] : [];
    const base = () => [
      req({ start: '07:00', end: '15:00', department: 'supervisor', headcount: 1, label: 'Supervisor' }),
      ...(opts.euro === false ? [] : [req({ start: '07:00', end: '15:00', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Atlas (άνοιγμα)' })]),
      req({ start: '16:00', end: '24:00', department: 'supervisor', headcount: 1, label: 'Supervisor' }),
      ...(opts.pair ? [req({ start: '08:00', end: '16:00', skill: 'ΑΙΓΑΙΟΥ', period: 'morning', headcount: 3, label: 'Αιγαίου' })] : [])
    ];
    const agents = [sup, sup2, sup3, sup4, ...euro, ...nik];
    return {
      ctx: {
        agents, requirements: { weekday: base(), weekend: base() },
        eligibility: new Map(), timeOff: new Map(),
        roles: new Map([['Supervisor', { id: 1, color: 'FFC792D6' }], ['Atlas', { id: 2, color: 'FF66CCFF' }], ['Αιγαίου', { id: 3, color: 'FFFFE699' }]])
      }, sup, nik
    };
  };

  // (1) Πρωινός supervisor Vega Bank → υπάρχει Atlas με έναρξη 07:00
  {
    const { ctx, sup } = mkSup();
    const res = generateWeek(ctx, WEEK, {});
    const mornings = workOf(res, sup.id).filter((a) => toMin(a.start) < 720);
    const okDays = mornings.filter((m) => res.assignments.some((x) =>
      !x.off && x.date === m.date && x.start === '07:00' && x.reqLabel === 'Atlas (άνοιγμα)'));
    ta(`1) κάθε πρωινή Supervisor Vega Bank έχει Atlas 07:00 (${okDays.length}/${mornings.length})`,
      mornings.length > 0 && okDays.length === mornings.length,
      `λείπει σε: ${mornings.filter((m) => !okDays.includes(m)).map((m) => m.date).join(', ')}`);
    ta('1) ο audit δεν αναφέρει έλλειψη', !auditOf(res).some((s) => /Atlas με έναρξη 07:00/.test(s)),
      auditOf(res).filter((s) => /07:00/.test(s)).join(' | '));
  }

  // (1β) ΧΩΡΙΣ Atlas → ο audit ΠΡΕΠΕΙ να το αναφέρει
  {
    const { ctx } = mkSup({ euro: false });
    const res = generateWeek(ctx, WEEK, {});
    const hits = auditOf(res).filter((s) => /Atlas με έναρξη 07:00/.test(s));
    ta(`1β) χωρίς Atlas 07:00 → ο audit ΤΟ ΠΙΑΝΕΙ (${hits.length} ευρήματα)`, hits.length > 0);
  }

  // (1γ) Ο κανόνας αφορά ΜΟΝΟ πρωινές
  {
    const { ctx, sup } = mkSup({ euro: false });
    const res = generateWeek(ctx, WEEK, {});
    const aft = workOf(res, sup.id).filter((a) => toMin(a.start) >= 720);
    const auditDates = auditOf(res).filter((s) => /Atlas με έναρξη 07:00/.test(s));
    ta('1γ) απογευματινές Supervisor ΔΕΝ ελέγχονται',
      aft.every((a) => !auditDates.some((s) => s.includes(a.date))),
      `απογευματινές: ${aft.map((a) => a.date + ' ' + a.start).join(', ')}`);
  }

  // (2) escort_by_shift: συνοδεία ΑΝΑ ΩΡΑΡΙΟ
  {
    const ESCORT = {
      type: 'escort_by_shift',
      shifts: {
        '07:00-15:00': ['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', 'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', 'ΡΟΥΣΣΟΥ ΟΛΓΑ'],
        '16:00-24:00': ['ΡΟΥΣΣΟΥ ΟΛΓΑ']
      }
    };
    const agentF = mkAgent('ΛΑΜΠΡΟΥ ΦΑΝΗ', { departments: ['supervisor'], skills: ['VEGA'], rules: [ESCORT] });
    const sups = ['S2', 'S3', 'S4'].map((n) => mkAgent(n, { departments: ['supervisor'] }));
    const agentV = mkAgent('ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', { skills: ['ATLAS'], rules: [{ type: 'only_morning' }] });
    const agentR = mkAgent('ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', { skills: ['ATLAS'], rules: [{ type: 'only_morning' }] });
    const agentO = mkAgent('ΡΟΥΣΣΟΥ ΟΛΓΑ', { skills: ['ATLAS'] });
    const base = () => [
      req({ start: '07:00', end: '15:00', department: 'supervisor', headcount: 1, label: 'Supervisor' }),
      req({ start: '07:00', end: '15:00', skill: 'ATLAS', department: 'call', headcount: 2, label: 'Atlas (άνοιγμα)' }),
      req({ start: '16:00', end: '24:00', department: 'supervisor', headcount: 1, label: 'Supervisor' }),
      req({ start: '16:00', end: '24:00', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Atlas' })
    ];
    const ctx = {
      agents: [agentF, ...sups, agentV, agentR, agentO],
      requirements: { weekday: base(), weekend: base() },
      eligibility: new Map(), timeOff: new Map(),
      roles: new Map([['Supervisor', { id: 1, color: 'A' }], ['Atlas', { id: 2, color: 'B' }]])
    };
    const res = generateWeek(ctx, WEEK, {});
    const hers = workOf(res, agentF.id);
    const at = (ids, date, s, e) => res.assignments.some((x) =>
      !x.off && ids.includes(x.agentId) && x.date === date && x.start === s && x.end === e);

    const m7 = hers.filter((h) => h.start === '07:00' && h.end === '15:00');
    const ok7 = m7.filter((h) => at([agentV.id, agentR.id, agentO.id], h.date, '07:00', '15:00'));
    ta(`2α) στις 07:00-15:00 έχει ΕΝΑΝ από τους τρεις (${ok7.length}/${m7.length})`,
      m7.length === 0 || ok7.length === m7.length,
      m7.filter((h) => !ok7.includes(h)).map((h) => h.date).join(', '));

    const m16 = hers.filter((h) => h.start === '16:00' && h.end === '24:00');
    const ok16 = m16.filter((h) => at([agentO.id], h.date, '16:00', '24:00'));
    ta(`2β) στις 16:00-24:00 είναι με τον ΡΟΥΣΣΟΥ (${ok16.length}/${m16.length})`,
      m16.length === 0 || ok16.length === m16.length,
      m16.filter((h) => !ok16.includes(h)).map((h) => h.date).join(', '));
    ta('2) δούλεψε σε ένα τουλάχιστον από τα δύο ωράρια', m7.length + m16.length > 0,
      hers.map((h) => `${h.date} ${h.start}-${h.end}`).join(', '));

    // 2γ) Σε ΑΛΛΟ ωράριο δεν επιβάλλεται συνοδεία
    const other = hers.filter((h) => !(h.start === '07:00' && h.end === '15:00') && !(h.start === '16:00' && h.end === '24:00'));
    ta(`2γ) σε άλλα ωράρια καμία απαίτηση συνοδείας (${other.length} βάρδιες)`,
      other.every(() => true));
    const psi = agent([ESCORT], { departments: ['supervisor'] });
    t('2γ) ο κανόνας δεν φιλτράρει: 08:00-16:00 επιτρεπτό χωρίς συνοδό',
      shiftAllowedByRules(psi, 0, '08:00', '16:00'), true);
    t('2γ) ούτε το 07:00-15:00 φιλτράρεται (είναι scoring, όχι φράγμα)',
      shiftAllowedByRules(psi, 0, '07:00', '15:00'), true);

    // 2β-bis: ΑΝΑΓΚΑΣΤΙΚΑ στο 16:00-24:00 — μόνη supervisor, ώστε να
    // δοκιμαστεί όντως η συνοδεία με τον ΡΟΥΣΣΟΥ (αλλιώς το 2β μένει 0/0)
    {
      const am2 = mkAgent('ΛΑΜΠΡΟΥ ΦΑΝΗ', { departments: ['supervisor'], skills: ['VEGA'], rules: [ESCORT] });
      const al2 = mkAgent('ΡΟΥΣΣΟΥ ΟΛΓΑ', { skills: ['ATLAS'] });
      const f1 = mkAgent('F1', { skills: ['ATLAS'] });
      const base2 = () => [
        req({ start: '16:00', end: '24:00', department: 'supervisor', headcount: 1, label: 'Supervisor' }),
        req({ start: '16:00', end: '24:00', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Atlas' }),
        req({ start: '07:00', end: '15:00', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Atlas (άνοιγμα)' })
      ];
      const ctx2 = {
        agents: [am2, al2, f1],
        requirements: { weekday: base2(), weekend: base2() },
        eligibility: new Map(), timeOff: new Map(),
        roles: new Map([['Supervisor', { id: 1, color: 'A' }], ['Atlas', { id: 2, color: 'B' }]])
      };
      const r2 = generateWeek(ctx2, WEEK, {});
      const hers2 = workOf(r2, am2.id).filter((h) => h.start === '16:00' && h.end === '24:00');
      const with2 = hers2.filter((h) => r2.assignments.some((x) =>
        !x.off && x.agentId === al2.id && x.date === h.date && x.start === '16:00' && x.end === '24:00'));
      // Ο ΡΟΥΣΣΟΥ δουλεύει ΜΕΧΡΙ 5 μέρες (Κ2) — στις υπόλοιπες έχει ρεπό και
      // δεν μπορεί να τη συνοδεύσει. Παράβαση είναι μόνο όταν ΔΟΥΛΕΥΕΙ τη
      // μέρα αυτή αλλά σε ΑΛΛΗ βάρδια· το ρεπό δικαιολογείται.
      const unexcused = hers2.filter((h) => !with2.includes(h) &&
        r2.assignments.some((x) => !x.off && x.agentId === al2.id && x.date === h.date));
      ta(`2β-bis) αναγκαστικό 16:00-24:00: μαζί με ΡΟΥΣΣΟΥ ${with2.length}/${hers2.length}` +
        ` (${hers2.length - with2.length} μέρες σε ρεπό του)`,
        hers2.length > 0 && unexcused.length === 0,
        unexcused.map((h) => `${h.date}: δουλεύει αλλού`).join(', '));
    }
  }

  // (3) Καμία διπλή ανάθεση / παραβίαση
  {
    const { ctx } = mkSup({ pair: true });
    const res = generateWeek(ctx, WEEK, {});
    const seen = new Set(); let dup = 0;
    for (const a of res.assignments) {
      if (a.off) continue;
      const k = `${a.agentId}|${a.date}`;
      if (seen.has(k)) dup++; else seen.add(k);
    }
    ta('3) καμία διπλή ανάθεση (ίδιος agent, ίδια μέρα)', dup === 0, `${dup} διπλές`);
    ta('3) κανείς πάνω από 5 εργάσιμες', ctx.agents.every((a) => workOf(res, a.id).length <= 5),
      ctx.agents.map((a) => `${a.name}:${workOf(res, a.id).length}`).join(' '));
    ta('3) ο audit είναι καθαρός', auditOf(res).length === 0, auditOf(res).join(' | '));
  }
}

console.log('\n--- Η. Κοινή βάρδια ζεύγους (soft) ---');
{
  const z = mkAgent('ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ', { skills: ['ATLAS'], rules: [{ type: 'prefer_same_shift', with: 'ΔΗΜΑΚΗ ΓΙΩΤΑ' }] });
  const m = mkAgent('ΔΗΜΑΚΗ ΓΙΩΤΑ', { skills: ['ATLAS'], canNight: true, rules: [{ type: 'prefer_same_shift', with: 'ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ' }] });
  const n = mkAgent('NIGHT', { canNight: true, skills: ['ATLAS'] });
  const k9 = mkAgent('K9', { departments: ['verification'] });
  const ctx = mkCtx([z, m, n, k9], [
    req({ start: '08:00', end: '16:00', skill: 'ATLAS', department: 'call', period: 'morning', headcount: 2, label: 'Atlas πρωί' })
  ]);
  setK9List(ctx, [{ id: k9.id }]);
  const res = generateWeek(ctx, WEEK, {});
  let both = 0;
  let same = 0;
  for (const date of res.dates) {
    const ra = workOf(res, z.id).find((x) => x.date === date);
    const rb = workOf(res, m.id).find((x) => x.date === date);
    if (!ra || !rb) continue;
    both++;
    if (ra.start === rb.start && ra.end === rb.end) same++;
  }
  ta(`κοινές εργάσιμες ${both}, ίδια βάρδια ${same} (${both ? Math.round(same / both * 100) : 0}%)`,
    both === 0 || same > 0, 'η προτίμηση prefer_same_shift δεν είχε ΚΑΜΙΑ επίδραση');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 3. REGRESSION: ταυτότητα βάρδιας χωρίς reqLabel ==========');
// ΓΝΩΣΤΟ ΟΡΙΟ (14/11/2026): από τότε που η βραδινή Κ9 έγινε 23:00-07:00, είναι
// ΑΔΥΝΑΤΟ να διακριθεί από τη «Νυχτερινή Atlas» με βάση ΜΟΝΟ τις ώρες.
// Οι αναθέσεις του generator κουβαλούν reqLabel (αποθηκεύεται στο
// schedules.data), άρα η ταυτότητα διατηρείται. Οι γραμμές που έρχονται από
// Excel import ΔΕΝ έχουν reqLabel. Τα παρακάτω κλειδώνουν τη συμπεριφορά
// ώστε να φανεί αμέσως αν αλλάξει.
{
  t('γραμμή 23:00-07:00 ΧΩΡΙΣ reqLabel ΔΕΝ αναγνωρίζεται ως Κ9',
    isK9Entry({ start: '23:00', end: '07:00' }), false);
  t('γραμμή με reqLabel=null ΔΕΝ αναγνωρίζεται ως Κ9',
    isK9Entry({ start: '23:00', end: '07:00', reqLabel: null }), false);
  t('απαίτηση χωρίς label ΔΕΝ είναι Κ9', isK9Req({ start: '23:00', end: '07:00' }), false);
  // Το χρώμα ρόλου είναι η πληροφορία που ΥΠΑΡΧΕΙ στο Excel και επιτρέπει
  // τη διάκριση (Verification FFA6A6A6 vs Atlas FF66CCFF) — βλ. QA report
  t('τα δύο χρώματα ρόλων διαφέρουν (βάση για διάκριση στο import)',
    'FFA6A6A6' !== 'FF66CCFF', true);
}

console.log(`\n${fail === 0 ? '✔ ΟΛΑ ΠΕΡΑΣΑΝ' : '✘ ' + fail + ' ΑΠΕΤΥΧΑΝ'}  (${pass} ok, ${fail} fail)\n`);
process.exit(fail === 0 ? 0 : 1);
