// Tests ΕΠΙΘΥΜΗΤΩΝ ΩΡΩΝ ΕΡΓΑΣΙΑΣ — ΧΩΡΙΣ ΒΑΣΗ ΔΕΔΟΜΕΝΩΝ (15/11/2026).
//
// Ελέγχονται:
//   1. Έλεγχος συμβατότητας — ΜΕ ΤΟ ΡΗΤΟ ΠΑΡΑΔΕΙΓΜΑ της προδιαγραφής:
//      αίτημα 16:00-24:00 ΔΕΝ ικανοποιείται από πρωινή 06:00-14:00
//   2. Αναδιάταξη υποψήφιων ωραρίων (ο κύριος μηχανισμός)
//   3. Βάρη scoring — ότι είναι tie-breaker και ΟΧΙ υπερίσχυση
//   4. generateWeek: τα αιτήματα ικανοποιούνται ΟΤΑΝ γίνεται…
//   5. …και ΔΕΝ παραβιάζεται κανένας κανόνας όταν ΔΕΝ γίνεται
//      (άδεια Κ6, ατομικοί κανόνες Κ3/Κ5, 11ωρο Κ8, εξαήμερο Κ2/Κ10,
//       λίστες επιλεξιμότητας, κάλυψη απαιτήσεων)
//   6. Αξιολόγηση/αιτιολόγηση αποτελεσμάτων
//
// Χρήση: node scripts/test_wishes.js      (ή: npm run test:wishes)
const wish = require('../src/scheduler/wishes');
const { generateWeek, K9_LABEL } = require('../src/scheduler/engine');

let fail = 0;
let pass = 0;
function t(name, got, want, detail) {
  if (got === want) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  → πήρα ${JSON.stringify(got)}, περίμενα ${JSON.stringify(want)}${detail ? '\n          ' + detail : ''}`); }
}
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}

const D = '2026-11-16'; // Δευτέρα
const mkWish = (o) => ({
  id: o.id || 1, agent_id: o.agent_id || 1, date: o.date || D,
  start_time: o.start, end_time: o.end, notes: o.notes || null, full_name: o.name || 'TEST'
});

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 1. ΚΑΤΗΓΟΡΙΑ ΒΑΡΔΙΑΣ ==========');

t('06:00-14:00 → morning', wish.shiftClass('06:00', '14:00'), 'morning');
t('08:00-16:00 → morning', wish.shiftClass('08:00', '16:00'), 'morning');
t('10:00-18:00 → morning', wish.shiftClass('10:00', '18:00'), 'morning');
t('14:00-22:00 → afternoon', wish.shiftClass('14:00', '22:00'), 'afternoon');
t('15:30-23:30 → afternoon', wish.shiftClass('15:30', '23:30'), 'afternoon');
t('16:00-24:00 → afternoon', wish.shiftClass('16:00', '24:00'), 'afternoon');
t('23:00-07:00 → evening', wish.shiftClass('23:00', '07:00'), 'evening');
t('23:30-07:30 → evening', wish.shiftClass('23:30', '07:30'), 'evening');

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 2. ΕΛΕΓΧΟΣ ΣΥΜΒΑΤΟΤΗΤΑΣ ==========');

console.log('\n--- ΤΟ ΠΑΡΑΔΕΙΓΜΑ ΤΗΣ ΠΡΟΔΙΑΓΡΑΦΗΣ ---');
{
  const w = mkWish({ start: '16:00', end: '24:00' });
  const c = wish.compatibility(D, w, '06:00', '14:00');
  t('αίτημα 16:00-24:00 + τοποθέτηση 06:00-14:00 → ΔΕΝ ικανοποιήθηκε', c.status, 'unsatisfied',
    'Η προδιαγραφή το απαγορεύει ΡΗΤΑ — πρωινή βάρδια δεν ικανοποιεί απογευματινό αίτημα');
  t('…ούτε μερικώς', c.status === 'partial', false);
  t('…μηδενική επικάλυψη', c.overlap, 0);
  t('…διαφορετική κατηγορία', c.sameClass, false);
}

console.log('\n--- Ακριβής ταύτιση ---');
{
  const w = mkWish({ start: '16:00', end: '24:00' });
  t('16:00-24:00 ↔ 16:00-24:00', wish.compatibility(D, w, '16:00', '24:00').status, 'satisfied');
  t('αναλογία 100%', wish.compatibility(D, w, '16:00', '24:00').ratio, 1);
}

console.log('\n--- Μερική: ίδια κατηγορία ΚΑΙ επικάλυψη ≥50% ---');
{
  const w = mkWish({ start: '16:00', end: '24:00' });
  // 15:30-23:30 → επικάλυψη 16:00-23:30 = 450\' από 480\' = 93.75%
  const a = wish.compatibility(D, w, '15:30', '23:30');
  t('16:00-24:00 ↔ 15:30-23:30 → μερικώς', a.status, 'partial');
  ta(`…επικάλυψη ${Math.round(a.ratio * 100)}% ≥ 50%`, a.ratio >= 0.5);
  // 14:00-22:00 → επικάλυψη 16:00-22:00 = 360\' από 480\' = 75%
  const b = wish.compatibility(D, w, '14:00', '22:00');
  t('16:00-24:00 ↔ 14:00-22:00 → μερικώς', b.status, 'partial');
  t('…75%', Math.round(b.ratio * 100), 75);
}

console.log('\n--- Κάτω από το όριο 50% → ΔΕΝ ικανοποιήθηκε ---');
{
  const w = mkWish({ start: '16:00', end: '24:00' });
  // 10:00-18:00: επικάλυψη 16:00-18:00 = 120\' = 25%, ΚΑΙ άλλη κατηγορία
  const c = wish.compatibility(D, w, '10:00', '18:00');
  t('16:00-24:00 ↔ 10:00-18:00 → ΟΧΙ', c.status, 'unsatisfied');
  t('…25% επικάλυψη', Math.round(c.ratio * 100), 25);
}
{
  // ΙΔΙΑ κατηγορία αλλά μικρή επικάλυψη: 12:00-20:00 vs 18:00-02:00… κρατάμε
  // απογευματινά: αίτημα 12:00-20:00, τοποθέτηση 18:00-02:00 → 120\' = 25%
  const w = mkWish({ start: '12:00', end: '20:00' });
  const c = wish.compatibility(D, w, '18:00', '02:00');
  t('ίδια κατηγορία αλλά 25% → ΟΧΙ', c.status, 'unsatisfied');
  t('…η κατηγορία ΕΙΝΑΙ ίδια', c.sameClass, true);
}

console.log('\n--- Βάρδιες πάνω από τα μεσάνυχτα ---');
{
  const w = mkWish({ start: '23:00', end: '07:00' });
  t('23:00-07:00 ↔ 23:00-07:00', wish.compatibility(D, w, '23:00', '07:00').status, 'satisfied');
  // 23:30-07:30 → επικάλυψη 23:30-07:00 = 450\' από 480\' = 93.75%
  t('23:00-07:00 ↔ 23:30-07:30 → μερικώς', wish.compatibility(D, w, '23:30', '07:30').status, 'partial');
  t('23:00-07:00 ↔ 08:00-16:00 → ΟΧΙ', wish.compatibility(D, w, '08:00', '16:00').status, 'unsatisfied');
  t('διάρκεια 23:00-07:00 = 480 λεπτά', wish.durationMinutes(D, '23:00', '07:00'), 480);
}

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 3. ΑΝΑΔΙΑΤΑΞΗ ΩΡΑΡΙΩΝ ==========');

const MORNING_OPTS = [['08:00', '16:00'], ['09:00', '17:00'], ['07:30', '15:30'], ['10:00', '18:00']];

{
  const o = wish.preferredOrder(MORNING_OPTS, mkWish({ start: '10:00', end: '18:00' }), D);
  t('το αιτούμενο 10:00-18:00 μπαίνει ΠΡΩΤΟ', o[0].join('-'), '10:00-18:00');
  t('καμία επιλογή δεν χάθηκε', o.length, MORNING_OPTS.length);
  // Οι εναλλακτικές ταξινομούνται κατά ΕΓΓΥΤΗΤΑ στο αιτούμενο:
  // 09:00-17:00 (87%) → 08:00-16:00 (75%) → 07:30-15:30 (69%)
  ta('οι υπόλοιπες μπαίνουν κατά εγγύτητα στο αιτούμενο',
    o.slice(1).map((x) => x.join('-')).join(',') === '09:00-17:00,08:00-16:00,07:30-15:30',
    `πήρα: ${o.slice(1).map((x) => x.join('-')).join(',')}`);
}
{
  // Χωρίς ακριβή ταύτιση: η πιο συμβατή (μερική) μπροστά
  const o = wish.preferredOrder(MORNING_OPTS, mkWish({ start: '09:30', end: '17:30' }), D);
  t('μερικώς συμβατή μπροστά (09:00-17:00)', o[0].join('-'), '09:00-17:00');
}
{
  const o = wish.preferredOrder(MORNING_OPTS, null, D);
  ta('ΧΩΡΙΣ αίτημα: ΙΔΙΑ αναφορά πίνακα (καμία μεταβολή)', o === MORNING_OPTS);
}
{
  const one = [['06:00', '14:00']];
  ta('μία μόνο επιλογή: αμετάβλητη', wish.preferredOrder(one, mkWish({ start: '16:00', end: '24:00' }), D) === one);
}
{
  // Αίτημα ασύμβατο με ΟΛΕΣ τις επιλογές → η σειρά δεν αλλάζει
  const o = wish.preferredOrder(MORNING_OPTS, mkWish({ start: '16:00', end: '24:00' }), D);
  t('αίτημα ασύμβατο με όλες: ίδια σειρά', o.map((x) => x[0]).join(','), '08:00,09:00,07:30,10:00');
}

  // --- Ωράρια «μόνο ως επιθυμία» (12:00-20:00, 15:00-23:00) ---
  {
    const MORN = [['08:00', '16:00'], ['09:00', '17:00']];
    const w = mkWish({ start: '12:00', end: '20:00' });
    const o = wish.withWishOption(MORN, w, D);
    t('το αιτούμενο ωράριο που ΛΕΙΠΕΙ προστίθεται μπροστά', o[0].join('-'), '12:00-20:00');
    t('καμία υπάρχουσα επιλογή δεν χάθηκε', o.length, MORN.length + 1);
    ta('οι υπάρχουσες μένουν στη σειρά τους',
      o.slice(1).map((x) => x.join('-')).join(',') === '08:00-16:00,09:00-17:00');

    const AFT = [['16:00', '24:00'], ['15:00', '23:00']];
    const o2 = wish.withWishOption(AFT, mkWish({ start: '15:00', end: '23:00' }), D);
    t('αν ΥΠΑΡΧΕΙ ήδη, δεν διπλασιάζεται', o2.length, 2);
    t('…και μπαίνει πρώτο', o2[0].join('-'), '15:00-23:00');

    ta('χωρίς αίτημα: ίδια αναφορά πίνακα', wish.withWishOption(MORN, null, D) === MORN);
    t('12:00-20:00 είναι απογευματινή', wish.shiftClass('12:00', '20:00'), 'afternoon');
    t('15:00-23:00 είναι απογευματινή', wish.shiftClass('15:00', '23:00'), 'afternoon');
  }
console.log('\n========== 4. ΒΑΡΗ SCORING (tie-breaker, ΟΧΙ υπερίσχυση) ==========');

{
  const w = mkWish({ start: '10:00', end: '18:00' });
  t('ακριβής ταύτιση → +12', wish.scoreBonus(w, D, '10:00', '18:00'), 12);
  t('μερική → +4', wish.scoreBonus(w, D, '09:00', '17:00'), 4);
  t('ασύμβατη → 0', wish.scoreBonus(w, D, '16:00', '24:00'), 0);
  t('χωρίς αίτημα → 0', wish.scoreBonus(null, D, '10:00', '18:00'), 0);
}
// Τα βάρη ΔΕΝ επιτρέπεται να φτάσουν τους ισχυρούς κανόνες του engine:
// αν κάποιος τα ανεβάσει, το test σπάει και τον σταματά.
ta('το μπόνους είναι μικρότερο από sunday_worker (+40)', wish.WISH_BONUS_EXACT < 40);
ta('το μπόνους είναι μικρότερο από την κάλυψη ΣΚ (60/μέρα)', wish.WISH_BONUS_EXACT < 60);
ta('το μπόνους είναι πολύ μικρότερο από avoid_weekend_62 (300)', wish.WISH_BONUS_EXACT < 300 / 10);
ta('η ποινή ρεπό είναι μικρότερη από το ζευγάρωμα ρεπό (+35)', wish.WISH_OFF_PENALTY < 35);

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 5. ΑΞΙΟΛΟΓΗΣΗ & ΑΙΤΙΟΛΟΓΗΣΗ ==========');

{
  const ws = [
    mkWish({ id: 1, agent_id: 1, name: 'ΑΚΡΙΒΗΣ', start: '16:00', end: '24:00' }),
    mkWish({ id: 2, agent_id: 2, name: 'ΜΕΡΙΚΗ', start: '16:00', end: '24:00' }),
    mkWish({ id: 3, agent_id: 3, name: 'ΑΣΥΜΒΑΤΗ', start: '16:00', end: '24:00' }),
    mkWish({ id: 4, agent_id: 4, name: 'ΑΔΕΙΑ', start: '16:00', end: '24:00' }),
    mkWish({ id: 5, agent_id: 5, name: 'ΡΕΠΟ', start: '16:00', end: '24:00' })
  ];
  const entryFor = (id) => ({
    1: { type: 'work', start: '16:00', end: '24:00' },
    2: { type: 'work', start: '15:30', end: '23:30' },
    3: { type: 'work', start: '06:00', end: '14:00' },
    4: { type: 'off', offType: 'leave' },
    5: { type: 'off', offType: 'repo' }
  }[id]);
  const r = wish.evaluate(ws, entryFor, null);
  const by = Object.fromEntries(r.map((x) => [x.name, x]));

  t('ΑΚΡΙΒΗΣ → satisfied', by['ΑΚΡΙΒΗΣ'].status, 'satisfied');
  t('ΜΕΡΙΚΗ → partial', by['ΜΕΡΙΚΗ'].status, 'partial');
  t('ΑΣΥΜΒΑΤΗ → unsatisfied', by['ΑΣΥΜΒΑΤΗ'].status, 'unsatisfied');
  t('ΑΔΕΙΑ → unsatisfied', by['ΑΔΕΙΑ'].status, 'unsatisfied');
  t('ΡΕΠΟ → unsatisfied', by['ΡΕΠΟ'].status, 'unsatisfied');

  ta('η άδεια αιτιολογείται ως Κ6', /άδεια/.test(by['ΑΔΕΙΑ'].reason), by['ΑΔΕΙΑ'].reason);
  ta('η ασύμβατη αναφέρει τι πήρε', /06:00-14:00/.test(by['ΑΣΥΜΒΑΤΗ'].reason), by['ΑΣΥΜΒΑΤΗ'].reason);
  ta('η ασύμβατη εξηγεί ΓΙΑΤΙ', /κατηγορία/.test(by['ΑΣΥΜΒΑΤΗ'].reason), by['ΑΣΥΜΒΑΤΗ'].reason);
  ta('η μερική δηλώνει ποσοστό', /\d+%/.test(by['ΜΕΡΙΚΗ'].reason), by['ΜΕΡΙΚΗ'].reason);
  t('η ικανοποιημένη δεν έχει αιτιολογία', by['ΑΚΡΙΒΗΣ'].reason, null);

  const s = wish.summarize(r);
  t('σύνοψη: σύνολο 5', s.total, 5);
  t('σύνοψη: 1 ικανοποιήθηκε', s.satisfied, 1);
  t('σύνοψη: 1 μερικώς', s.partial, 1);
  t('σύνοψη: 3 όχι', s.unsatisfied, 3);
  t('σύνοψη: 40%', s.pct, 40);
}
{
  // Η probe υπερισχύει της γενικής αιτιολογίας όταν δίνεται
  const ws = [mkWish({ id: 9, agent_id: 9, name: 'Χ', start: '16:00', end: '24:00' })];
  const r = wish.evaluate(ws, () => ({ type: 'off', offType: 'repo' }), () => 'ΤΕΣΤ-ΑΙΤΙΑ (Κ8)');
  t('η αιτιολόγηση έρχεται από τον engine', r[0].reason, 'ΤΕΣΤ-ΑΙΤΙΑ (Κ8)');
}

// ══════════════════════════════════════════════════════════════════
console.log('\n========== 6. generateWeek (συνθετικό context) ==========');

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

// Απαιτήσεις ΜΕ period → ο engine δοκιμάζει εναλλακτικά ωράρια, εκεί έχει
// νόημα η αναδιάταξη. Headcount αρκετό για όλους τους agents των tests.
function mkCtx(agents, wishes = [], extra = {}) {
  const base = () => [
    req({ start: '08:00', end: '16:00', period: 'morning', department: 'call', headcount: 3, label: 'Πρωινή' }),
    req({ start: '16:00', end: '24:00', period: 'afternoon', department: 'call', headcount: 2, label: 'Απογευματινή' })
  ];
  return {
    agents,
    requirements: { weekday: base(), weekend: base() },
    eligibility: new Map(),
    timeOff: extra.timeOff || new Map(),
    wishes,
    roles: new Map([['Υπόλοιπα call', { id: 1, color: 'FFA6A6A6' }]])
  };
}
const WEEK = '2026-11-16'; // Δευτέρα
const workOf = (res, id) => res.assignments.filter((a) => !a.off && a.agentId === id);
const dayOf = (res, id, date) => workOf(res, id).find((a) => a.date === date) || null;
const wishRes = (res, name) => (res.report.wishes || []).find((x) => x.name === name) || null;

console.log('\n--- Α. Το αίτημα ικανοποιείται όταν γίνεται ---');
{
  const a1 = mkAgent('ΖΗΤΑ-10');
  const a2 = mkAgent('ΑΛΛΟΣ1');
  const a3 = mkAgent('ΑΛΛΟΣ2');
  const a4 = mkAgent('ΑΛΛΟΣ3');
  const a5 = mkAgent('ΑΛΛΟΣ4');
  const ctx = mkCtx([a1, a2, a3, a4, a5],
    [mkWish({ id: 1, agent_id: a1.id, name: 'ΖΗΤΑ-10', date: WEEK, start: '10:00', end: '18:00' })]);
  const res = generateWeek(ctx, WEEK, {});
  const e = dayOf(res, a1.id, WEEK);
  ta('ο agent δουλεύει τη ζητούμενη μέρα', !!e, 'δεν δούλεψε καθόλου τη Δευτέρα');
  if (e) t('πήρε ΑΚΡΙΒΩΣ το αιτούμενο 10:00-18:00', `${e.start}-${e.end}`, '10:00-18:00');
  const r = wishRes(res, 'ΖΗΤΑ-10');
  ta('υπάρχει αποτέλεσμα στην αναφορά', !!r);
  if (r) t('κατάσταση: satisfied', r.status, 'satisfied');
  ta('η σύνοψη μπήκε στο report.soft',
    res.report.soft.some((x) => /ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ/.test(x)));
}

console.log('\n--- Β. ΧΩΡΙΣ αίτημα: ΚΑΜΙΑ αλλαγή στο πρόγραμμα ---');
{
  const mk = () => [mkAgent('Α'), mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε')];
  nextId = 101; const g1 = mk();
  nextId = 101; const g2 = mk();
  const plain = generateWeek(mkCtx(g1, []), WEEK, {});
  const withEmpty = generateWeek(mkCtx(g2, []), WEEK, {});
  const sig = (r) => r.assignments.map((a) => `${a.agentId}|${a.date}|${a.off ? 'OFF' : a.start + '-' + a.end}`).sort().join(';');
  t('το πρόγραμμα είναι ΠΑΝΟΜΟΙΟΤΥΠΟ', sig(plain), sig(withEmpty));
  t('καμία αναφορά αιτημάτων', (plain.report.wishes || []).length, 0);
}

console.log('\n--- Γ. Το αίτημα ΔΕΝ παρακάμπτει ατομικό κανόνα (Κ3) ---');
{
  const a1 = mkAgent('ΜΟΝΟ-ΠΡΩΙ', { rules: [{ type: 'only_morning' }] });
  const ctx = mkCtx([a1, mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε')],
    [mkWish({ id: 1, agent_id: a1.id, name: 'ΜΟΝΟ-ΠΡΩΙ', date: WEEK, start: '16:00', end: '24:00' })]);
  const res = generateWeek(ctx, WEEK, {});
  const e = dayOf(res, a1.id, WEEK);
  if (e) ta(`ΔΕΝ πήρε απογευματινή (πήρε ${e.start}-${e.end})`, e.start < '12:00',
    'ΠΑΡΑΒΙΑΣΗ: το αίτημα παρέκαμψε τον only_morning');
  const r = wishRes(res, 'ΜΟΝΟ-ΠΡΩΙ');
  if (r) {
    t('αναφέρεται ως ΜΗ ικανοποιημένο', r.status, 'unsatisfied');
    ta('αιτιολόγηση: ατομικός κανόνας', /Κ3|Κ5|κανόν/.test(r.reason || ''), r.reason);
  }
}

console.log('\n--- Δ. Το αίτημα ΔΕΝ παρακάμπτει την άδεια (Κ6) ---');
{
  const a1 = mkAgent('ΣΕ-ΑΔΕΙΑ');
  const timeOff = new Map([[`${a1.id}|${WEEK}`, 'leave']]);
  const ctx = mkCtx([a1, mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε')],
    [mkWish({ id: 1, agent_id: a1.id, name: 'ΣΕ-ΑΔΕΙΑ', date: WEEK, start: '10:00', end: '18:00' })],
    { timeOff });
  const res = generateWeek(ctx, WEEK, {});
  t('ΔΕΝ δούλεψε τη μέρα της άδειας', dayOf(res, a1.id, WEEK), null);
  const r = wishRes(res, 'ΣΕ-ΑΔΕΙΑ');
  if (r) {
    t('αναφέρεται ως ΜΗ ικανοποιημένο', r.status, 'unsatisfied');
    ta('αιτιολόγηση: άδεια (Κ6)', /άδεια/.test(r.reason || ''), r.reason);
  }
}

console.log('\n--- Ε. Πολλά αιτήματα: κανένας κανόνας δεν σπάει ---');
{
  nextId = 300;
  const ag = [];
  for (let i = 0; i < 8; i++) ag.push(mkAgent(`Π${i}`));
  // Κάθε agent ζητά 10:00-18:00 ΚΑΘΕ μέρα της εβδομάδας — ακραίο σενάριο
  const ws = [];
  let id = 1;
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10);
    dates.push(dt);
    for (const a of ag) ws.push(mkWish({ id: id++, agent_id: a.id, name: a.name, date: dt, start: '10:00', end: '18:00' }));
  }
  const res = generateWeek(mkCtx(ag, ws), WEEK, {});

  // Κ2: μία βάρδια/μέρα
  const seen = new Set();
  let dup = 0;
  for (const a of res.assignments) {
    if (a.off) continue;
    const k = `${a.agentId}|${a.date}`;
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  t('καμία διπλή ανάθεση (Κ2)', dup, 0);

  // Κ2: μέγιστο 5 εργάσιμες
  let over5 = 0;
  for (const a of ag) if (workOf(res, a.id).length > 5) over5++;
  t('κανείς πάνω από 5 εργάσιμες (Κ2)', over5, 0);

  // Κ10: μέγιστο 5 συνεχόμενες
  let over5run = 0;
  for (const a of ag) {
    const d = new Set(workOf(res, a.id).map((x) => x.date));
    let run = 0, max = 0;
    for (const dt of dates) { run = d.has(dt) ? run + 1 : 0; max = Math.max(max, run); }
    if (max > 5) over5run++;
  }
  t('καμία σειρά >5 συνεχόμενων ημερών (Κ10)', over5run, 0);

  // Κ8: 11ωρη ανάπαυση μεταξύ διαδοχικών ημερών
  let restBad = 0;
  for (const a of ag) {
    const byDate = new Map(workOf(res, a.id).map((x) => [x.date, x]));
    for (let i = 0; i < dates.length - 1; i++) {
      const cur = byDate.get(dates[i]);
      const nxt = byDate.get(dates[i + 1]);
      if (!cur || !nxt) continue;
      const toM = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      let endAbs = toM(cur.end);
      if (endAbs <= toM(cur.start)) endAbs += 1440;
      if (toM(nxt.start) + 1440 - endAbs < 11 * 60) restBad++;
    }
  }
  t('καμία παραβίαση 11ώρου (Κ8)', restBad, 0);

  // Ο έλεγχος εξαημέρου του ίδιου του engine
  const sixAudit = res.report.soft.filter((x) => /ΕΞΑΗΜΕΡ|εξαήμερ/i.test(String(x)));
  t('ο audit εξαημέρου του engine δεν βρήκε παραβίαση', sixAudit.length, 0,
    sixAudit.join(' | '));

  // Κάλυψη: τα αιτήματα δεν άφησαν θέσεις ακάλυπτες
  t('καμία ακάλυπτη απαίτηση', res.report.uncovered.length, 0,
    JSON.stringify(res.report.uncovered.slice(0, 3)));

  // Αξιολόγηση όλων των αιτημάτων
  const rs = res.report.wishes || [];
  t(`αξιολογήθηκαν όλα τα αιτήματα της εβδομάδας (${rs.length})`, rs.length, ws.length);
  ta('κάθε μη-ικανοποιημένο έχει αιτιολογία',
    rs.filter((x) => x.status !== 'satisfied').every((x) => !!x.reason),
    JSON.stringify(rs.filter((x) => x.status !== 'satisfied' && !x.reason).slice(0, 3)));
  const sm = wish.summarize(rs);
  console.log(`        → ${sm.satisfied} ακριβώς, ${sm.partial} μερικώς, ${sm.unsatisfied} όχι (${sm.pct}%)`);
  ta('ικανοποιήθηκε τουλάχιστον ένα', sm.satisfied > 0);
}

console.log('\n--- ΣΤ. Η κάλυψη ΔΕΝ χειροτερεύει από τα αιτήματα ---');
{
  // Συγκριτικό test: ΙΔΙΟ fixture, με και χωρίς αιτήματα. Το ερώτημα δεν είναι
  // «μένει τίποτα ακάλυπτο» — αυτό εξαρτάται από το πλήθος προσωπικού — αλλά
  // «ΧΕΙΡΟΤΕΡΕΥΕΙ η κάλυψη εξαιτίας των αιτημάτων», που απαγορεύεται ρητά.
  const build = () => {
    nextId = 500; // ΙΔΙΑ ids στα δύο σενάρια → άμεσα συγκρίσιμα
    return ['Κ1', 'Κ2', 'Κ3', 'Κ4', 'Κ5', 'Κ6', 'Κ7', 'Κ8'].map((n) => mkAgent(n));
  };
  const agA = build();
  const agB = build();
  // Όλοι ζητούν πρωινό 10:00-18:00 → μέγιστη πίεση στις απογευματινές θέσεις
  const ws = agB.map((a, i) => mkWish({ id: i + 1, agent_id: a.id, name: a.name, date: WEEK, start: '10:00', end: '18:00' }));

  const without = generateWeek(mkCtx(agA, []), WEEK, {});
  const withW = generateWeek(mkCtx(agB, ws), WEEK, {});

  t('ίδιο πλήθος ακάλυπτων με/χωρίς αιτήματα',
    withW.report.uncovered.length, without.report.uncovered.length,
    `χωρίς: ${without.report.uncovered.length}, με: ${withW.report.uncovered.length} → ` +
    JSON.stringify(withW.report.uncovered.slice(0, 3)));

  // Οι ΘΕΣΕΙΣ ΤΗΣ ΑΠΑΙΤΗΣΗΣ παραμένουν καλυμμένες. Προσοχή στη διάκριση: οι
  // αναθέσεις σε ωράριο 16:00 περιλαμβάνουν και fillers (διακριτική επιπλέον
  // στελέχωση για τις 5 εργάσιμες) — τα αιτήματα ΕΠΙΤΡΕΠΕΤΑΙ να μετακινούν
  // fillers, αλλά ΟΧΙ να αφήνουν θέση απαίτησης κενή.
  const reqRows = (r, label) => r.assignments.filter((a) => !a.off && a.date === WEEK && a.reqLabel === label).length;
  ta(`οι 2 απογευματινές θέσεις απαίτησης γέμισαν (${reqRows(withW, 'Απογευματινή')})`,
    reqRows(withW, 'Απογευματινή') >= 2, 'Θέση απαίτησης έμεινε κενή εξαιτίας αιτήματος');
  ta(`οι 3 πρωινές θέσεις απαίτησης γέμισαν (${reqRows(withW, 'Πρωινή')})`,
    reqRows(withW, 'Πρωινή') >= 3, 'Θέση απαίτησης έμεινε κενή εξαιτίας αιτήματος');

  // Οι ΣΥΝΟΛΙΚΕΣ ώρες κάλυψης δεν μειώθηκαν: ίδιο πλήθος αναθέσεων εργασίας
  // Οι απαιτούμενες ώρες κάλυψης δεν επιτρέπεται να ΜΕΙΩΘΟΥΝ. Μπορούν να
  // αυξηθούν: όταν το αιτούμενο ωράριο χωράει σε μέρα που αλλιώς θα έμενε
  // κενή, ένας επιπλέον agent φτάνει τις 5 εργάσιμες.
  const workCount = (r) => r.assignments.filter((a) => !a.off).length;
  ta(`οι ώρες κάλυψης δεν μειώθηκαν (χωρίς: ${workCount(without)}, με: ${workCount(withW)})`,
    workCount(withW) >= workCount(without));

  const sm = wish.summarize(withW.report.wishes || []);
  console.log(`        → ${sm.satisfied} ακριβώς, ${sm.partial} μερικώς, ${sm.unsatisfied} όχι`);
  ta('ικανοποιήθηκε τουλάχιστον ένα αίτημα', sm.satisfied > 0);
}


console.log('\n--- Ζ. Ωράριο «μόνο ως επιθυμία» (12:00-20:00) ---');
{
  // Δεν υπάρχει στους fillers ούτε στις απαιτήσεις: μπαίνει ΜΟΝΟ επειδή το
  // ζήτησε ο συγκεκριμένος εργαζόμενος, και μόνο αν περάσει τους ελέγχους.
  nextId = 700;
  const a1 = mkAgent('ΖΗΤΑ-12');
  const ag = [a1, mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε'), mkAgent('ΣΤ')];
  const res = generateWeek(mkCtx(ag,
    [mkWish({ id: 1, agent_id: a1.id, name: 'ΖΗΤΑ-12', date: WEEK, start: '12:00', end: '20:00' })]), WEEK, {});
  const r = wishRes(res, 'ΖΗΤΑ-12');
  ta('το αίτημα αξιολογήθηκε', !!r);

  // Συγκριτικά με το ίδιο fixture ΧΩΡΙΣ αίτημα — η κάλυψη δεν χειροτερεύει
  nextId = 700;
  const agB = ['ΖΗΤΑ-12', 'Β', 'Γ', 'Δ', 'Ε', 'ΣΤ'].map((n) => mkAgent(n));
  const plain = generateWeek(mkCtx(agB, []), WEEK, {});
  t('ίδια ακάλυπτα με/χωρίς το αίτημα',
    res.report.uncovered.length, plain.report.uncovered.length);

  const used12 = res.assignments.filter((x) => !x.off && x.start === '12:00');
  ta(`το 12:00-20:00 δεν διέρρευσε σε άλλους (${used12.length} αναθέσεις)`,
    used12.every((x) => x.agentId === a1.id),
    'Ωράριο μόνο-επιθυμίας δόθηκε σε εργαζόμενο που δεν το ζήτησε');
}
{
  // ΠΟΤΕ ικανοποιείται: όταν ο εργαζόμενος τοποθετείται ως filler, δηλαδή
  // ΔΕΝ καλύπτει θέση του πίνακα απαιτήσεων. Λίγες απαιτήσεις, πολλοί agents.
  nextId = 900;
  const a1 = mkAgent('FILLER-12');
  const ag = ['Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ'].map((n) => mkAgent(n, { skills: ['ATLAS'] }));
  // Οι απαιτήσεις θέλουν δεξιότητα που ο a1 ΔΕΝ έχει → δεν μπορεί να καλύψει
  // θέση του πίνακα, άρα τοποθετείται αποκλειστικά από τη φάση fillers.
  const few = () => [
    req({ start: '08:00', end: '16:00', period: 'morning', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Πρωινή' }),
    req({ start: '16:00', end: '24:00', period: 'afternoon', skill: 'ATLAS', department: 'call', headcount: 1, label: 'Απογευματινή' })
  ];
  const ctx = {
    agents: [a1, ...ag],
    requirements: { weekday: few(), weekend: few() },
    eligibility: new Map(), timeOff: new Map(),
    wishes: [mkWish({ id: 1, agent_id: a1.id, name: 'FILLER-12', date: WEEK, start: '12:00', end: '20:00' })],
    roles: new Map([['Υπόλοιπα call', { id: 1, color: 'FFA6A6A6' }]])
  };
  const res = generateWeek(ctx, WEEK, {});
  const e = dayOf(res, a1.id, WEEK);
  ta(`ως filler ΠΑΙΡΝΕΙ το 12:00-20:00 (πήρε ${e ? e.start + '-' + e.end : 'ρεπό'})`,
    !!e && e.start === '12:00' && e.end === '20:00',
    'Το ωράριο μόνο-επιθυμίας δεν μπήκε ποτέ — η λειτουργία θα ήταν κενή');
  const r = wishRes(res, 'FILLER-12');
  if (r) t('αναφέρεται ως ικανοποιημένο', r.status, 'satisfied');
}
{
  // Με only_morning ΔΕΝ επιτρέπεται — ο κανόνας υπερισχύει του αιτήματος
  nextId = 800;
  const b1 = mkAgent('ΜΟΝΟ-ΠΡΩΙ-12', { rules: [{ type: 'only_morning' }] });
  const res2 = generateWeek(mkCtx([b1, mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε')],
    [mkWish({ id: 1, agent_id: b1.id, name: 'ΜΟΝΟ-ΠΡΩΙ-12', date: WEEK, start: '12:00', end: '20:00' })]), WEEK, {});
  const e2 = dayOf(res2, b1.id, WEEK);
  if (e2) {
    ta(`only_morning: ΔΕΝ πήρε 12:00-20:00 (πήρε ${e2.start}-${e2.end})`, e2.start !== '12:00',
      'ΠΑΡΑΒΙΑΣΗ: ωράριο μόνο-επιθυμίας παρέκαμψε ατομικό κανόνα');
  }
  const r2 = wishRes(res2, 'ΜΟΝΟ-ΠΡΩΙ-12');
  if (r2) ta('αναφέρεται ως ΜΗ ικανοποιημένο με αιτιολογία', r2.status === 'unsatisfied' && !!r2.reason, r2.reason);
}


console.log('\n--- Η. Ασύμβατη βάρδια σε μέρα ΜΕ αίτημα (η μέρα «καίγεται») ---');
{
  const w = mkWish({ start: '16:00', end: '24:00' });
  t('ασύμβατη πρωινή → ποινή', wish.conflictPenalty(w, D, '07:30', '15:30'), wish.WISH_CONFLICT_PENALTY);
  t('ακριβής → καμία ποινή', wish.conflictPenalty(w, D, '16:00', '24:00'), 0);
  t('μερικώς συμβατή → καμία ποινή', wish.conflictPenalty(w, D, '15:30', '23:30'), 0);
  t('χωρίς αίτημα → 0', wish.conflictPenalty(null, D, '07:30', '15:30'), 0);
  ta('η ποινή υπερβαίνει το μπόνους (αλλιώς δεν θα έπαιζε ποτέ)',
    wish.WISH_CONFLICT_PENALTY > wish.WISH_BONUS_EXACT);
}
{
  // Σενάριο παραγωγής (Δημακη 27/11): υπάρχει ΚΑΙ πρωινή ΚΑΙ απογευματινή
  // θέση. Χωρίς την ποινή η πρωινή «τρώει» τη μέρα και το αίτημα χάνεται.
  // Αρκετό προσωπικό ώστε να υπάρχει ΠΡΑΓΜΑΤΙΚΟΣ ανταγωνισμός για την πρωινή
  // θέση (10 άτομα, 5 θέσεις/ημέρα) — αλλιώς η τοποθέτησή της είναι αναγκαία
  // και καμία ποινή δεν πρέπει (ούτε επιτρέπεται) να την αποτρέψει.
  const mk10 = () => {
    nextId = 1300;
    const first = mkAgent('ΖΗΤΑ-ΑΠΟΓΕΥΜΑ');
    return [first, ...['Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ', 'Η', 'Θ', 'Ι'].map((n) => mkAgent(n))];
  };
  const agA = mk10();
  const agB = mk10();
  const plain = generateWeek(mkCtx(agA, []), WEEK, {});
  const res = generateWeek(mkCtx(agB,
    [mkWish({ id: 1, agent_id: agB[0].id, name: 'ΖΗΤΑ-ΑΠΟΓΕΥΜΑ', date: WEEK, start: '16:00', end: '24:00' })]), WEEK, {});

  const e0 = dayOf(plain, agA[0].id, WEEK);
  const e = dayOf(res, agB[0].id, WEEK);
  console.log(`        χωρίς αίτημα: ${e0 ? e0.start + '-' + e0.end : 'ρεπό'} → με αίτημα: ${e ? e.start + '-' + e.end : 'ρεπό'}`);
  ta(`δεν πήρε πρωινή εκείνη τη μέρα (πήρε ${e ? e.start + '-' + e.end : 'ρεπό'})`,
    !e || e.start >= '12:00', 'Η πρωινή «έκαψε» τη μέρα του αιτήματος');
  const r = wishRes(res, 'ΖΗΤΑ-ΑΠΟΓΕΥΜΑ');
  if (r) ta(`αίτημα: ${r.status}`, r.status !== 'unsatisfied', r.reason);
  t('η κάλυψη ΔΕΝ χειροτέρεψε', res.report.uncovered.length, plain.report.uncovered.length,
    JSON.stringify(res.report.uncovered.slice(0, 2)));
}
// ══════════════════════════════════════════════════════════════════
console.log('\n========== 7. ΚΑΝΟΝΑΣ 2 ΡΕΠΟ (15/11/2026) ==========');
const sixday = require('../src/scheduler/sixday');

const WK = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
const nm = new Map([[1, 'ΑΛΦΑ'], [2, 'ΒΗΤΑ'], [3, 'ΓΑΜΑ']]);
const wrk = (id, i) => ({ agentId: id, date: WK[i], start: '08:00', end: '16:00' });
const off = (id, i, reason) => ({ agentId: id, date: WK[i], off: true, reason: reason || 'repo' });

console.log('\n--- 1. Εργαζόμενος με 5 ημέρες εργασίας και 2 ρεπό ---');
{
  const as = [wrk(1, 0), wrk(1, 1), wrk(1, 2), wrk(1, 3), wrk(1, 4), off(1, 5), off(1, 6)];
  const r = sixday.findLowRest({ assignments: as, dates: WK, names: nm });
  t('καμία παραβίαση', r.violations.length, 0);
  t('ούτε επιπλέον ρεπό', r.extraOff.length, 0);
  t('…και κανένα εξαήμερο', sixday.findSixDay({ assignments: as, names: nm }).length, 0);
}

console.log('\n--- 2. Εργαζόμενος που κινδυνεύει να γίνει εξαήμερος λόγω ΠΡΟΗΓΟΥΜΕΝΗΣ εβδομάδας ---');
{
  // Προηγούμενη εβδομάδα (Excel import): δούλεψε τις 2 τελευταίες μέρες.
  // Τρέχουσα: Δευ-Πεμ εργασία → 2+4 = 6 συνεχόμενες.
  const prev = [
    { agentId: 2, date: '2026-11-21', start: '08:00', end: '16:00' },
    { agentId: 2, date: '2026-11-22', start: '08:00', end: '16:00' }
  ];
  const cur = [wrk(2, 0), wrk(2, 1), wrk(2, 2), wrk(2, 3), off(2, 4), off(2, 5), off(2, 6)];
  const v = sixday.findSixDay({ assignments: cur, prevAssignments: prev, names: nm });
  ta(`εντοπίστηκε εξαήμερο στο σύνορο εβδομάδων (${v.length})`, v.length > 0,
    'Η συνέχεια με την προηγούμενη εβδομάδα ΔΕΝ ελέγχθηκε');
  if (v.length) {
    t('σωστός εργαζόμενος', v[0].name, 'ΒΗΤΑ');
    ta(`${v[0].days} συνεχόμενες ημέρες`, v[0].days >= 6);
  }
  // …ενώ με ρεπό ανάμεσα, καθαρό
  const cur2 = [off(2, 0), wrk(2, 1), wrk(2, 2), wrk(2, 3), wrk(2, 4), off(2, 5), off(2, 6)];
  t('με ρεπό Δευτέρας: κανένα εξαήμερο',
    sixday.findSixDay({ assignments: cur2, prevAssignments: prev, names: nm }).length, 0);
  t('…και 2 ρεπό κανονικά',
    sixday.findLowRest({ assignments: cur2, dates: WK, names: nm }).violations.length, 0);
}

console.log('\n--- 3. Εργαζόμενος με επιθυμητό ωράριο ΔΕΝ χάνει το 2ο ρεπό ---');
{
  // Αίτημα κάθε μέρα της εβδομάδας — ακραία πίεση
  nextId = 1100;
  const a1 = mkAgent('ΖΗΤΑ-ΟΛΕΣ');
  const ag = [a1, mkAgent('Β'), mkAgent('Γ'), mkAgent('Δ'), mkAgent('Ε'), mkAgent('ΣΤ'), mkAgent('Ζ')];
  const ws = WK.map((d, i) => mkWish({ id: i + 1, agent_id: a1.id, name: 'ΖΗΤΑ-ΟΛΕΣ', date: d, start: '16:00', end: '24:00' }));
  const res = generateWeek(mkCtx(ag, ws), WEEK, {});
  for (const a of ag) {
    const worked = res.assignments.filter((x) => !x.off && x.agentId === a.id).length;
    ta(`${a.name}: ${7 - worked} ρεπό (≥2)`, 7 - worked >= 2,
      'ΠΑΡΑΒΙΑΣΗ: το αίτημα έφαγε το δεύτερο ρεπό');
  }
  const rest = sixday.findLowRest({ assignments: res.assignments, dates: res.dates, names: new Map(ag.map((a) => [a.id, a.name])) });
  t('ο επίσημος έλεγχος δεν βρίσκει παραβίαση', rest.violations.length, 0,
    JSON.stringify(rest.violations));
  t('ούτε εξαήμερο', sixday.findSixDay({ assignments: res.assignments, names: new Map(ag.map((a) => [a.id, a.name])) }).length, 0);
}

console.log('\n--- 4. Δεν επαρκεί το προσωπικό για όλες τις βάρδιες ---');
{
  // 3 agents, 5 θέσεις/ημέρα: αδύνατο να καλυφθούν όλες ΧΩΡΙΣ να κοπούν ρεπό.
  // Ο generator ΠΡΕΠΕΙ να αφήσει ακάλυπτα, ΟΧΙ να φάει το 2ο ρεπό.
  nextId = 1200;
  const ag = [mkAgent('Μ1'), mkAgent('Μ2'), mkAgent('Μ3')];
  const res = generateWeek(mkCtx(ag, []), WEEK, {});
  const names2 = new Map(ag.map((a) => [a.id, a.name]));
  const rest = sixday.findLowRest({ assignments: res.assignments, dates: res.dates, names: names2 });
  t('ΚΑΝΕΙΣ δεν έχει <2 ρεπό', rest.violations.length, 0, JSON.stringify(rest.violations));
  t('κανένα εξαήμερο', sixday.findSixDay({ assignments: res.assignments, names: names2 }).length, 0);
  ta(`οι ακάλυπτες βάρδιες αναφέρονται (${res.report.uncovered.length})`, res.report.uncovered.length > 0,
    'Η έλλειψη προσωπικού ΔΕΝ αναφέρθηκε — ύποπτο');
  for (const a of ag) {
    const worked = res.assignments.filter((x) => !x.off && x.agentId === a.id).length;
    ta(`${a.name}: ${worked} εργάσιμες, ${7 - worked} ρεπό`, worked <= 5);
  }
}

console.log('\n--- 5. Ο έλεγχος ΠΙΑΝΕΙ πραγματική παραβίαση ---');
{
  const as = [wrk(3, 0), wrk(3, 1), wrk(3, 2), wrk(3, 3), wrk(3, 4), wrk(3, 5), off(3, 6)];
  const r = sixday.findLowRest({ assignments: as, dates: WK, names: nm });
  t('6 εργάσιμες + 1 ρεπό → παραβίαση', r.violations.length, 1);
  if (r.violations[0]) {
    t('σωστά στοιχεία', r.violations[0].workDays + '/' + r.violations[0].offDays, '6/1');
    ta('το μήνυμα είναι κατανοητό', /ΓΑΜΑ.*6 ημέρες.*1 ρεπό/.test(sixday.describeRest(r.violations)),
      sixday.describeRest(r.violations));
  }
  // 7 μέρες εργασία → επίσης παραβίαση
  const as7 = WK.map((_, i) => wrk(3, i));
  t('7 εργάσιμες → παραβίαση', sixday.findLowRest({ assignments: as7, dates: WK, names: nm }).violations.length, 1);
  // 3 ρεπό → ΟΧΙ παραβίαση, μόνο αναφορά
  const as3 = [wrk(3, 0), wrk(3, 1), wrk(3, 2), wrk(3, 3), off(3, 4), off(3, 5), off(3, 6)];
  const r3 = sixday.findLowRest({ assignments: as3, dates: WK, names: nm });
  t('3 ρεπό → ΔΕΝ μπλοκάρει', r3.violations.length, 0);
  t('…αλλά αναφέρεται', r3.extraOff.length, 1);
  // Η άδεια μετράει ως μη-εργάσιμη για τα ρεπό
  const asL = [wrk(3, 0), wrk(3, 1), wrk(3, 2), wrk(3, 3), wrk(3, 4), off(3, 5, 'leave'), off(3, 6, 'leave')];
  t('άδεια μετράει ως μη-εργάσιμη ημέρα',
    sixday.findLowRest({ assignments: asL, dates: WK, names: nm }).violations.length, 0);
}

console.log('\n--- 6. ΜΕΤΑΦΕΡΟΜΕΝΗ ΣΕΙΡΑ ΑΠΟ ΠΡΟΗΓΟΥΜΕΝΗ ΚΥΡΙΑΚΗ (15/11/2026) ---');
{
  // Όποιος δούλεψε την προηγούμενη Κυριακή ΔΕΝ χωράει και στις 5 καθημερινές
  // (θα γινόταν εξαήμερο), άρα ΧΡΕΙΑΖΕΤΑΙ θέση ΣΚ για να φτάσει τις 5.
  // Πριν τη διόρθωση η φάση ΣΚ δεν το έβλεπε (καμία καθημερινή ανατεθειμένη
  // ακόμη → back = 0 → το streak αγνοούνταν) και κατέληγε με 4 εργάσιμες.
  nextId = 1500;
  const ag = ['Κ1', 'Κ2', 'Κ3', 'Κ4', 'Κ5', 'Κ6', 'Κ7'].map((n) => mkAgent(n));
  const carry = ag[0];
  const st = {};
  st[carry.id] = {
    streak: 1, lastEndAbs: -Infinity, nights: 0, weekends: 0,
    count1903: 0, count62: 0, rizouMode: 'morning', sundays: {}, sundaysOff: {}, pendingNightRest: 0
  };
  const res = generateWeek(mkCtx(ag, []), WEEK, st);
  const mine = workOf(res, carry.id);
  const wkndDays = mine.filter((x) => x.date >= '2026-11-21').length;

  t(`ο agent με σειρά 1 παίρνει 5 εργάσιμες`, mine.length, 5,
    'Χωρίς θέση ΣΚ καταλήγει με 4 — η μεταφερόμενη Κυριακή δεν ελήφθη υπόψη');
  ta(`…και δουλεύει ${wkndDays} ημέρα/ες ΣΚ`, wkndDays >= 1,
    'Δεν πήρε θέση ΣΚ, άρα δεν μπορούσε να φτάσει τις 5 χωρίς εξαήμερο');

  // Δεν σπάει το εξαήμερο: Δευ-Παρ + σειρά 1 θα ήταν 6
  const wd = mine.filter((x) => x.date < '2026-11-21').length;
  ta(`το πολύ 4 καθημερινές (πήρε ${wd})`, wd <= 4,
    'ΠΑΡΑΒΙΑΣΗ: 5 καθημερινές + Κυριακή = εξαήμερο');

  // Χωρίς σειρά, ο ίδιος agent μπορεί κανονικά και τις 5 καθημερινές
  nextId = 1500;
  const ag2 = ['Κ1', 'Κ2', 'Κ3', 'Κ4', 'Κ5', 'Κ6', 'Κ7'].map((n) => mkAgent(n));
  const res2 = generateWeek(mkCtx(ag2, []), WEEK, {});
  t('χωρίς σειρά: επίσης 5 εργάσιμες', workOf(res2, ag2[0].id).length, 5);
}

console.log('\n--- 7. ΑΚΡΙΒΩΣ 5 ΕΡΓΑΣΙΜΕΣ / 2 ΡΕΠΟ (15/11/2026) ---');
{
  const ag = [{ id: 1, name: 'ΑΛΦΑ' }, { id: 2, name: 'ΒΗΤΑ' }, { id: 3, name: 'ΓΑΜΑ' }];
  const mk = (id, n) => WK.slice(0, n).map((d) => ({ agentId: id, date: d, start: '08:00', end: '16:00' }));
  const avail = new Map([[1, 7], [2, 7], [3, 7]]);
  const noLeave = new Map([[1, 0], [2, 0], [3, 0]]);

  // 5 ημέρες = στόχος
  let r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 5), dates: WK, leaveByAgent: noLeave, availByAgent: avail });
  t('5 εργάσιμες → εντάξει', r.blocking.length + r.impossible.length, 0);

  // 4 ημέρες ενώ είχε 7 διαθέσιμες → ΜΠΛΟΚΑΡΕΙ
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 4), dates: WK, leaveByAgent: noLeave, availByAgent: avail });
  t('4 ενώ είχε 7 διαθέσιμες → blocking', r.blocking.length, 1);
  t('…όχι impossible', r.impossible.length, 0);

  // 6 ημέρες → ΠΑΝΤΑ blocking
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 6), dates: WK, leaveByAgent: noLeave, availByAgent: avail });
  t('6 εργάσιμες → blocking', r.blocking.length, 1);
  ta('…με σαφή αιτία', /6 ημέρες αντί για 5/.test(r.blocking[0].reason), r.blocking[0] && r.blocking[0].reason);

  // ΑΔΕΙΑ: 2 ημέρες άδεια → στόχος 3
  const lv = new Map([[1, 2]]);
  const av5 = new Map([[1, 5]]);
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 3), dates: WK, leaveByAgent: lv, availByAgent: av5 });
  t('2 ημέρες άδεια + 3 εργάσιμες → εντάξει', r.blocking.length + r.impossible.length, 0);
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 5), dates: WK, leaveByAgent: lv, availByAgent: av5 });
  t('2 ημέρες άδεια + 5 εργάσιμες → blocking', r.blocking.length, 1);

  // ΟΛΗ η εβδομάδα άδεια → στόχος 0, καμία παραβίαση
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: [], dates: WK, leaveByAgent: new Map([[1, 7]]), availByAgent: new Map([[1, 0]]) });
  t('7 ημέρες άδεια → καμία παραβίαση', r.blocking.length + r.impossible.length, 0);

  // ΜΑΘΗΜΑΤΙΚΑ ΑΔΥΝΑΤΟ: 4 διαθέσιμες, στόχος 5 → impossible, ΟΧΙ blocking
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: mk(1, 4), dates: WK, leaveByAgent: noLeave, availByAgent: new Map([[1, 4]]) });
  t('διαθέσιμες 4 < στόχος 5 → impossible', r.impossible.length, 1);
  t('…ΔΕΝ μπλοκάρει', r.blocking.length, 0);
  ta('…με αιτία σταθερών περιορισμών', /διαθέσιμες μόνο 4/.test(r.impossible[0].reason), r.impossible[0].reason);

  // Εργαζόμενος ΧΩΡΙΣ καμία ανάθεση → πιάνεται
  r = sixday.findExactDays({ agents: ag, assignments: mk(1, 5), dates: WK, leaveByAgent: noLeave, availByAgent: avail });
  t('2 εργαζόμενοι χωρίς καμία βάρδια → blocking', r.blocking.length, 2);

  // Σπαστό ωράριο: 2 γραμμές την ίδια μέρα = 1 ημέρα
  const split = [];
  for (const d of WK.slice(0, 5)) {
    split.push({ agentId: 1, date: d, start: '09:00', end: '14:00' });
    split.push({ agentId: 1, date: d, start: '21:00', end: '24:00' });
  }
  r = sixday.findExactDays({ agents: ag.slice(0, 1), assignments: split, dates: WK, leaveByAgent: noLeave, availByAgent: avail });
  t('σπαστό ωράριο 5 ημερών = 5 εργάσιμες', r.blocking.length + r.impossible.length, 0);
}

console.log('\n--- Θ. Αίτημα ΔΕΝ σκοτώνεται από γειτονική μέρα (Κ8) ---');
{
  // Σενάριο παραγωγής (Δημακη): αίτημα Παρασκευή 16:00-24:00 ενώ δουλεύει
  // και Σάββατο. Με πρωινό Σάββατο (08:00) μένουν 8 ώρες ανάπαυση → το αίτημα
  // γίνεται ανέφικτο. Με απογευματινό Σάββατο βγαίνουν 16 ώρες και ισχύουν
  // ΚΑΙ οι 5 εργάσιμες ΚΑΙ το αίτημα.
  nextId = 1700;
  const a1 = mkAgent('ΖΗΤΑ-ΠΑΡ-ΑΠΟΓ');
  const ag = [a1, ...['Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ', 'Η'].map((n) => mkAgent(n))];
  const FRI = '2026-11-20';
  const res = generateWeek(mkCtx(ag,
    [mkWish({ id: 1, agent_id: a1.id, name: 'ΖΗΤΑ-ΠΑΡ-ΑΠΟΓ', date: FRI, start: '16:00', end: '24:00' })]), WEEK, {});

  const mine = workOf(res, a1.id).sort((x, y) => x.date.localeCompare(y.date));
  const fri = mine.find((x) => x.date === FRI);
  const sat = mine.find((x) => x.date === '2026-11-21');
  console.log('        ' + mine.map((x) => x.date.slice(8) + ' ' + x.start).join(' | '));

  const r = wishRes(res, 'ΖΗΤΑ-ΠΑΡ-ΑΠΟΓ');
  if (r) ta(`το αίτημα: ${r.status}`, r.status !== 'unsatisfied', r.reason);
  if (fri && sat) {
    const toM = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    let endF = toM(fri.end); if (endF <= toM(fri.start)) endF += 1440;
    const gap = toM(sat.start) + 1440 - endF;
    ta(`ανάπαυση Παρ→Σαβ ${(gap / 60).toFixed(1)}h ≥ 11h`, gap >= 11 * 60,
      'ΠΑΡΑΒΙΑΣΗ Κ8 — το αίτημα «πέρασε» σπάζοντας την ανάπαυση');
  }
  ta(`εργάσιμες ${mine.length} (στόχος 5)`, mine.length === 5,
    'Το αίτημα κόστισε εργάσιμη ημέρα');
}
// ══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`ΣΥΝΟΛΟ: ${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
