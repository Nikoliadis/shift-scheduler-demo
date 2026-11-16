// Ο αλγόριθμος δημιουργίας προγράμματος (ενότητα 8 του spec).
// Greedy με scoring, παραγωγή εβδομάδα-εβδομάδα με μεταφορά κατάστασης
// (συνεχόμενες μέρες Κ10, λήξη τελευταίας βάρδιας Κ8, μετρητές Σ3).
//
// Hard κανόνες: Κ1 skill/τμήμα, Κ2 1 βάρδια/μέρα & 5+2, Κ3 κανόνες agent,
// Κ4 νυχτερινή 23:00/23:30, Κ5 σταθερά ωράρια, Κ6 άδειες, Κ7 can_night,
// Κ8 11ωρο, Κ9 λίστα βραδινής 23:00-07:00, Κ10 μέγιστο 5 συνεχόμενες μέρες.
// Soft: Σ1-Σ5 μέσω scoring + αναφορά παραβιάσεων.
const { toMin, dayNum, shiftAbs, isMorning, isAfternoon, isNight } = require('./time');
const { addDays, dayOfWeek } = require('../utils/dates');
const wish = require('./wishes');

const REST_MIN = 11 * 60; // Κ8: 11 ώρες ανάπαυση
// Εξαίρεση Κ8: το σπαστό του Νικολαου (24:00 → 09:00 = 9 ώρες) είναι
// αποδεκτό επειδή προκύπτει από το ΔΗΛΩΜΕΝΟ σταθερό του ωράριο (Κ5).
const REST_MIN_SPLIT = 9 * 60;
const MAX_STREAK = 5; // Κ10

// ---------- Βραδινή βάρδια Κ9 («Vega Bank») ----------
// (14/11/2026) Το ωράριο άλλαξε από 19:00-03:00 σε 23:00-07:00. ΙΔΙΑ άτομα
// (η λίστα επιλεξιμότητας Κ9 δεν αλλάζει), ίδιοι κανόνες Κ9: μόνο από λίστα,
// όριο φορών/εβδομάδα, πολλαπλές μόνο συνεχόμενες + ρεπό μετά τη σειρά.
//
// ΠΡΟΣΟΧΗ: πλέον έχει ΤΙΣ ΙΔΙΕΣ ΩΡΕΣ με τη «Νυχτερινή Atlas» (23:00-07:00).
// Οι δύο βάρδιες ΔΕΝ ξεχωρίζουν από την ώρα — ξεχωρίζουν ΜΟΝΟ από την
// ετικέτα της απαίτησης (K9_LABEL) / το reqLabel της ανάθεσης. Κάθε έλεγχος
// που παλιά έλεγε `start === '19:00'` πρέπει να ελέγχει ετικέτα, ΟΧΙ ώρα.
const K9_START = '23:00';
const K9_END = '07:00';
const K9_LABEL = 'Verification & call υπόλοιπα';
const K9_ELIG_KEY = `${K9_START}-${K9_END}`;
// Η ΑΛΛΗ βάρδια με το ίδιο ωράριο. Ορίζεται εδώ ώστε να υπάρχει ΕΝΑ σημείο
// αλήθειας για τις δύο ετικέτες — τις χρειάζονται ο generator, ο validator,
// το Excel import (διάκριση από χρώμα) και τα tests.
const NIGHT_LABEL = 'Νυχτερινή Atlas';

// Είναι αυτή η απαίτηση η βραδινή Κ9 (και όχι η νυχτερινή Atlas);
function isK9Req(def) {
  return def.label === K9_LABEL;
}

// Είναι αυτή η ανάθεση/καταχώρηση η βραδινή Κ9;
function isK9Entry(e) {
  return !!e && e.start === K9_START && e.end === K9_END && e.reqLabel === K9_LABEL;
}

// Τυπικές βάρδιες για συμπλήρωση (όσοι δεν καλύπτουν συγκεκριμένη απαίτηση)
const FILLER_MORNING = [['08:00', '16:00'], ['09:00', '17:00'], ['07:30', '15:30'], ['10:00', '18:00']];
const FILLER_AFTERNOON = [['16:00', '24:00'], ['15:30', '23:30'], ['14:00', '22:00']];

// ---------- Βοηθητικά κανόνων ----------
function rule(agent, type) {
  return agent.rules.find((r) => r.type === type) || null;
}

// Αναζήτηση agent με το όνομα (για κανόνες ζεύγους) — ο χάρτης φτιάχνεται
// μία φορά ανά context και μένει αποθηκευμένος εκεί
function agentByName(ctx, name) {
  if (!ctx._byName) ctx._byName = new Map(ctx.agents.map((x) => [x.name, x]));
  return ctx._byName.get(name) || null;
}

// «Βραδινή» βάρδια = έναρξη 19:00 και μετά (19:00-03:00, 23:00-07:00,
// 23:30-07:30) — διακριτή από την «απογευματινή» (isAfternoon: 12:00-18:59).
// Χρησιμοποιείται από τον soft κανόνα prefer_morning_evening (05/09/2026).
function isEveningStart(start) {
  return toMin(start) >= 1140;
}

// prefer_morning_evening (ΡΟΥΣΣΟΥ ΟΛΓΑ): πόσο «βαραίνει» μια απογευματινή.
// ΠΡΟΤΙΜΗΣΗ, ΟΧΙ ΑΠΟΚΛΕΙΣΜΟΣ (16/09/2026): με πολύ μεγάλη ποινή δεν έπαιρνε
// ΚΑΜΙΑ απογευματινή. Η τιμή είναι ρυθμισμένη ώστε να μπαίνει πού και πού,
// μένοντας σαφής μειοψηφία μπροστά στις πρωινές/βραδινές. Ρυθμίζεται και ανά
// agent με { type: 'prefer_morning_evening', penalty: <αριθμός> }.
const AFTERNOON_SOFT_PENALTY = 12;

// Έλεγχος τμήματος απαίτησης: 'verification+call' σημαίνει ότι ο agent
// πρέπει να έχει ΚΑΙ τα δύο τμήματα (π.χ. Verification & call slots —
// απόφαση προϊσταμένου 10/07/2026: τα κάνει ΜΟΝΟ όποιος έχει ταμπέλα call).
function deptMatch(agent, department) {
  if (!department) return true;
  return department.split('+').every((d) => agent.departments.includes(d));
}

function restMinFor(agent) {
  return rule(agent, 'split_shift') ? REST_MIN_SPLIT : REST_MIN;
}

// ---------- Η κατάσταση εβδομάδας ----------
// plan ανά agent: days[0..6] = null | {type:'off', reason} | {type:'work', ...}
function newWeek(ctx, weekStart, state) {
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i));

  const plans = new Map();
  for (const a of ctx.agents) {
    plans.set(a.id, {
      agent: a,
      days: new Array(7).fill(null),
      offNeeded: 2,
      leaveDays: 0,
      teleworkDays: 0,
      elig1903Used: 0
    });
  }
  return {
    ctx, weekStart, dates, plans, state,
    // Επιθυμητές ώρες (15/11/2026): χάρτης O(1) ανά (agentId|date).
    // Κενός όταν δεν υπάρχουν αιτήματα → ο generator δουλεύει όπως πριν.
    wishIdx: wish.indexWishes(ctx.wishes),
    report: { uncovered: [], soft: [], notes: [], wishes: [] }
  };
}

function agentState(w, agentId) {
  if (!w.state[agentId]) {
    w.state[agentId] = { streak: 0, lastEndAbs: -Infinity, nights: 0, weekends: 0, count1903: 0, count62: 0, rizouMode: 'morning', sundays: {}, pendingNightRest: 0 };
  }
  return w.state[agentId];
}

// Εξαίρεση από το όριο Κυριακών: supervisors και όσοι έχουν σταθερό
// πρόγραμμα (σταθερό ωράριο με μέρες, σταθερή βάρδια ΣΚ όπως η Φραγκου,
// ή καλοκαιρινό weekly_pattern όπως οι Οικονομου)
function sundayExempt(agent) {
  return agent.departments.includes('supervisor') ||
    !!agent.weekendShift ||
    (agent.fixedStart && agent.fixedDays) ||
    !!rule(agent, 'weekly_pattern') ||
    // weekly_schedule (Οικονομου — 14/11/2026): σταθερό εβδομαδιαίο
    // πρόγραμμα με δηλωμένα ρεπό· η Κυριακή τους είναι δομική εργάσιμη,
    // άρα δεν μπαίνει στο όριο 2 Κυριακών/μήνα (όπως και πριν με το
    // weekly_pattern — διατήρηση της υπάρχουσας συμπεριφοράς)
    !!rule(agent, 'weekly_schedule');
}

function worked(plan, d) {
  return plan.days[d] && plan.days[d].type === 'work';
}

// Η ΑΔΕΙΑ/ΑΣΘΕΝΕΙΑ μετράει ως ΕΡΓΑΣΙΜΗ μέρα για το Κ10 (13/07/2026):
// συνεχίζει τη σειρά συνεχόμενων ημερών — μετά από 5 μέρες άδειας
// χρειάζεται ΡΕΠΟ, όχι βάρδια. Μόνο το ρεπό κόβει τη σειρά.
function countsAsWork(plan, d) {
  const e = plan.days[d];
  if (!e) return false;
  if (e.type === 'work') return true;
  return e.reason === 'leave' || e.reason === 'sick';
}

function assignedCount(plan) {
  return plan.days.filter((x) => x && x.type === 'work').length;
}

function workTarget(plan) {
  // Καλοκαιρινά weekly_pattern (Οικονομου): στόχος = οι μέρες του μοτίβου
  // (ο Πετρος 7/7 ΧΩΡΙΣ ρεπό — απόφαση 11/07/2026)
  const wp = rule(plan.agent, 'weekly_pattern');
  if (wp) return Math.max(0, Object.keys(wp.days).length - plan.leaveDays);
  // Κ2: 5 εργάσιμες — μειωμένες κατά τις μέρες άδειας/ασθένειας
  return Math.max(0, 5 - plan.leaveDays);
}

// ---------- Έλεγχοι Κ8 / Κ10 ----------
// Απόλυτα λεπτά έναρξης/λήξης της καταχώρησης μιας μέρας
function entryAbs(w, plan, d) {
  const e = plan.days[d];
  if (!e || e.type !== 'work') return null;
  return shiftAbs(w.dates[d], e.start, e.end);
}

// Κ8: αρκετή ανάπαυση πριν και μετά αν μπει βάρδια start-end τη μέρα d
function k8ok(w, plan, d, start, end) {
  const rest = restMinFor(plan.agent);
  const { startAbs, endAbs } = shiftAbs(w.dates[d], start, end);
  const st = agentState(w, plan.agent.id);

  // Προηγούμενη λήξη: κοίτα πίσω μέσα στην εβδομάδα, αλλιώς την κατάσταση
  let prevEnd = -Infinity;
  for (let i = d - 1; i >= 0; i--) {
    const abs = entryAbs(w, plan, i);
    if (abs) { prevEnd = abs.endAbs; break; }
  }
  if (prevEnd === -Infinity) prevEnd = st.lastEndAbs;
  if (startAbs - prevEnd < rest && prevEnd !== -Infinity) return false;

  // Επόμενη έναρξη: ήδη τοποθετημένες μελλοντικές βάρδιες της εβδομάδας
  for (let i = d + 1; i < 7; i++) {
    const abs = entryAbs(w, plan, i);
    if (abs) {
      if (abs.startAbs - endAbs < rest) return false;
      return true;
    }
  }
  // Καμία επόμενη μέσα στην εβδομάδα: αν η ΕΠΟΜΕΝΗ εβδομάδα είναι εισηγμένη
  // (γνωστό πρόγραμμα), έλεγξε την πρώτη βάρδιά του εκεί (Κ8 σύνορο εμπρός)
  if (w.nextFirstStart) {
    const nfs = w.nextFirstStart.get(plan.agent.id);
    if (nfs != null && nfs - endAbs < rest) return false;
  }
  // (14/11/2026) Σταθερή βάρδια ΔΕΥΤΕΡΑΣ από weekly_schedule: είναι γνωστή εκ
  // των προτέρων για κάθε εβδομάδα, άρα το Κ8 ελέγχεται ΚΑΙ προς τα εμπρός.
  // Χωρίς αυτό, μια Κυριακή έως 24:00 θα αχρήστευε τη σταθερή Δευτέρα 10:00
  // της επόμενης εβδομάδας (10 ώρες ανάπαυση) — ο έλεγχος τρέχει μόνο όταν
  // δεν υπάρχει άλλη βάρδια μετά το d μέσα στην εβδομάδα (βλ. return πιο πάνω).
  const wsNext = rule(plan.agent, 'weekly_schedule');
  const monShift = wsNext && wsNext.shifts ? wsNext.shifts['1'] : null;
  if (monShift) {
    const nextMonStartAbs = (dayNum(w.dates[6]) + 1) * 1440 + toMin(monShift[0]);
    if (nextMonStartAbs > endAbs && nextMonStartAbs - endAbs < rest) return false;
  }
  return true;
}

// Κ10: αν δουλέψει τη μέρα d, η συνεχόμενη σειρά (με σύνορα εβδομάδων) ≤ 5
function k10ok(w, plan, d) {
  // Εξαίρεση 6ημέρου (Οικονομου — απόφαση 11/07/2026)
  if (rule(plan.agent, 'no_streak_limit')) return true;
  const st = agentState(w, plan.agent.id);
  // Πίσω — η άδεια/ασθένεια ΣΥΝΕΧΙΖΕΙ τη σειρά (μόνο το ρεπό την κόβει)
  let back = 0;
  for (let i = d - 1; i >= 0; i--) {
    if (countsAsWork(plan, i)) back++;
    else break;
  }
  // Αν η σειρά φτάνει στη Δευτέρα, μετράει και το streak της προηγούμενης εβδομάδας
  if (back === d) back += st.streak;
  // Μπροστά — αν η σειρά φτάνει ως την Κυριακή, μετράει και η άδεια που
  // ξεκινά την επόμενη Δευτέρα (η άδεια είναι εργάσιμη — 13/07/2026)
  let fwd = 0;
  let i = d + 1;
  for (; i < 7; i++) {
    if (countsAsWork(plan, i)) fwd++;
    else break;
  }
  if (i === 7) fwd += leadingLeaveNextWeek(w, plan.agent.id);
  return back + 1 + fwd <= MAX_STREAK;
}

// Πόσες συνεχόμενες «εργάσιμες» μέρες ξεκινούν την ΕΠΟΜΕΝΗ Δευτέρα —
// άδεια/ασθένεια (μετράνε ως εργάσιμες, 13/07/2026) και, όταν η επόμενη
// εβδομάδα είναι ΕΙΣΗΓΜΕΝΗ από Excel (γνωστό πρόγραμμα), και οι βάρδιές της.
// Έτσι το 6ήμερο ελέγχεται ΚΑΙ προς τα εμπρός στο σύνορο.
function leadingLeaveNextWeek(w, agentId) {
  // Η επόμενη εβδομάδα είναι γνωστή (εισηγμένη): προϋπολογισμένο στο generatePeriod
  if (w.nextLead) return w.nextLead.get(agentId) || 0;
  let n = 0;
  for (let j = 7; j < 14; j++) {
    const t = w.ctx.timeOff.get(`${agentId}|${addDays(w.weekStart, j)}`);
    if (t === 'leave' || t === 'sick') n++;
    else break;
  }
  return n;
}

// Κ10 για την επιλογή ρεπό: με δεδομένα offs (σύνολο indexes) και υπόθεση
// εργασίας σε όλες τις άλλες μέρες, η μέγιστη σειρά ≤ 5 — μαζί με τυχόν
// άδεια που ξεκινά αμέσως μετά την Κυριακή (trailingLeave).
function offsKeepStreakOk(offs, initialStreak, trailingLeave = 0) {
  let run = initialStreak;
  for (let d = 0; d < 7; d++) {
    if (offs.has(d)) {
      run = 0;
    } else {
      run++;
      if (run > MAX_STREAK) return false;
    }
  }
  return run + trailingLeave <= MAX_STREAK;
}

// ---------- Έλεγχος κανόνων agent για συγκεκριμένη βάρδια ----------
// Ανεξάρτητο από την εβδομάδα — χρησιμοποιείται και από τον validator
// των χειροκίνητων αλλαγών (ΒΗΜΑ 5).
// opts: { override1903: bool (Κ9 υπερισχύει ατομικών ωραρίων), telework: bool }
function shiftAllowedByRules(agent, d, start, end, opts = {}) {
  const dow = d + 1; // 1=Δευτέρα ... 7=Κυριακή
  const isWknd = dow >= 6;
  const s = toMin(start);
  const e = toMin(end) <= s ? toMin(end) + 1440 : toMin(end);

  // 06:00-14:00 με περιορισμό ημερών (Γεωργιου Δευ/Παρ, Ρενα Τρι/Παρ):
  // στις μέρες του κανόνα και τα ΣΚ («μόνο αν βγαίνει») επιτρέπεται και
  // υπερισχύει των λοιπών ελέγχων ωραρίου· τις άλλες μέρες απαγορεύεται.
  // `weekend: false` (Γεωργιου Βαγγελης — 14/11/2026): ΑΠΑΓΟΡΕΥΕΤΑΙ εντελώς
  // το 06:00-14:00 Σάββατο/Κυριακή (hard). Χωρίς το flag η συμπεριφορά μένει
  // η παλιά — ΣΚ επιτρεπτό «αν βγαίνει» (Ρενα, Αντωνιου).
  const std = rule(agent, 'six_two_days');
  if (std && start === '06:00' && end === '14:00') {
    if (isWknd) return std.weekend !== false;
    return std.days.includes(dow);
  }

  // Σταθερό εβδομαδιαίο πρόγραμμα ΜΕΡΙΚΗΣ κάλυψης (14/11/2026):
  //   shifts: { dow: ['HH:MM','HH:MM'] }  → ΜΟΝΟ αυτό το ωράριο τη μέρα αυτή
  //   off:    [dow, ...]                  → υποχρεωτικό ρεπό (καμία βάρδια)
  // Οι μέρες που ΔΕΝ αναφέρονται μένουν ΕΛΕΥΘΕΡΕΣ: ισχύουν κανονικά οι
  // υπόλοιποι κανόνες. Διαφέρει από το weekly_pattern, που κλειδώνει ΟΛΗ
  // την εβδομάδα (ό,τι δεν είναι στο μοτίβο γίνεται ρεπό).
  const ws = rule(agent, 'weekly_schedule');
  if (ws) {
    if ((ws.off || []).includes(dow)) return false;
    const sh = (ws.shifts || {})[String(dow)];
    if (sh) return start === sh[0] && end === sh[1];
  }

  // Καλοκαιρινό weekly_pattern: στις μέρες του μοτίβου ΜΟΝΟ το ωράριο του
  // μοτίβου (υπερισχύει άλλων κανόνων ωραρίου)· τις υπόλοιπες μέρες ο
  // generator δίνει ρεπό — χειροκίνητη αλλαγή επιτρέπεται («ιδανικά» ρεπό).
  const wp = rule(agent, 'weekly_pattern');
  if (wp && (!wp.from || !opts.date || opts.date >= wp.from)) {
    const sh = wp.days[String(dow)];
    if (sh) return start === sh[0] && end === sh[1];
  }

  // Σταθερό ωράριο ΧΩΡΙΣ σταθερές μέρες (π.χ. Χιωτη 16:00-24:00):
  // δουλεύει ΜΟΝΟ το ωράριό της, όποια μέρα κι αν μπει (Κ5 — 15/07/2026)
  if (agent.fixedStart && !agent.fixedDays && !opts.override1903) {
    return start === agent.fixedStart && end === agent.fixedEnd;
  }

  // Supervisors: ΜΟΝΟ 07:00-15:00 και 16:00-24:00· ο έξτρα/2ος supervisor
  // ΠΑΝΤΑ 08:00-16:00. Κανένα άλλο ωράριο (HARD — 18/07/2026).
  if (agent.departments.includes('supervisor')) {
    return (
      (start === '07:00' && end === '15:00') ||
      (start === '16:00' && end === '24:00') ||
      (start === '08:00' && end === '16:00')
    );
  }

  for (const r of agent.rules) {
    switch (r.type) {
      case 'day_off_or_telework':
        // Τις μέρες του κανόνα: ΜΟΝΟ η τηλεργασία του κανόνα (αλλιώς ρεπό)
        if (r.days.includes(dow)) {
          if (!(start === r.shift[0] && end === r.shift[1])) return false;
          return true; // υπερισχύει των υπόλοιπων ελέγχων ωραρίου (πρωινό 06:00 κ.λπ.)
        }
        break;
      case 'only_morning':
        if (opts.override1903) break; // Κ9
        if (!isMorning(start, end)) return false;
        if (r.starts && !r.starts.includes(start)) return false;
        break;
      case 'only_afternoon':
        if (opts.override1903) break;
        if (!isAfternoon(start)) return false;
        break;
      case 'allowed_shifts':
        // `strict: true` (Ραπτης, Εξαρχου — 05/09/2026): η λίστα είναι
        // ΑΠΟΛΥΤΗ και δεν παρακάμπτεται ούτε από το Κ9 (βραδινή 23:00-07:00).
        if (opts.override1903 && !r.strict) break;
        if (!r.shifts.some(([rs, re]) => rs === start && re === end)) return false;
        break;
      case 'split_shift':
        // Μόνο το σπαστό τις μέρες του· τις άλλες μέρες ρεπό
        if (!r.days.includes(dow)) return false;
        if (!(start === r.parts[0][0] && end === r.parts[1][1])) return false;
        break;
      case 'weekdays_only':
        if (isWknd) return false;
        break;
      case 'morning_start_after':
        if (opts.override1903) break;
        if (isMorning(start, end) && s < toMin(r.time)) return false;
        break;
      case 'start_after':
        if (opts.override1903) break;
        if (s < toMin(r.time)) return false;
        break;
      case 'start_after_days':
        // Νωρίτερη επιτρεπτή ώρα ΕΝΑΡΞΗΣ ανά ημέρα (Οικονομου Αλ. —
        // Παρ από 15:00, Σαβ/Κυρ από 12:00, 14/11/2026). ΔΕΝ είναι
        // υποχρεωτική ώρα έναρξης: κάθε υπάρχουσα βάρδια που ξεκινά τότε
        // ή αργότερα επιτρέπεται. Μέρες που δεν αναφέρονται: ανεπηρέαστες.
        if (opts.override1903) break;
        {
          const lim = (r.days || {})[String(dow)];
          if (lim && s < toMin(lim)) return false;
        }
        break;
      case 'end_by':
        if (opts.override1903) break;
        if (e > toMin(r.time) + (toMin(r.time) <= s ? 1440 : 0)) return false;
        break;
      case 'afternoon_office_shift':
        // Απογευματινή από γραφείο μόνο με το συγκεκριμένο ωράριο
        if (opts.override1903) break;
        if (isAfternoon(start) && !opts.telework && !(start === r.shift[0] && end === r.shift[1])) return false;
        break;
      default:
        break; // soft κανόνες — δεν φιλτράρουν, μπαίνουν στο scoring
    }
  }

  // Νυχτερινές μόνο με can_night (Κ7) — η βραδινή Κ9 εξαιρείται.
  // (14/11/2026) Από τότε που η Κ9 έγινε 23:00-07:00, περνά τον έλεγχο
  // isNight(): χωρίς την εξαίρεση opts.override1903 θα έπεφτε στο Κ7 και
  // θα άλλαζαν τα άτομα της βάρδιας — ο ρητός όρος ήταν να μείνουν ΤΑ ΙΔΙΑ.
  if (isNight(start, end) && !agent.canNight && !opts.override1903) return false;

  return true;
}

// Μπορεί ο agent να δουλέψει ΚΑΘΟΛΟΥ τη μέρα d με την ΤΡΕΧΟΥΣΑ εικόνα του
// πλάνου; (κανόνες + Κ8 γειτονικών βαρδιών/συνόρου + Κ10 με άδειες).
// Χρησιμοποιείται για να πέφτουν τα ρεπό σε «νεκρές» μέρες και για τη
// σωστή προτεραιότητα στις λιγοστές θέσεις ΣΚ (HARD 2 ρεπό — 15/07/2026).
const PROBE_SHIFTS = [['08:00', '16:00'], ['09:00', '17:00'], ['07:30', '15:30'], ['10:00', '18:00'], ['16:00', '24:00'], ['15:30', '23:30'], ['14:00', '22:00'], ['06:00', '14:00']];
function agentDayWorkable(w, a, d) {
  const plan = w.plans.get(a.id);
  for (const [s, e] of PROBE_SHIFTS) {
    if (shiftAllowedByRules(a, d, s, e, { date: w.dates[d] }) &&
        k8ok(w, plan, d, s, e) &&
        k10ok(w, plan, d)) {
      return true;
    }
  }
  return false;
}

// Θα «σκοτώσει» η τοποθέτηση (s,e) στη μέρα d κάποια ΓΕΙΤΟΝΙΚΗ κενή
// καθημερινή του agent; Π.χ. βραδινή Κ9 Τετάρτη + πρωινό Παρασκευής
// αφήνουν την Πέμπτη χωρίς κανένα νόμιμο ωράριο (Κ8 από τις δύο μεριές) →
// η μέρα χαραμίζεται σε αναγκαστικό 3ο ρεπό (HARD 2 ρεπό — 15/07/2026)
function killsAdjacentDay(w, plan, d, s, e) {
  for (const i of [d - 1, d + 1]) {
    if (i < 0 || i > 4) continue; // τα ΣΚ δεν γεμίζουν με fillers έτσι κι αλλιώς
    if (plan.days[i]) continue;
    if (!agentDayWorkable(w, plan.agent, i)) continue; // ήδη νεκρή — αδιάφορο
    plan.days[d] = { type: 'work', start: s, end: e, location: 'office' };
    const stillOk = agentDayWorkable(w, plan.agent, i);
    plan.days[d] = null;
    if (!stillOk) return true;
  }
  return false;
}

// Πλήρης έλεγχος τοποθέτησης
function canPlace(w, plan, d, start, end, opts = {}) {
  if (plan.days[d]) return false; // Κ2: 1 βάρδια/μέρα, όχι πάνω σε ρεπό/άδεια
  if (!opts.ignoreTarget && assignedCount(plan) >= workTarget(plan)) return false; // Κ2: 5 εργάσιμες

  // Λίστα 06:00-14:00: τη βάρδια την παίρνουν ΜΟΝΟ οι εγκεκριμένοι (11/07/2026)
  if (start === '06:00' && end === '14:00') {
    const list = w.ctx.eligibility.get('06:00-14:00');
    if (list && list.size > 0 && !list.has(plan.agent.id)) return false;
  }

  // Όριο Κυριακών/μήνα: έως 2 για μη-σταθερούς εκτός supervisors.
  // Ο Γεωργιου (sunday_worker) ΔΟΥΛΕΥΕΙ Κυριακές χωρίς όριο —
  // αντίθετα, περιορίζονται τα ΡΕΠΟ Κυριακής του (το πολύ 1/μήνα, βλ. phaseOffs)
  // Εξαίρεση (απόφαση 15/07/2026): το «ακριβώς 2 ρεπό» υπερισχύει του ορίου
  // Κυριακών. Όταν ο agent θα έπαιρνε αλλιώς 3ο ρεπό (opts.allowSundayOver
  // από το win-win πέρασμα), επιτρέπεται 3η Κυριακή για να πιάσει 5 μέρες.
  if (d === 6 && !opts.allowSundayOver && !sundayExempt(plan.agent) && !rule(plan.agent, 'sunday_worker')) {
    const st = agentState(w, plan.agent.id);
    const used = (st.sundays && st.sundays[w.dates[6].slice(0, 7)]) || 0;
    if (used >= 2) return false;
  }

  if (!shiftAllowedByRules(plan.agent, d, start, end, { ...opts, date: w.dates[d] })) return false;
  if (!k8ok(w, plan, d, start, end)) return false;
  if (!k10ok(w, plan, d)) return false;
  return true;
}

// Τοποθέτηση βάρδιας
function place(w, plan, d, obj) {
  plan.days[d] = { type: 'work', ...obj };
  if (obj.location === 'home') plan.teleworkDays++;
}

function markOff(w, plan, d, reason) {
  plan.days[d] = { type: 'off', reason };
}

// ---------- Χρώμα πρότασης για fillers ----------
function fillerColor(ctx, agent, d, start, end) {
  const dow = d + 1;
  const roles = ctx.roles;
  const get = (n) => (roles.get(n) ? { roleName: n, color: roles.get(n).color, roleId: roles.get(n).id } : { roleName: null, color: null, roleId: null });

  if (agent.departments.includes('supervisor')) return get('Supervisor');
  // Το ΖΕΦΥΡΟΣ δεν λειτουργεί Σαββατοκύριακα (12/07/2026) — πράσινο ΜΟΝΟ Δευ-Παρ
  if (rule(agent, 'zefyros_weekdays') && dow <= 5) return get('Ζέφυρος');
  if (agent.skills.has('ΖΕΦΥΡΟΣ') && !agent.skills.has('ATLAS') && dow <= 5) return get('Ζέφυρος');
  if (agent.departments.includes('verification')) return get('Verification');
  if (agent.skills.has('ΑΙΓΑΙΟΥ') && start === '06:00') return get('Αιγαίου');
  if (agent.skills.has('ATLAS')) return get('Atlas');
  return get('Υπόλοιπα call');
}

// ==================== ΦΑΣΕΙΣ ΕΒΔΟΜΑΔΑΣ ====================

// Φάση 1: άδειες/αιτήματα ρεπό (Κ6) + σταθερά ρεπό + σταθερά ωράρια (Κ5)
function phaseLock(w) {
  const { ctx } = w;
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);

    // Οφειλόμενη ανάπαυση από νυχτερινές στο ΤΕΛΟΣ της προηγούμενης εβδομάδας
    // (π.χ. βράδυ Κυριακή → ρεπό Δευτέρα· 2 βράδια Σαβ+Κυρ → ρεπό Δευ+Τρι)
    const st0 = agentState(w, a.id);
    for (let i = 0; i < (st0.pendingNightRest || 0) && i < 7; i++) {
      if (!plan.days[i]) {
        markOff(w, plan, i, 'night_rest');
        plan.offNeeded = Math.max(0, plan.offNeeded - 1);
      }
    }

    for (let d = 0; d < 7; d++) {
      const t = ctx.timeOff.get(`${a.id}|${w.dates[d]}`);
      if (t === 'leave' || t === 'sick') {
        markOff(w, plan, d, t);
        plan.leaveDays++;
      } else if (t === 'repo_request') {
        markOff(w, plan, d, 'repo_request');
        plan.offNeeded--;
      }
    }

    // Σταθερά ρεπό (π.χ. Φραγκου Δευ+Τρι, Οικονομου Αλ. Τετ+Πεμ)
    for (const dow of a.fixedDaysOff) {
      const d = dow - 1;
      if (!plan.days[d]) {
        markOff(w, plan, d, 'fixed_off');
        plan.offNeeded--;
      }
    }

    // weekdays_only / split_shift: τα ΣΚ είναι πάντα ρεπό
    if (rule(a, 'weekdays_only') || rule(a, 'split_shift') || (a.fixedDays && !a.fixedDays.includes(6) && !a.fixedDays.includes(7))) {
      for (const d of [5, 6]) {
        if (!plan.days[d]) {
          markOff(w, plan, d, 'fixed_off');
          plan.offNeeded--;
        }
      }
    }
    plan.offNeeded = Math.max(0, plan.offNeeded);

    // Σταθερά ωράρια σε σταθερές μέρες (Κ5) — με σεβασμό στο Κ10: αν η
    // τοποθέτηση θα έφτιαχνε 6ήμερο (π.χ. μαζί με επερχόμενη ΑΔΕΙΑ που
    // μετράει ως εργάσιμη), παραλείπεται με σημείωση
    if (a.fixedStart && a.fixedDays) {
      for (const dow of a.fixedDays) {
        const d = dow - 1;
        if (plan.days[d]) continue; // άδεια/ρεπό υπερισχύει (Κ6)
        if (assignedCount(plan) >= workTarget(plan)) break;
        if (!k10ok(w, plan, d)) {
          w.report.soft.push(`${a.name}: σταθερή βάρδια ${w.dates[d]} παραλείφθηκε — θα έσπαγε το 6ήμερο (Κ10, η άδεια μετρά ως εργάσιμη).`);
          continue;
        }
        const c = fillerColor(ctx, a, d, a.fixedStart, a.fixedEnd);
        place(w, plan, d, {
          start: a.fixedStart, end: a.fixedEnd,
          label: a.workLocation === 'home' ? 'ΤΗΛΕΡΓΑΣΙΑ' : null,
          location: a.workLocation, fixed: true, ...c
        });
      }
    }

    // Σπαστό ωράριο Νικολαου: 09:00-24:00 με parts (μία «βάρδια» τη μέρα)
    // — με σεβασμό στο Κ10 και στο σύνορο με εισηγμένο πρόγραμμα
    const sp = rule(a, 'split_shift');
    if (sp) {
      for (const dow of sp.days) {
        const d = dow - 1;
        if (plan.days[d]) continue;
        if (assignedCount(plan) >= workTarget(plan)) break;
        if (!k10ok(w, plan, d)) {
          w.report.soft.push(`${a.name}: σπαστό ${w.dates[d]} παραλείφθηκε — θα έσπαγε το 6ήμερο (Κ10).`);
          continue;
        }
        const c = fillerColor(ctx, a, d, sp.parts[0][0], sp.parts[1][1]);
        place(w, plan, d, {
          start: sp.parts[0][0], end: sp.parts[1][1],
          parts: sp.parts, label: 'ΣΠΑΣΤΟ', location: a.workLocation, fixed: true, ...c
        });
      }
    }

    // Βάρδια ΣΚ Φραγκου (16:00-24:00) — Κ5, με σεβασμό στο Κ10 (η άδεια
    // της επόμενης εβδομάδας μετράει ως εργάσιμη)
    if (a.weekendShift) {
      const [ws, we] = a.weekendShift.split('-');
      for (const d of [5, 6]) {
        if (plan.days[d]) continue;
        if (assignedCount(plan) >= workTarget(plan)) break;
        if (!k10ok(w, plan, d)) {
          w.report.soft.push(`${a.name}: βάρδια ΣΚ ${w.dates[d]} παραλείφθηκε — θα έσπαγε το 6ήμερο (Κ10, η άδεια μετρά ως εργάσιμη).`);
          continue;
        }
        const c = fillerColor(ctx, a, d, ws, we);
        place(w, plan, d, { start: ws, end: we, location: a.workLocation, fixed: true, ...c });
      }
    }

    // Σταθερό εβδομαδιαίο πρόγραμμα ΜΕΡΙΚΗΣ κάλυψης (Οικονομου —
    // 14/11/2026): κλειδώνονται ΜΟΝΟ οι δηλωμένες μέρες (σταθερά ωράρια +
    // υποχρεωτικά ρεπό). Οι υπόλοιπες μένουν ΕΛΕΥΘΕΡΕΣ για τις κανονικές
    // φάσεις — σε αντίθεση με το weekly_pattern που κλειδώνει όλη την εβδομάδα.
    const wsch = rule(a, 'weekly_schedule');
    if (wsch) {
      for (const dow of wsch.off || []) {
        const d = dow - 1;
        if (plan.days[d]) continue; // άδεια/αίτημα ρεπό υπερισχύει (Κ6)
        markOff(w, plan, d, 'fixed_off');
        plan.offNeeded--;
      }
      plan.offNeeded = Math.max(0, plan.offNeeded);
      for (const [dowStr, sh] of Object.entries(wsch.shifts || {})) {
        const d = Number(dowStr) - 1;
        if (plan.days[d]) continue; // άδεια/ρεπό υπερισχύει (Κ6)
        if (assignedCount(plan) >= workTarget(plan)) break;
        if (!k10ok(w, plan, d)) {
          w.report.soft.push(`${a.name}: σταθερή βάρδια ${w.dates[d]} παραλείφθηκε — θα έσπαγε το 6ήμερο (Κ10).`);
          continue;
        }
        // Κ8 (11ωρο): ΔΕΝ παρακάμπτεται ούτε για σταθερό ωράριο — είναι
        // νομοθετική απαίτηση. Τυπική σύγκρουση: βάρδια έως 24:00 την Κυριακή
        // + σταθερή Δευτέρα 10:00 = 10 ώρες. Αντί να βγει παράνομο πρόγραμμα,
        // η βάρδια παραλείπεται και ΑΝΑΦΕΡΕΤΑΙ για χειροκίνητη απόφαση.
        if (!k8ok(w, plan, d, sh[0], sh[1])) {
          w.report.soft.push(`${a.name}: σταθερή βάρδια ${w.dates[d]} ${sh[0]}-${sh[1]} παραλείφθηκε — λιγότερες από 11 ώρες ανάπαυση από την προηγούμενη βάρδια (Κ8). ΣΥΓΚΡΟΥΣΗ σταθερού ωραρίου με το 11ωρο — χρειάζεται απόφαση.`);
          continue;
        }
        const c = fillerColor(ctx, a, d, sh[0], sh[1]);
        place(w, plan, d, {
          start: sh[0], end: sh[1],
          label: a.workLocation === 'home' ? 'ΤΗΛΕΡΓΑΣΙΑ' : null,
          location: a.workLocation, fixed: true, ...c
        });
      }
    }

    // Καλοκαιρινό weekly_pattern (Οικονομου — 11/07/2026): τοποθέτηση
    // του μοτίβου στις μέρες του· οι υπόλοιπες μέρες γίνονται ρεπό
    // (ο Πετρος δεν έχει καμία — δουλεύει 7/7)
    const wp = rule(a, 'weekly_pattern');
    if (wp) {
      for (let d = 0; d < 7; d++) {
        if (plan.days[d]) continue; // άδεια/ρεπό υπερισχύει (Κ6)
        if (wp.from && w.dates[d] < wp.from) continue;
        const sh = wp.days[String(d + 1)];
        if (sh) {
          const c = fillerColor(ctx, a, d, sh[0], sh[1]);
          place(w, plan, d, { start: sh[0], end: sh[1], location: a.workLocation, fixed: true, ...c });
        } else {
          markOff(w, plan, d, 'fixed_off');
        }
      }
      plan.offNeeded = 0;
    }
  }
}

// Φάση 2: Σ1 — Παρασκευή 06:00-14:00 Αιγαίου Γεωργιου + Γεωργιου Ρενα
function phaseS1(w) {
  const { ctx } = w;
  const pair = ctx.agents.filter((a) => rule(a, 'day_off_or_telework'));
  if (pair.length === 0) return;
  const FRI = 4;
  const aegean = ctx.roles.get('Αιγαίου') || { id: null, color: null };

  const placeable = pair.filter((a) => {
    const plan = w.plans.get(a.id);
    const r = rule(a, 'day_off_or_telework');
    return r.days.includes(5) && canPlace(w, plan, FRI, r.shift[0], r.shift[1], { telework: true });
  });

  const doPlace = (a) => {
    const r = rule(a, 'day_off_or_telework');
    place(w, w.plans.get(a.id), FRI, {
      start: r.shift[0], end: r.shift[1],
      skill: 'ΑΙΓΑΙΟΥ', label: 'ΤΗΛΕΡΓΑΣΙΑ', location: 'home',
      roleName: 'Αιγαίου', roleId: aegean.id, color: aegean.color, s1: true
    });
  };

  if (placeable.length === 2) {
    placeable.forEach(doPlace);
  } else if (placeable.length === 1) {
    doPlace(placeable[0]);
    w.report.soft.push(`Σ1: μόνο ο/η ${placeable[0].name} μπόρεσε να μπει Παρασκευή 06:00-14:00 Αιγαίου — ο άλλος παίρνει ρεπό.`);
  } else if (pair.length === 2) {
    w.report.soft.push('Σ1: δεν βγήκε Παρασκευή 06:00-14:00 Αιγαίου για Γεωργιου/Γεωργιου Ρενα.');
  }

  // Δευτέρες: προτιμάται ο Γεωργιου στο 06:00-14:00, όχι όμως κάθε
  // Δευτέρα (13/07/2026) — τηλεργασία σε ΕΝΑΛΛΑΞ εβδομάδες
  for (const a of pair) {
    const r = rule(a, 'day_off_or_telework');
    if (!r.days.includes(1) || r.days.includes(2)) continue; // μόνο όποιος έχει μέρα κανόνα τη Δευτέρα
    const evenWeek = Math.floor(dayNum(w.weekStart) / 7) % 2 === 0;
    const plan = w.plans.get(a.id);
    if (evenWeek && canPlace(w, plan, 0, r.shift[0], r.shift[1], { telework: true })) {
      const pir = ctx.roles.get('Αιγαίου') || { id: null, color: null };
      place(w, plan, 0, {
        start: r.shift[0], end: r.shift[1],
        skill: 'ΑΙΓΑΙΟΥ', label: 'ΤΗΛΕΡΓΑΣΙΑ', location: 'home',
        roleName: 'Αιγαίου', roleId: pir.id, color: pir.color
      });
    }
  }

  // Οι υπόλοιπες «μέρες κανόνα» (Δευ/Τρι/Παρ) που δεν έγιναν τηλεργασία → ρεπό
  for (const a of pair) {
    const plan = w.plans.get(a.id);
    const r = rule(a, 'day_off_or_telework');
    for (const dow of r.days) {
      const d = dow - 1;
      if (!plan.days[d]) {
        markOff(w, plan, d, 'rule');
        plan.offNeeded--;
      }
    }
    plan.offNeeded = Math.max(0, plan.offNeeded);
  }
}

// Φάση 3: Νυχτερινές 23:00/23:30 (Κ4, Κ7) — κανόνες 14/07/2026:
//   * κάθε agent έως 2 βράδια/εβδομάδα
//   * μετά το βράδυ ΥΠΟΧΡΕΩΤΙΚΑ ρεπό (2 σερί βράδια → 2 σερί ρεπό)
//   * η οφειλόμενη ανάπαυση που «ξεφεύγει» από την εβδομάδα μεταφέρεται
//     στην επόμενη (pendingNightRest)
function phaseNights(w, nightReqByDay) {
  const { ctx } = w;
  const pool = ctx.agents.filter((a) => a.canNight && a.skills.has('ATLAS'));
  const euro = ctx.roles.get('Atlas') || { id: null, color: null };
  const nightsIn = (plan) => plan.days.filter((e) => e && e.type === 'work' && e.night).length;

  // Ωράριο νυχτερινής για τον συγκεκριμένο agent: κανονικά 23:30-07:30
  // (οριστικοποιείται στη φάση 8 σε 23:00-07:00 αν δεν ανοίγει κανείς το
  // πρωί). Για agents με ΑΠΟΛΥΤΗ λίστα ωραρίων που περιέχει μόνο την
  // 23:00-07:00 (Ραπτης, Εξαρχου — 05/09/2026) μπαίνει αυτή ακριβώς,
  // ώστε να μη χάνουν τη δυνατότητα νυχτερινής ούτε να παίρνουν ωράριο
  // εκτός της λίστας τους.
  const nightShiftFor = (plan, d) => {
    if (canPlace(w, plan, d, '23:30', '07:30')) return ['23:30', '07:30'];
    if (canPlace(w, plan, d, '23:00', '07:00')) return ['23:00', '07:00'];
    return null;
  };

  // Πόσες ΗΜΕΡΕΣ ΕΡΓΑΣΙΑΣ μπορεί ακόμη να πιάσει ο agent την εβδομάδα αν
  // πάρει νυχτερινή τη μέρα d (28/09/2026). Μετράει: τη νυχτερινή, όσες
  // βάρδιες έχει ήδη, και τις κενές μέρες που είναι πραγματικά εργάσιμες —
  // ΑΦΑΙΡΩΝΤΑΣ τις υποχρεωτικές αναπαύσεις που γεννά η ίδια η νυχτερινή
  // (1 βράδυ → 1 ρεπό, ζευγάρι → 2 ρεπό).
  //
  // Χρειάζεται γιατί το ΖΕΥΓΑΡΙ βραδιών «καίει» 4 ημέρες (2 βράδια + 2
  // αναπαύσεις): αν ο agent έχει και σταθερό ρεπό ή άδεια την ίδια εβδομάδα,
  // δεν του μένουν αρκετές μέρες για τις 5 εργάσιμες και καταλήγει με 3ο
  // ρεπό — χωρίς να φταίει ο έλεγχος του 6ημέρου.
  function maxWorkDaysWithNight(a, d) {
    const plan = w.plans.get(a.id);
    const closingPair = d > 0 && plan.days[d - 1] && plan.days[d - 1].night;
    const restLen = closingPair ? 2 : 1;
    const rest = new Set();
    for (let i = 1; i <= restLen; i++) if (d + i < 7) rest.add(d + i);

    let n = 0;
    for (let i = 0; i < 7; i++) {
      if (i === d) { n++; continue; }        // η ίδια η νυχτερινή
      if (rest.has(i)) continue;             // υποχρεωτική ανάπαυση μετά
      const e = plan.days[i];
      if (e) { if (e.type === 'work') n++; continue; } // ήδη τοποθετημένη
      if (agentDayWorkable(w, a, i)) n++;    // κενή αλλά πραγματικά εργάσιμη
    }
    return n;
  }

  // Ευθυγράμμιση με ΑΙΤΗΜΑΤΑ ΡΕΠΟ (14/07/2026): η υποχρεωτική ανάπαυση μετά
  // τα βράδια πρέπει να ΠΕΦΤΕΙ ΠΑΝΩ στο ζητημένο ρεπό — π.χ. αίτημα Παρασκευή
  // → βράδια Τρίτη+Τετάρτη → ρεπό Πέμπτη+Παρασκευή = σύνολο 2 ρεπό, όχι 3.
  // Αλλιώς, τα βράδια πάνε σε κάποιον χωρίς αίτημα.
  function requestAlignment(a, d) {
    const plan = w.plans.get(a.id);
    const reqDays = [];
    for (let i = 0; i < 7; i++) {
      const e = plan.days[i];
      if (e && e.type === 'off' && e.reason === 'repo_request') reqDays.push(i);
    }
    if (reqDays.length === 0) return 0; // χωρίς αίτημα — ουδέτερο
    const closingPair = d > 0 && plan.days[d - 1] && plan.days[d - 1].night;
    // Πιθανές μέρες ανάπαυσης: ζευγάρι που κλείνει τώρα → d+1,d+2·
    // πρώτο βράδυ → d+1 (μονό) ή d+2,d+3 (αν γίνει ζευγάρι αύριο)
    const restCandidates = closingPair ? [d + 1, d + 2] : [d + 1, d + 2, d + 3];
    return reqDays.some((r) => restCandidates.includes(r)) ? 25 : -30;
  }

  for (let d = 0; d < 7; d++) {
    if (!nightReqByDay[d]) continue;
    const cands = pool
      .filter((a) => {
        const plan = w.plans.get(a.id);
        const n = nightsIn(plan);
        if (n >= 2) return false; // έως 2 βράδια/εβδομάδα
        // Το 2ο βράδυ ΜΟΝΟ ΣΥΝΕΧΟΜΕΝΟ με το 1ο (π.χ. Δευ+Τρι) — 14/07/2026
        const prevNight = d > 0 && plan.days[d - 1] && plan.days[d - 1].night;
        if (n === 1 && !prevNight) return false;
        // Η ανάπαυση μετά το βράδυ πρέπει να χωράει: η επόμενη μέρα (αν είναι
        // μέσα στην εβδομάδα) να μην έχει ήδη βάρδια
        if (d + 1 < 7 && plan.days[d + 1] && plan.days[d + 1].type === 'work') return false;
        return !!nightShiftFor(plan, d);
      })
      .sort((x, y) => {
        // Προτίμησε να «κλείσει» ζευγάρι με τον χθεσινό νυχτερινό — αλλιώς
        // η λίστα εξαντλείται σε σκόρπια μονά και μένουν μέρες ακάλυπτες
        const pairX = d > 0 && w.plans.get(x.id).days[d - 1] && w.plans.get(x.id).days[d - 1].night ? 0 : 1;
        const pairY = d > 0 && w.plans.get(y.id).days[d - 1] && w.plans.get(y.id).days[d - 1].night ? 0 : 1;
        if (pairX !== pairY) return pairX - pairY;
        // Ευθυγράμμιση ανάπαυσης με αιτήματα ρεπό (μεγαλύτερο = καλύτερο)
        const alX = requestAlignment(x, d);
        const alY = requestAlignment(y, d);
        if (alX !== alY) return alY - alX;
        const lrX = rule(x, 'night_last_resort') ? 1 : 0;
        const lrY = rule(y, 'night_last_resort') ? 1 : 0;
        if (lrX !== lrY) return lrX - lrY;
        // Όποιος έχει ήδη «χρεωθεί» τη μισή εβδομάδα σε βράδια/ανάπαυση
        // (π.χ. night_rest που κουβαλήθηκε από την προηγούμενη) πάει τελευταίος
        // — αλλιώς κολλάει σε αέναο κύκλο 2 βράδια + 2 ρεπό = 2 εργάσιμες
        const costX = w.plans.get(x.id).days.filter((e) => e && ((e.type === 'work' && e.night) || (e.type === 'off' && e.reason === 'night_rest'))).length;
        const costY = w.plans.get(y.id).days.filter((e) => e && ((e.type === 'work' && e.night) || (e.type === 'off' && e.reason === 'night_rest'))).length;
        if (costX !== costY) return costX - costY;
        // Ισοβαθμία: προηγείται όποιος ΠΡΟΤΙΜΑ τις βραδινές (ΡΟΥΣΣΟΥ ΟΛΓΑ —
        // 05/09/2026). Κριτήριο ισοβαθμίας, δεν ανατρέπει τα παραπάνω.
        const evX = rule(x, 'prefer_morning_evening') ? 0 : 1;
        const evY = rule(y, 'prefer_morning_evening') ? 0 : 1;
        if (evX !== evY) return evX - evY;
        return agentState(w, x.id).nights - agentState(w, y.id).nights;
      });

    if (cands.length === 0) {
      w.report.uncovered.push({ date: w.dates[d], start: '23:00', end: '07:00', label: NIGHT_LABEL });
      continue;
    }
    // Το 2ο βράδυ (κλείσιμο ζευγαριού) ΔΕΝ πρέπει να στερεί από τον agent τη
    // δυνατότητα να φτάσει τις εργάσιμές του (28/09/2026): 2 βράδια + 2
    // υποχρεωτικές αναπαύσεις = 4 ημέρες, και όποιος έχει και σταθερό ρεπό/
    // άδεια μένει μαθηματικά με 3ο ρεπό. Όταν υπάρχει άλλος υποψήφιος, το
    // βράδυ πάει σε εκείνον· αν ΔΕΝ υπάρχει, προηγείται η κάλυψη και
    // κρατάμε τον αρχικό (η σειρά προτεραιότητας μένει ως έχει).
    const feasible = cands.filter((x) => {
      const p = w.plans.get(x.id);
      if (nightsIn(p) !== 1) return true; // 1ο βράδυ: δεν περιορίζεται
      return maxWorkDaysWithNight(x, d) >= workTarget(p);
    });
    const a = (feasible.length > 0 ? feasible : cands)[0];
    if (feasible.length === 0 && cands.length > 0) {
      const p = w.plans.get(cands[0].id);
      if (nightsIn(p) === 1) {
        w.report.soft.push(
          `Νυχτερινή ${w.dates[d]}: ${cands[0].name} κλείνει ζευγάρι αν και θα μείνει με ${maxWorkDaysWithNight(cands[0], d)}/${workTarget(p)} εργάσιμες — δεν υπήρχε άλλος υποψήφιος.`
        );
      }
    }
    if (rule(a, 'night_last_resort')) {
      w.report.soft.push(`Νυχτερινή ${w.dates[d]}: ${a.name} από ανάγκη (soft αποφυγή).`);
    }
    // Κ4: προσωρινά 23:30-07:30 — οριστικοποιείται σε post-pass βάσει του
    // ποιος πραγματικά ανοίγει το επόμενο πρωί στις 07:00/07:30
    const nsh = nightShiftFor(w.plans.get(a.id), d);
    place(w, w.plans.get(a.id), d, {
      start: nsh[0], end: nsh[1], skill: 'ATLAS', label: 'ΝΥΧΤΕΡΙΝΗ',
      location: 'office', night: true, roleName: 'Atlas', roleId: euro.id, color: euro.color,
      reqLabel: NIGHT_LABEL
    });
    nightReqByDay[d].covered++;
    agentState(w, a.id).nights++;
  }

  // Υποχρεωτική ανάπαυση μετά από κάθε «σειρά» βραδιών: όσα βράδια, τόσα
  // συνεχόμενα ρεπό αμέσως μετά — ό,τι δεν χωράει στην εβδομάδα οφείλεται
  // στην επόμενη (pendingNightRest)
  for (const a of pool) {
    const plan = w.plans.get(a.id);
    plan.pendingNightRest = 0;
    let d = 0;
    while (d < 7) {
      const e = plan.days[d];
      if (e && e.type === 'work' && e.night) {
        let len = 1;
        while (d + len < 7 && plan.days[d + len] && plan.days[d + len].type === 'work' && plan.days[d + len].night) len++;
        let owed = len;
        let i = d + len;
        while (owed > 0 && i < 7) {
          if (!plan.days[i]) {
            markOff(w, plan, i, 'night_rest');
            plan.offNeeded = Math.max(0, plan.offNeeded - 1);
          }
          // Μέρα ήδη ρεπό/άδεια: μετράει ως ανάπαυση
          owed--;
          i++;
        }
        plan.pendingNightRest = owed; // μεταφέρεται στην επόμενη εβδομάδα
        d = i;
      } else {
        d++;
      }
    }
  }
}

// Φάση 4: κατανομή ρεπό (Σ2 συνεχόμενα, Σ3 εξισορρόπηση ΣΚ, Κ10 στα σύνορα).
// Κρίσιμο: τα ρεπό πρέπει να μοιράζονται ώστε ΚΑΘΕ μέρα (ιδίως τα ΣΚ) να
// μένουν αρκετοί διαθέσιμοι επιλέξιμοι για κάθε απαίτηση κάλυψης.
function phaseOffs(w, reqByDay) {
  const { ctx } = w;

  // Υπάρχει ακόμα ανοιχτό slot βραδινής Κ9 (23:00-07:00) τη μέρα d που
  // μπορεί να πάρει ο agent στο pass B; (τότε ΜΗΝ του κλειδώσεις τη μέρα ως ρεπό)
  const openK9 = (a, d) => {
    if (!reqByDay) return false;
    const list = ctx.eligibility.get(K9_ELIG_KEY);
    if (list && list.size > 0 && !list.has(a.id)) return false;
    for (const rq of reqByDay[d]) {
      if (isK9Req(rq.def) && rq.covered < rq.def.headcount) return true;
    }
    return false;
  };

  const eligibleFor = (agent, r, d) => {
    if (!deptMatch(agent, r.department)) return false;
    if (r.skill && !agent.skills.has(r.skill)) return false;
    // Βάρδιες με λίστα επιλεξιμότητας (06:00-14:00, βραδινή Κ9): μόνο τα
    // μέλη της μετράνε ως διαθέσιμο pool — αλλιώς τα ρεπό «καίνε» τη λίστα.
    // (14/11/2026) Η λίστα Κ9 ισχύει ΜΟΝΟ για την απαίτηση Κ9: η «Νυχτερινή
    // Atlas» έχει πλέον το ίδιο ωράριο 23:00-07:00 και ΔΕΝ περιορίζεται
    // από τη λίστα — το pool της ορίζεται από can_night + skill ATLAS (Κ7).
    if (!(r.start === K9_START && r.end === K9_END) || isK9Req(r)) {
      const list = ctx.eligibility.get(`${r.start}-${r.end}`);
      if (list && list.size > 0 && !list.has(agent.id)) return false;
    }
    // Οι ατομικοί κανόνες ωραρίου μετράνε: π.χ. οι «μόνο πρωί» ΔΕΝ είναι
    // διαθέσιμο pool για το απογευματινό Αιγαίου (13/07/2026).
    // Στην απαίτηση Κ9 ισχύει η παράκαμψη της λίστας (override1903) — όπως
    // και στην πραγματική τοποθέτηση της φάσης 6, αλλιώς το pool θα έβγαινε
    // λάθος (π.χ. «μόνο απόγευμα» ή χωρίς can_night θα φαίνονταν ανεπίτρεπτοι).
    if (!shiftAllowedByRules(agent, d, r.start, r.end, { date: w.dates[d], override1903: isK9Req(r) })) return false;
    return true;
  };

  // Πόσο θα «πονέσει» η μέρα d αν πάρει ρεπό ο agent: αν οι εναπομείναντες
  // διαθέσιμοι επιλέξιμοι πέσουν κοντά/κάτω από το headcount μιας απαίτησης,
  // τεράστια ποινή. Υπολογίζεται ΔΥΝΑΜΙΚΑ πάνω στο τρέχον πλάνο.
  function dayRisk(agent, d) {
    const dow = d + 1;
    const reqs = ctx.requirements[dow >= 6 ? 'weekend' : 'weekday'];
    // Ομαδοποίηση απαιτήσεων με το ΙΔΙΟ pool (τμήμα+skill): η ζήτηση
    // ΑΘΡΟΙΖΕΤΑΙ — π.χ. 2 slots supervisors/μέρα σημαίνει ότι με 2
    // διαθέσιμους supervisors ΚΑΝΕΙΣ τους δεν παίρνει ρεπό (14/07/2026)
    const groups = new Map(); // key → {demand, avail}
    for (const r of reqs) {
      if (!eligibleFor(agent, r, d)) continue;
      const key = `${r.department || ''}|${r.skill || ''}`;
      if (!groups.has(key)) {
        let avail = 0;
        for (const x of ctx.agents) {
          if (!eligibleFor(x, r, d)) continue;
          const e = w.plans.get(x.id).days[d];
          if (!e || e.type === 'work') avail++;
        }
        groups.set(key, { demand: 0, avail });
      }
      groups.get(key).demand += r.headcount;
    }
    let risk = 0;
    for (const g of groups.values()) {
      const after = g.avail - 1;
      if (after < g.demand) risk += 200; // θα μείνει ακάλυπτο σχεδόν σίγουρα
      else if (after < g.demand + 2) risk += 80; // οριακό — απόφυγέ το έντονα
      else risk += 6 / after;
    }
    return risk;
  }

  // Πόσα ρεπό έχουν ήδη δοθεί τη μέρα d (εξισορρόπηση φόρτου ημέρας —
  // ΜΟΝΟ για καθημερινές: με το hard ΣΚ MAX τα ρεπό ΠΡΕΠΕΙ να μαζεύονται ΣΚ)
  function offLoad(d) {
    if (d >= 5) return 0;
    let n = 0;
    for (const a of ctx.agents) {
      const e = w.plans.get(a.id).days[d];
      if (e && e.type === 'off') n++;
    }
    return n;
  }

  const dayWorkable = (a, d) => agentDayWorkable(w, a, d);

  // Λιγότερο ευέλικτοι πρώτοι: λίγες ελεύθερες μέρες, και μετά ΜΕΓΑΛΟ
  // εισερχόμενο streak (το 5άρι σερί ΑΝΑΓΚΑΖΕΙ ρεπό Δευτέρα — πρέπει να
  // το δουν πρώτοι ώστε οι υπόλοιποι να αποφύγουν την ίδια μέρα)
  const order = [...ctx.agents].sort((x, y) => {
    const fx = w.plans.get(x.id).days.filter((e) => !e).length;
    const fy = w.plans.get(y.id).days.filter((e) => !e).length;
    if (fx !== fy) return fx - fy;
    return (agentState(w, y.id).streak || 0) - (agentState(w, x.id).streak || 0);
  });

  for (const a of order) {
    const plan = w.plans.get(a.id);

    // ΣΚ MAX (hard): οι θέσεις ΣΚ μοιράστηκαν ΗΔΗ (phaseRequirements [5,6])
    // και οι fillers δεν αγγίζουν ΣΚ — άρα κάθε κενό Σάββατο/Κυριακή είναι
    // ΑΝΑΠΟΦΕΥΚΤΟ ρεπό. Αν ΚΑΙ ΤΑ ΔΥΟ ΣΚ είναι ελεύθερα (δεν πήρε θέση),
    // γίνονται ΜΑΖΙ το ζευγάρι ρεπό του (Σαβ+Κυρ συνεχόμενα) — αλλιώς θα
    // κατέληγε με ρεπό καθημερινής + έξτρα ΣΚ = 3+ ρεπό (HARD 2 ρεπό).
    // ΟΜΩΣ αν δουλεύει ΤΟ ΕΝΑ ΣΚ (π.χ. Κυριακή), ΜΗΝ κλειδώνεις το ελεύθερο
    // Σάββατο εδώ μεμονωμένα: ο βρόχος παρακάτω θα το ζευγαρώσει με την
    // Παρασκευή (Παρ+Σαβ συνεχόμενα) — τα ρεπό ΜΑΖΙ (προτίμηση 15/07/2026).
    for (const d of [5, 6]) {
      if (plan.offNeeded <= 0) break;
      if (plan.days[d]) continue;
      if (openK9(a, d)) continue; // ίσως πάρει τη βραδινή Κ9 στο pass B
      markOff(w, plan, d, 'repo');
      plan.offNeeded--;
    }

    // Μετά, ΝΤΕΤΕΡΜΙΝΙΣΤΙΚΑ: μέρες που ο agent ΔΕΝ μπορεί να δουλέψει
    // (κανόνες/Κ8 από το σύνορο, π.χ. Δευτέρα πρωί μετά από Κυριακή 24:00
    // για «μόνο πρωί») γίνονται τα ρεπό του — αλλιώς χαραμίζονται και
    // καταλήγει με 3ο ρεπό (HARD 2 ρεπό — 15/07/2026)
    for (let d = 0; d < 7 && plan.offNeeded > 0; d++) {
      if (plan.days[d]) continue;
      if (!dayWorkable(a, d)) {
        markOff(w, plan, d, 'repo');
        plan.offNeeded--;
      }
    }

    while (plan.offNeeded > 0) {
      const st = agentState(w, a.id);
      const free = [];
      for (let d = 0; d < 7; d++) if (!plan.days[d]) free.push(d);
      if (free.length === 0) break;

      // Υποψήφια σύνολα: ζεύγη συνεχόμενων (Σ2) όταν χρειάζονται 2, αλλιώς μονά
      const options = [];
      if (plan.offNeeded >= 2) {
        for (let i = 0; i < free.length - 1; i++) {
          if (free[i + 1] === free[i] + 1) options.push([free[i], free[i] + 1]);
        }
      }
      for (const d of free) options.push([d]);

      let best = null;
      let bestScore = -Infinity;
      for (const opt of options) {
        // Κ10: με αυτά τα ρεπό (και όσα ήδη υπάρχουν) κόβεται κάθε 6άρι;
        const offs = new Set(opt);
        // Η άδεια/ασθένεια ΔΕΝ μπαίνει στα «ρεπό» — μετράει ως εργάσιμη
        // για τη σειρά συνεχόμενων ημερών (13/07/2026)
        for (let d = 0; d < 7; d++) {
          const e = plan.days[d];
          if (e && e.type === 'off' && e.reason !== 'leave' && e.reason !== 'sick') offs.add(d);
        }
        if (opt.some((d) => plan.days[d])) continue;
        if (!rule(a, 'no_streak_limit') && !offsKeepStreakOk(offs, st.streak, leadingLeaveNextWeek(w, a.id))) continue;

        // Γεωργιου (sunday_worker): το πολύ 1 ρεπό Κυριακής τον μήνα (hard)
        if (opt.includes(6) && rule(a, 'sunday_worker')) {
          const mk = w.dates[6].slice(0, 7);
          if (((st.sundaysOff || {})[mk] || 0) >= 1) continue;
        }

        let score = 0;
        // Σ2 ΔΥΝΑΤΑ (15/07/2026): τα ρεπό ΜΑΖΙ για όλους — όχι σπαστά.
        // Το bonus πρέπει να νικά το «οριακό» dayRisk (~80) της ενδιάμεσης
        // μέρας ώστε να προτιμηθεί το ΣΥΝΕΧΟΜΕΝΟ ζευγάρι — αλλά ΟΧΙ το κρίσιμο
        // (200, θα έμενε ακάλυπτο). Έτσι οι εργαζόμενοι ΣΚ παίρνουν Δευ+Τρι
        // μαζί αντί για σπαστά. (προτίμηση συνεχόμενων ρεπό — 15/07/2026)
        if (opt.length === 2) score += rule(a, 'consecutive_off_strong') ? 90 : 55;
        // Μονό ρεπό: προτίμησε να «κολλήσει» δίπλα σε υπάρχον ρεπό/αίτημα
        // (π.χ. αίτημα Τετάρτη → το δεύτερο ρεπό Τρίτη ή Πέμπτη)
        if (opt.length === 1) {
          const d0 = opt[0];
          const adj = [d0 - 1, d0 + 1].some((i) => {
            if (i < 0 || i > 6) return false;
            const e = plan.days[i];
            return e && e.type === 'off';
          });
          if (adj) score += 35;
        }
        // Σ3: όποιος έχει δουλέψει πολλά ΣΚ, να ξεκουράζεται ΣΚ
        const wkndDays = opt.filter((d) => d >= 5).length;
        score += wkndDays * Math.min(st.weekends, 6) * 2;
        // Τα ΣΚ έχουν ΜΟΝΟ τις απαιτήσεις του πίνακα (MAX hard — 14/07/2026):
        // οι θέσεις ΣΚ είναι λίγες, άρα τα παραγόμενα ρεπό πάνε ΣΚ σχεδόν
        // πάντα — αλλιώς μένουν κενές ΣΚ μέρες και σπάει το «ακριβώς 2 ρεπό»
        score += wkndDays * 12;
        // Supervisors: τα ρεπό τους κατά προτίμηση ΣΚ — τις καθημερινές
        // χρειάζονται και οι 2 βάρδιες τους (14/07/2026)
        if (a.departments.includes('supervisor')) score += wkndDays * 10;
        // sunday_worker: απόφυγε γενικά τα ρεπό Κυριακής — δουλεύει Κυριακές
        if (opt.includes(6) && rule(a, 'sunday_worker')) score -= 25;
        for (const d of opt) {
          score -= dayRisk(a, d); // μη «κάψεις» σπάνιο πόρο
          score -= offLoad(d) * 2; // ισοκατανομή ρεπό στις καθημερινές
          // Μέρα που ΔΕΝ μπορεί να δουλέψει (κανόνες/Κ8 συνόρου) = ιδανικό ρεπό
          if (!dayWorkable(a, d)) score += 30;
          // ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): μέρα που ο agent ΖΗΤΗΣΕ να δουλέψει
          // είναι λιγότερο καλή επιλογή για ρεπό. Μικρή ποινή (−10) ώστε να
          // μην ανατρέπει τη Σ3 κατανομή ΣΚ (×12/×10/×2) ή το ζευγάρωμα
          // ρεπό (+35) — απλώς σπάει τις ισοπαλίες υπέρ του αιτήματος.
          if (wish.wishFor(w.wishIdx, a.id, w.dates[d])) score -= wish.WISH_OFF_PENALTY;
        }
        if (score > bestScore) { bestScore = score; best = opt; }
      }

      if (!best) {
        // Δεν βρέθηκε έγκυρο σύνολο — πάρε την πρώτη ελεύθερη μέρα που κόβει σειρά
        best = [free[0]];
      }
      for (const d of best) {
        markOff(w, plan, d, 'repo');
        plan.offNeeded--;
      }
    }
  }
}

// ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): σκοτώνει η τοποθέτηση (s,e) στη μέρα d
// κάποιο αίτημα σε ΓΕΙΤΟΝΙΚΗ μέρα, λόγω 11ώρου (Κ8);
//
// Πραγματικό παράδειγμα: η Δημακη ζήτησε Παρασκευή 16:00-24:00. Η φάση ΣΚ
// τρέχει ΠΡΩΤΗ και της έδινε Σάββατο 08:00-16:00· τότε η Παρασκευή θα τελείωνε
// 24:00 και το Σάββατο θα ξεκινούσε 08:00 — 8 ώρες ανάπαυση, απαγορευμένο.
// Με Σάββατο 16:00-24:00 (υπάρχει τέτοια θέση) βγαίνουν 16 ώρες και ισχύουν
// ΚΑΙ η 5η εργάσιμη ΚΑΙ το αίτημα.
//
// Επιστρέφει false αμέσως όταν δεν υπάρχουν αιτήματα — μηδενική επίδραση.
function breaksNeighbourWish(w, plan, d, s, e) {
  const idx = w.wishIdx;
  if (!idx || !idx.size) return false;
  const a = plan.agent;
  for (const nd of [d - 1, d + 1]) {
    if (nd < 0 || nd > 6) continue;
    if (plan.days[nd]) continue;                    // η γειτονική έχει ήδη κλειδώσει
    const wi = wish.wishFor(idx, a.id, w.dates[nd]);
    if (!wi) continue;
    // Ποια προηγείται χρονικά;
    const first = nd < d
      ? { date: w.dates[nd], s: wi.start_time, e: wi.end_time }
      : { date: w.dates[d], s, e };
    const second = nd < d
      ? { date: w.dates[d], s, e }
      : { date: w.dates[nd], s: wi.start_time, e: wi.end_time };
    const endFirst = shiftAbs(first.date, first.s, first.e).endAbs;
    const startSecond = shiftAbs(second.date, second.s, second.e).startAbs;
    if (startSecond - endFirst < REST_MIN) return true;
  }
  return false;
}

// ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): κάνει η τοποθέτηση στη μέρα d ΑΝΕΦΙΚΤΗ
// κάποια ΜΕΤΑΓΕΝΕΣΤΕΡΗ μέρα που ζήτησε ο ΙΔΙΟΣ ο agent;
//
// Παράδειγμα από την παραγωγή: η Δημακη δούλεψε Κυριακή 22/11 (streak 1).
// Δουλεύοντας Δευτέρα, η σειρά φτάνει τις 5 ως την Πέμπτη και η Παρασκευή
// που ζήτησε γίνεται η 6η — εξαήμερο. Ένα ρεπό Δευτέρας την ξεκλειδώνει,
// με ΤΙΣ ΙΔΙΕΣ συνολικά εργάσιμες.
//
// Επιστρέφει 0 για όποιον ΔΕΝ έχει αίτημα — μηδενική επίδραση σε όλους τους
// υπόλοιπους. Είναι ποινή scoring, όχι απαγόρευση: αν ο agent είναι ο μόνος
// υποψήφιος, παίρνει κανονικά τη θέση και η κάλυψη δεν θυσιάζεται.
function wishBlockPenalty(w, plan, d) {
  const idx = w.wishIdx;
  if (!idx || !idx.size) return 0;
  const a = plan.agent;
  if (rule(a, 'no_streak_limit')) return 0;

  let pen = 0;
  for (let wd = d + 1; wd < 7; wd++) {
    if (!wish.wishFor(idx, a.id, w.dates[wd])) continue;
    if (plan.days[wd]) continue; // η μέρα του αιτήματος έχει ήδη κλειδώσει

    // Αν υπάρχει ήδη ρεπό ΑΝΑΜΕΣΑ στη d και στη wd, η σειρά κόβεται εκεί
    let brk = false;
    for (let i = d + 1; i < wd; i++) {
      const e = plan.days[i];
      if (e && e.type === 'off' && e.reason !== 'leave' && e.reason !== 'sick') { brk = true; break; }
    }
    if (brk) continue;

    // Συνεχόμενες «εργάσιμες» αμέσως πριν τη d (+ μεταφορά προηγούμενης εβδομάδας)
    let back = 0;
    for (let i = d - 1; i >= 0; i--) { if (countsAsWork(plan, i)) back++; else break; }
    if (back === d) back += agentState(w, a.id).streak;

    // Δουλεύοντας τη d και τις ενδιάμεσες, η wd γίνεται η (back+1+wd-d)η σερί
    if (back + 1 + (wd - d) > MAX_STREAK) pen += wish.WISH_BLOCK_PENALTY;
  }
  return pen;
}

// Φάση 5: κάλυψη απαιτήσεων (Κ1) με scoring
function phaseRequirements(w, reqByDay, opts = {}) {
  const { ctx } = w;

  // Ταιριάζει μια υπάρχουσα ανάθεση με την απαίτηση; (ακριβές ωράριο,
  // period πρωί/απόγευμα, ή η ειδική περίπτωση ΣΚ Φραγκου)
  function entryMatches(e, def, d) {
    if (e.start === def.start && e.end === def.end) return true;
    if (def.period === 'morning' && isMorning(e.start, e.end)) return true;
    if (def.period === 'afternoon' && isAfternoon(e.start)) return true;
    return false;
  }

  for (const d of (opts.days || [0, 1, 2, 3, 4, 5, 6])) {
    for (const rq of reqByDay[d]) {
      if (isK9Req(rq.def)) continue;          // βραδινή Κ9 (23:00-07:00): φάση 6
      if (rq.def.start === '23:00') continue; // νυχτερινή: καλύφθηκε στη φάση 3

      // 1) Μετρά ήδη τοποθετημένες βάρδιες που ταιριάζουν (σταθερά ωράρια Κ5,
      //    ΣΚ Φραγκου, period-based Αιγαίου/ΖΕΦΥΡΟΣ/Verification κ.λπ.)
      for (const a of ctx.agents) {
        if (rq.covered >= rq.def.headcount) break;
        const plan = w.plans.get(a.id);
        const e = plan.days[d];
        if (!e || e.type !== 'work' || e.usedForReq || e.night) continue;
        if (!deptMatch(a, rq.def.department)) continue;
        if (rq.def.skill && !a.skills.has(rq.def.skill)) continue;
        if (entryMatches(e, rq.def, d)) {
          e.usedForReq = true;
          e.reqLabel = rq.def.label;
          if (!e.color && rq.def.color) { e.color = rq.def.color; e.roleId = rq.def.roleId; }
          rq.covered++;
        }
      }

      // Υποψήφια ωράρια: για period-απαιτήσεις δοκιμάζονται εναλλακτικές
      // ώστε να χωρούν και agents με περιορισμούς ωραρίου
      const shiftOptions = rq.def.period
        ? (rq.def.period === 'morning'
            ? [[rq.def.start, rq.def.end], ...FILLER_MORNING.filter(([s]) => s !== rq.def.start)]
            : [[rq.def.start, rq.def.end], ...FILLER_AFTERNOON.filter(([s]) => s !== rq.def.start)])
        : [[rq.def.start, rq.def.end]];

      // 2) Νέες τοποθετήσεις για ό,τι λείπει
      while (rq.covered < rq.def.headcount) {
        const cands = [];
        for (const a of ctx.agents) {
          if (!deptMatch(a, rq.def.department)) continue;
          if (rq.def.skill && !a.skills.has(rq.def.skill)) continue;
          const plan = w.plans.get(a.id);
          const telework = a.workLocation === 'home';

          // Πρώτο ωράριο που επιτρέπεται για τον agent.
          //
          // ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): αν ο agent έχει αιτηθεί συγκεκριμένο
          // ωράριο για τη μέρα, δοκιμάζεται ΠΡΩΤΟ. Οι επιλογές είναι ΟΙ ΙΔΙΕΣ
          // — αλλάζει ΜΟΝΟ η σειρά δοκιμής, και μόνο για όποιον έχει αίτημα.
          // Δεν αλλάζει ποιος δουλεύει, πόσοι δουλεύουν, ούτε η κάλυψη: η
          // θέση γεμίζει κανονικά και κάθε ωράριο περνά τον ΙΔΙΟ canPlace.
          const myWish = wish.wishFor(w.wishIdx, a.id, w.dates[d]);
          let shift = null;
          for (const [s, e] of wish.preferredOrder(shiftOptions, myWish, w.dates[d])) {
            if (canPlace(w, plan, d, s, e, { telework })) { shift = [s, e]; break; }
          }
          if (!shift) continue;
          const [shS, shE] = shift;

          // Scoring
          let score = 100;
          const st = agentState(w, a.id);
          // Σ4 ΔΥΝΑΤΟ: συνέπεια ημι-ημέρας μέσα στην εβδομάδα. Το ανακάτεμα
          // πρωί/απόγευμα δημιουργεί «παγιδευμένες» ενδιάμεσες μέρες — 11h
          // ανάπαυση αδύνατη μεταξύ απογεύματος (λήξη 23:30) και επόμενου
          // πρωινού (08:00) — που καταλήγουν σε αναγκαστικό 3ο ρεπό (15/07/2026)
          const myMorning = isMorning(shS, shE);
          for (let i = 0; i < 7; i++) {
            const e = plan.days[i];
            if (!e || e.type !== 'work') continue;
            if (e.start === shS) score += 8;
            if (isMorning(e.start, e.end) === myMorning) score += 6;
            else score -= 30;
          }
          // Προτεραιότητα σε όσους απέχουν από τον στόχο 5 ημερών
          score += (workTarget(plan) - assignedCount(plan)) * 4;
          // Σ3: λιγότερα ΣΚ ιστορικά → προτεραιότητα το ΣΚ
          if (d >= 5) score -= Math.min(st.weekends, 10) * 2;
          // HARD 2 ρεπό (15/07/2026): όποιος έχει υποχρεωτικά ρεπό μέσα στην
          // εβδομάδα (μέρες σχολής, αναπαύσεις βραδιών, αιτήματα) ΧΡΕΙΑΖΕΤΑΙ
          // θέση ΣΚ για να φτάσει τις 5 εργάσιμες — παίρνει ισχυρή προτεραιότητα
          if (d >= 5) {
            // Ελεύθερες ΚΑΙ πραγματικά εργάσιμες καθημερινές (κανόνες/Κ8/Κ10 —
            // π.χ. Παρασκευή μπλοκαρισμένη από 6ήμερο-με-Κυριακή δεν μετράει)
            let wdFree = 0;
            for (let i = 0; i < 5; i++) {
              if (!plan.days[i] && agentDayWorkable(w, a, i)) wdFree++;
            }
            // (15/11/2026) ΜΕΤΑΦΕΡΟΜΕΝΗ ΣΕΙΡΑ ΑΠΟ ΤΗΝ ΠΡΟΗΓΟΥΜΕΝΗ ΚΥΡΙΑΚΗ.
            // Η φάση ΣΚ τρέχει ΠΡΩΤΗ: καμία καθημερινή δεν έχει ανατεθεί ακόμη,
            // άρα το k10ok μετρά back = 0 και ΔΕΝ προσθέτει ποτέ το st.streak
            // (η συνθήκη back === d δεν ισχύει). Αποτέλεσμα: όποιος δούλεψε την
            // προηγούμενη Κυριακή έμοιαζε να χωράει και στις 5 καθημερινές,
            // έπαιρνε needWknd = 0 — και μάλιστα την ποινή −15 ως «δεν τη
            // χρειάζεται» — και κατέληγε με 4 εργάσιμες.
            //
            // Με σειρά s ≥ 1 χρειάζεται ΟΠΩΣΔΗΠΟΤΕ ένα ρεπό μέσα στις
            // καθημερινές (αλλιώς s + 5 > 5 = εξαήμερο), άρα το πολύ 4.
            if (st.streak > 0 && !rule(a, 'no_streak_limit')) {
              wdFree = Math.min(wdFree, MAX_STREAK - 1);
            }
            const needWknd = workTarget(plan) - assignedCount(plan) - wdFree;
            // Κυρίαρχο κριτήριο: χωρίς θέση ΣΚ αυτός βγαίνει ΜΑΘΗΜΑΤΙΚΑ με
            // 3ο ρεπό (οι καθημερινές δεν του φτάνουν για 5 εργάσιμες)
            if (needWknd > 0) score += needWknd * 60;
            // Όποιος ΔΕΝ χρειάζεται τη θέση ΣΚ (χωράει στις καθημερινές)
            // την αφήνει σε όποιον τη χρειάζεται — ΕΚΤΟΣ των supervisors:
            // οι δικές τους θέσεις ΣΚ καλύπτονται μόνο από αυτούς
            else if (!a.departments.includes('supervisor')) score -= 15;
            // Ρεπό ΜΑΖΙ (15/07/2026): όποιος δουλεύει Σάββατο πρέπει να δουλεύει
            // ΚΑΙ Κυριακή (ΣΥΖΕΥΞΗ) — αλλιώς μένει με ρεπό Κυριακής + καθημερινής
            // = σπαστά. Ισχυρό bonus ώστε να νικά το needWknd (που μειώνεται
            // μόλις πάρει το Σάββατο): οι ίδιοι κάνουν όλο το ΣΚ, οι υπόλοιποι
            // παίρνουν Σαβ+Κυρ μαζί. (προτίμηση συνεχόμενων ρεπό — 15/07/2026)
            if (d === 6) {
              const sat = plan.days[5];
              if (sat && sat.type === 'work') score += 30;
            }
          }
          // Μην αχρηστεύεις γειτονική κενή καθημερινή (νεκρή μέρα = 3ο ρεπό)
          if (killsAdjacentDay(w, plan, d, shS, shE)) score -= 45;
          // Γεωργιου: δουλεύει Κυριακές — βολεύει (11/07/2026). Ισχυρό bonus:
          // με το «ΣΚ MAX» πρέπει να κερδίζει θέση Κυριακής, αλλιώς μένει
          // άθελά του με 2ο ρεπό Κυριακής τον μήνα
          if (d === 6 && rule(a, 'sunday_worker')) score += 40;
          // Προτιμήσεις πρωί/απόγευμα (soft)
          // prefer_morning: soft (+5/-6). Με `strong:true` (π.χ. Αντωνιου 18/07/2026)
          // πολύ δυνατή προτίμηση — απόγευμα μόνο ως έσχατη λύση όταν δεν βγαίνει
          // αλλιώς η κάλυψη (soft, ΟΧΙ hard — μπορεί ~1 στις 4 βδομάδες απόγευμα).
          const pm = rule(a, 'prefer_morning');
          if (pm) score += isMorning(shS, shE) ? (pm.strong ? 20 : 5) : (pm.strong ? -250 : -6);
          if (rule(a, 'prefer_afternoon')) score += isAfternoon(shS) ? 5 : -6;
          // ΡΟΥΣΣΟΥ ΟΛΓΑ (05/09/2026): προτιμώνται ΠΡΩΙΝΕΣ και ΒΡΑΔΙΝΕΣ,
          // οι απογευματινές όσο γίνεται λιγότερες. SOFT — δεν αποκλείει την
          // απογευματινή όταν δεν βγαίνει αλλιώς η κάλυψη.
          const pme = rule(a, 'prefer_morning_evening');
          if (pme) {
            if (isMorning(shS, shE) || isEveningStart(shS)) score += 15;
            else if (isAfternoon(shS)) score -= (pme.penalty != null ? pme.penalty : AFTERNOON_SOFT_PENALTY);
          }
          // Κοινή βάρδια ζεύγους (Βασιλακη Βασιλικη + Δημακη Δεσποινα —
          // 14/11/2026): SOFT προτίμηση να δουλεύουν την ΙΔΙΑ βάρδια την ίδια
          // μέρα. Μετράει μόνο όταν ο/η άλλος/η έχει ΗΔΗ τοποθετηθεί τη μέρα
          // αυτή — δεν επιβάλλεται ποτέ σε βάρος της κάλυψης.
          const pss = rule(a, 'prefer_same_shift');
          if (pss) {
            const mate = agentByName(ctx, pss.with);
            const me = mate ? w.plans.get(mate.id).days[d] : null;
            if (me && me.type === 'work') {
              const bonus = pss.bonus != null ? pss.bonus : 25;
              if (me.start === shS && me.end === shE) score += bonus;
              else if (me.start === shS) score += Math.round(bonus / 2);
              else score -= Math.round(bonus / 2);
            }
          }
          // prefer_same_start_any (ΛΑΜΠΡΟΥ ΦΑΝΗ — 14/11/2026): έρχεται στη
          // δουλειά μαζί με ΕΝΑΝ από τους δύο Γεωργιου — αρκεί ο ένας.
          // SOFT: αν κανείς τους δεν ταιριάζει τη μέρα αυτή, δουλεύει κανονικά
          // μόνη της· δεν μένει ποτέ χωρίς βάρδιες εξαιτίας του κανόνα.
          // escort_by_shift (ΛΑΜΠΡΟΥ ΦΑΝΗ — 14/11/2026): συνοδεία ανά ΣΥΓΚΕΚΡΙΜΕΝΟ
          // ωράριο. Π.χ. στις 07:00-15:00 αρκεί ένας από τρεις· στις 16:00-24:00
          // συγκεκριμένα ο ΡΟΥΣΣΟΥ. Σε ΟΠΟΙΟΔΗΠΟΤΕ άλλο ωράριο δεν επιβάλλεται
          // τίποτα. Ισχυρή προτίμηση — δεν αφήνει θέση ακάλυπτη.
          const esc = rule(a, 'escort_by_shift');
          if (esc) {
            const want = (esc.shifts || {})[`${shS}-${shE}`];
            if (want && want.length) {
              const penalty = esc.penalty != null ? esc.penalty : 200;
              const mates = want.map((n) => agentByName(ctx, n)).filter(Boolean);
              const placed = mates.map((m) => w.plans.get(m.id).days[d]).filter((x) => x && x.type === 'work');
              if (placed.some((x) => x.start === shS && x.end === shE)) {
                score += penalty;          // συνοδός ήδη εκεί — ιδανικό
              } else if (placed.length) {
                score -= penalty;          // δουλεύουν, αλλά σε ΑΛΛΗ βάρδια
              } else {
                // Κανείς δεν τοποθετήθηκε ακόμα: αξίζει μόνο αν υπάρχει
                // ΠΡΑΓΜΑΤΙΚΗ θέση που να τον φέρει στο ίδιο ωράριο
                const reachable = mates.some((m) => {
                  if (!shiftAllowedByRules(m, d, shS, shE, { date: w.dates[d] })) return false;
                  if (FILLER_MORNING.concat(FILLER_AFTERNOON).some(([s, e2]) => s === shS && e2 === shE)) return true;
                  return reqByDay[d].some((r2) =>
                    r2.covered < r2.def.headcount &&
                    deptMatch(m, r2.def.department) &&
                    (!r2.def.skill || m.skills.has(r2.def.skill)) &&
                    r2.def.start === shS && r2.def.end === shE);
                });
                if (!reachable) score -= penalty;
              }
            }
          }
          // Η ΑΛΛΗ ΠΛΕΥΡΑ του escort_by_shift: αν κάποιος που χρειάζεται
          // συνοδό έχει ΗΔΗ τοποθετηθεί σε αυτό ακριβώς το ωράριο σήμερα και
          // ο υποψήφιος είναι στη λίστα συνοδών του, δώσ' του προτεραιότητα.
          // Χωρίς αυτό ο κανόνας έμενε μισός: η ποινή έπεφτε στον συνοδευόμενο,
          // που όμως συχνά δεν έχει ανταγωνιστή — οπότε δεν άλλαζε τίποτα.
          for (const other of ctx.agents) {
            if (other.id === a.id) continue;
            const oe = rule(other, 'escort_by_shift');
            if (!oe) continue;
            const names = (oe.shifts || {})[`${shS}-${shE}`];
            if (!names || !names.includes(a.name)) continue;
            const oPlan = w.plans.get(other.id).days[d];
            if (oPlan && oPlan.type === 'work' && oPlan.start === shS && oPlan.end === shE) {
              score += oe.penalty != null ? oe.penalty : 200;
            }
          }
          // Διατήρηση ευελιξίας: όσοι μπορούν ΜΟΝΟ αυτό το είδος βάρδιας
          // προηγούνται, ώστε οι ευέλικτοι να μένουν για τις υπόλοιπες
          if (isMorning(shS, shE) && rule(a, 'only_morning')) score += 14;
          if (isAfternoon(shS) && (rule(a, 'only_afternoon') || rule(a, 'allowed_shifts'))) score += 14;
          // Atlas μόνο σε απόλυτη ανάγκη (Καλογεροπουλου)
          if (rq.def.skill && rule(a, 'skill_last_resort') && rule(a, 'skill_last_resort').skill === rq.def.skill) score -= 60;
          // ΖΕΦΥΡΟΣ τις καθημερινές: μείνε στον ΖΕΦΥΡΟΣ — όχι σε ΑΛΛΕΣ απαιτήσεις
          if (rule(a, 'zefyros_weekdays') && d < 5 && rq.def.skill !== 'ΖΕΦΥΡΟΣ') score -= 30;
          // Κωνσταντινιδης: όταν απογευματινή διά ζώσης → 15:30-23:30 International
          const asi = rule(a, 'afternoon_shift_international');
          if (asi && isAfternoon(shS)) {
            score += shS === asi.shift[0] && rq.def.label === 'International' ? 15 : -15;
          }
          // Αντωνιου: εναλλαγή πρωί/απόγευμα ανά εβδομάδα
          if (rule(a, 'weekly_alternation')) {
            const wantMorning = agentState(w, a.id).rizouMode === 'morning';
            if (isMorning(shS, shE) !== wantMorning) score -= 50;
          }
          // 06:00-14:00: δίκαιη εναλλαγή μεταξύ των ατόμων της λίστας
          // (12/07/2026) — όποιος το έχει κάνει λιγότερο, προηγείται.
          // Η Αντωνιου («καμιά φορά ΣΚ») παίρνει επιπλέον ποινή ώστε να μπαίνει σπάνια.
          if (shS === '06:00' && shE === '14:00') {
            score -= (st.count62 || 0) * 6;
            const std62 = rule(a, 'six_two_days');
            if (std62 && std62.days.length === 2 && std62.days[0] === 6) score -= 20;
            // Δευτέρες: προτιμάται ο Γεωργιου στο 06:00-14:00 — όχι όμως
            // κάθε Δευτέρα (13/07/2026): μέτριο bonus, η εναλλαγή ισορροπεί
            if (d === 0 && std62 && std62.days.includes(1)) score += 10;
            // avoid_weekend_62 (Γεωργιου Βαγγελης + Γεωργιου Ρενα, 14/11/2026):
            // ΑΠΟΦΥΓΗ του 06:00-14:00 τα ΣΚ — προτεραιότητα, ΟΧΙ απαγόρευση.
            // Η ποινή είναι αρκετά μεγάλη ώστε να χάνουν από ΟΠΟΙΟΝΔΗΠΟΤΕ άλλο
            // υποψήφιο, αλλά αν δεν υπάρχει εναλλακτική παίρνουν κανονικά τη
            // βάρδια — δεν θυσιάζεται η κάλυψη ούτε παραβιάζεται άλλος κανόνας.
            const aw = rule(a, 'avoid_weekend_62');
            if (aw && d >= 5) score -= (aw.penalty != null ? aw.penalty : 300);
          }

          // ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): tie-breaker και ΜΟΝΟ. Το βάρος είναι
          // σκόπιμα μικρό (+12/+4) ώστε να κρίνει αποκλειστικά μεταξύ
          // υποψηφίων που η ΥΠΑΡΧΟΥΣΑ λογική θεωρεί σχεδόν ισοδύναμους —
          // δεν ανατρέπει κάλυψη ΣΚ (×60), sunday_worker (+40) ή κανέναν από
          // τους ισχυρούς soft κανόνες (−200/−250/−300).
          score += wish.scoreBonus(myWish, w.dates[d], shS, shE);
          // Ασύμβατη βάρδια σε μέρα ΜΕ αίτημα: η μέρα «καίγεται» (Κ2 — μία
          // βάρδια/μέρα), άρα προτίμησε άλλον υποψήφιο για αυτή τη θέση.
          score -= wish.conflictPenalty(myWish, w.dates[d], shS, shE);
          // …και αν σκοτώνει αίτημα ΓΕΙΤΟΝΙΚΗΣ μέρας μέσω 11ώρου (Κ8)
          if (breaksNeighbourWish(w, plan, d, shS, shE)) score -= wish.WISH_CONFLICT_PENALTY;
          // …και ποινή αν η σημερινή τοποθέτηση μπλοκάρει μέρα που ζήτησε ο ίδιος
          score -= wishBlockPenalty(w, plan, d);

          cands.push({ a, score, shift });
        }

        if (cands.length === 0) {
          w.report.uncovered.push({
            date: w.dates[d],
            start: rq.def.start,
            end: rq.def.end,
            label: rq.def.label + (rq.def.period ? (rq.def.period === 'morning' ? ' (πρωί)' : ' (απόγευμα)') : ''),
            missing: rq.def.headcount - rq.covered
          });
          break;
        }
        cands.sort((x, y) => y.score - x.score || x.a.id - y.a.id);
        const { a, shift } = cands[0];
        const telework = a.workLocation === 'home';
        place(w, w.plans.get(a.id), d, {
          start: shift[0], end: shift[1],
          skill: rq.def.skill, reqLabel: rq.def.label, usedForReq: true,
          label: [telework ? 'ΤΗΛΕΡΓΑΣΙΑ' : null, rq.def.label === 'International' ? 'INTERNATIONAL' : null].filter(Boolean).join(' ') || null,
          location: telework ? 'home' : 'office',
          roleId: rq.def.roleId, color: rq.def.color
        });
        rq.covered++;
      }
    }
  }
}

// Φάση 6: βραδινή βάρδια Κ9 (μόνο λίστα, όρια/εβδομάδα, Μανωλακη όχι μόνη).
// Ωράριο 23:00-07:00 από 14/11/2026 (πριν: 19:00-03:00) — ΙΔΙΑ άτομα.
// Τρέχει σε ΔΥΟ περάσματα (14/07/2026): pass A ΠΡΙΝ τις υπόλοιπες απαιτήσεις
// (κρατά θέση πριν φαγωθεί η λίστα από τα call slots), pass B μετά για ό,τι
// έμεινε ακάλυπτο. Μόνο το pass B αναφέρει ακάλυπτα.
//
// (14/11/2026) Ο περιορισμός «όχι μόνος/η στο γραφείο» (not_alone) ΚΑΤΑΡΓΗΘΗΚΕ
// με απόφαση του προϊσταμένου: η Μανωλακη καλύπτει κανονικά τη βραδινή Vega
// Bank. Η στήλη shift_eligibility.not_alone παραμένει στη βάση ως ιστορικό,
// αλλά ΔΕΝ επιβάλλεται πουθενά.
function phase1903(w, reqByDay, opts = {}) {
  const { ctx } = w;
  const verif = ctx.roles.get('Verification') || { id: null, color: null };
  const is1903 = (e) => !!e && e.type === 'work' && isK9Entry(e);

  for (let d = 0; d < 7; d++) { // ΚΑΘΕ μέρα Δευ-Κυρ (14/07/2026)
    const rq = reqByDay[d].find((r) => isK9Req(r.def));
    if (!rq || rq.covered >= rq.def.headcount) continue;

    const elig1903 = ctx.eligibility.get(K9_ELIG_KEY) || new Map();
    const cands = [];
    for (const a of ctx.agents) {
      const el = elig1903.get(a.id);
      if (!el) continue; // Κ9: ΜΟΝΟ από τη λίστα
      const plan = w.plans.get(a.id);
      if (plan.elig1903Used >= el.maxPerWeek) continue;
      // Πάνω από 1 φορά/εβδομάδα ΜΟΝΟ ΣΥΝΕΧΟΜΕΝΑ (15/07/2026): η 2η+ βραδινή Κ9
      // μπαίνει μόνο αμέσως μετά την προηγούμενη (π.χ. Δευ+Τρι), και μετά
      // τη σειρά ακολουθεί ρεπό — η επόμενη μέρα πρέπει να χωράει το ρεπό
      if (plan.elig1903Used >= 1) {
        if (!(d > 0 && is1903(plan.days[d - 1]))) continue;
        if (d + 1 < 7 && plan.days[d + 1] && plan.days[d + 1].type === 'work') continue;
      }
      // Κ9 υπερισχύει ατομικών περιορισμών ωραρίου — όχι όμως των Κ2/Κ6/Κ8/Κ10
      if (!canPlace(w, plan, d, K9_START, K9_END, { override1903: true })) continue;
      const st = agentState(w, a.id);
      let score = 100 - st.count1903 * 5 - plan.elig1903Used * 20;
      // Προτίμησε να ΚΛΕΙΣΕΙ η σειρά με τον χθεσινό (ομαδοποίηση — 15/07/2026)
      if (d > 0 && is1903(plan.days[d - 1])) score += 30;
      // Αντωνιου: προτίμησέ την τις εβδομάδες απογεύματος
      if (rule(a, 'weekly_alternation') && st.rizouMode === 'morning') score -= 25;
      score += (workTarget(plan) - assignedCount(plan)) * 4;
      // Προτίμηση βραδινών (ΡΟΥΣΣΟΥ ΟΛΓΑ — 05/09/2026)
      if (rule(a, 'prefer_morning_evening')) score += 15;
      // Κυριακή: εναλλαγή ώστε κανείς να μην «καίει» το όριο 2 Κυριακών/μήνα
      if (d === 6) score -= ((st.sundays || {})[w.dates[6].slice(0, 7)] || 0) * 15;
      cands.push({ a, el, score });
    }

    if (cands.length === 0) {
      // Στο pass A δεν αναφέρεται ακάλυπτο — θα ξαναδοκιμάσει το pass B
      if (!opts.firstPass) {
        w.report.uncovered.push({ date: w.dates[d], start: K9_START, end: K9_END, label: rq.def.label });
      }
      continue;
    }
    cands.sort((x, y) => y.score - x.score || x.a.id - y.a.id);
    const { a, el } = cands[0];
    const plan = w.plans.get(a.id);
    place(w, plan, d, {
      start: K9_START, end: K9_END, skill: rq.def.skill, reqLabel: rq.def.label, usedForReq: true,
      label: el.location === 'home' ? 'ΤΗΛΕΡΓΑΣΙΑ' : null,
      location: el.location, roleId: verif.id, color: verif.color
    });
    plan.elig1903Used++;
    agentState(w, a.id).count1903++;
    rq.covered++;
  }

  // Μετά από ΣΕΙΡΑ 2+ συνεχόμενων βραδινών Κ9 → ΡΕΠΟ την επόμενη μέρα
  // (15/07/2026). Τρέχει και στα ΔΥΟ περάσματα — αλλιώς οι απαιτήσεις που
  // μεσολαβούν μπορούν να πιάσουν τη μέρα του ρεπό. Αν η σειρά τελειώνει
  // Κυριακή, το ρεπό οφείλεται στην επόμενη εβδομάδα (pendingNightRest).
  {
    for (const [agentId] of (ctx.eligibility.get(K9_ELIG_KEY) || new Map())) {
      const plan = w.plans.get(agentId);
      if (!plan) continue;
      let d = 0;
      while (d < 7) {
        if (is1903(plan.days[d])) {
          let len = 1;
          while (d + len < 7 && is1903(plan.days[d + len])) len++;
          if (len >= 2) {
            const restDay = d + len;
            if (restDay < 7) {
              if (!plan.days[restDay]) {
                markOff(w, plan, restDay, 'night_rest');
                plan.offNeeded = Math.max(0, plan.offNeeded - 1);
              }
            } else {
              plan.pendingNightRest = Math.max(plan.pendingNightRest || 0, 1);
            }
          }
          d += len;
        } else {
          d++;
        }
      }
    }
  }
}

// Φάση 7: συμπλήρωση — ΟΛΟΙ οι ενεργοί φτάνουν τις 5 εργάσιμες (Κ2,
// απόφαση προϊσταμένου 09/07/2026), με λογική βάρδια βάσει κανόνων/Σ4.
function phaseFillers(w, reqByDay) {
  const { ctx } = w;
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);

    // ΣΚ MAX = HARD (14/07/2026): τα Σαββατοκύριακα δουλεύουν ΜΟΝΟ όσοι
    // καλύπτουν τις απαιτήσεις του πίνακα — ΚΑΝΕΝΑΣ filler ΣΚ. Αν κάποιος
    // δεν φτάνει τις 5 εργάσιμες μέσα στην εβδομάδα, μένει με παραπάνω
    // ρεπό και αναφέρεται (τα αιτήματα ρεπό/άδειες το δικαιολογούν).
    // ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): ΔΥΟ περάσματα πάνω στις μέρες.
    //   dayPass 0 — παρακάμπτει μέρες που θα έκαναν ΑΝΕΦΙΚΤΗ μεταγενέστερη
    //               μέρα με αίτημα (σειρά Κ10), ώστε να προλάβει να μπει εκείνη
    //   dayPass 1 — γεμίζει ό,τι έμεινε, ώστε να ΜΗ ΧΑΘΕΙ εργάσιμη αν τελικά
    //               η μέρα του αιτήματος δεν μπόρεσε να καλυφθεί
    // Χωρίς αιτήματα το dayPass 0 γεμίζει τα πάντα και το 1 δεν βρίσκει
    // τίποτα — συμπεριφορά ΑΚΡΙΒΩΣ η σημερινή.
    for (const dayPass of [0, 1]) {
    for (const d of [0, 1, 2, 3, 4]) {
      if (assignedCount(plan) >= workTarget(plan)) break;
      if (plan.days[d]) continue;
      if (dayPass === 0 && wishBlockPenalty(w, plan, d) > 0) continue;

      // Υποψήφιες βάρδιες με σειρά προτίμησης
      let shifts = [];
      if (a.fixedStart && !a.fixedDays) {
        shifts = [[a.fixedStart, a.fixedEnd]]; // π.χ. Χιωτη 16:00-24:00
      } else if (a.departments.includes('supervisor')) {
        // Έξτρα/2ος supervisor: ΠΑΝΤΑ 08:00-16:00 (HARD — 18/07/2026).
        // Τα σταθερά slots 07:00-15:00 & 16:00-24:00 μπαίνουν στη φάση απαιτήσεων.
        shifts = [['08:00', '16:00']];
      } else {
        const alt = rule(a, 'weekly_alternation');
        const wantMorning =
          rule(a, 'only_morning') ? true :
          rule(a, 'only_afternoon') || rule(a, 'allowed_shifts') ? false :
          alt ? agentState(w, a.id).rizouMode === 'morning' :
          // ΡΟΥΣΣΟΥ ΟΛΓΑ (05/09/2026): στα fillers πρωί — οι βραδινές
          // βάρδιες δίνονται μόνο από τις φάσεις απαιτήσεων/νυχτερινών
          rule(a, 'prefer_morning_evening') ? true :
          rule(a, 'prefer_afternoon') ? false :
          rule(a, 'prefer_morning') ? true :
          // Σ4: ακολούθησε ό,τι κάνει ήδη μέσα στην εβδομάδα
          plan.days.some((e) => e && e.type === 'work' && isAfternoon(e.start)) ? false : true;

        const allowed = rule(a, 'allowed_shifts');
        if (allowed) {
          // Οι νυχτερινές της λίστας (π.χ. 23:00-07:00) ΔΕΝ μπαίνουν ως
          // filler: ανατίθενται αποκλειστικά από τη φάση 3, που κρατά και τη
          // λογιστική τους (όριο 2/εβδομάδα + υποχρεωτική ανάπαυση μετά).
          shifts = allowed.shifts.filter(([s, e]) => !isNight(s, e));
        } else {
          shifts = wantMorning ? [...FILLER_MORNING, ...FILLER_AFTERNOON] : [...FILLER_AFTERNOON, ...FILLER_MORNING];
        }
        // only_morning με συγκεκριμένες ενάρξεις (Ρενα 07:30/08:00)
        const om = rule(a, 'only_morning');
        if (om && om.starts) shifts = FILLER_MORNING.filter(([s]) => om.starts.includes(s));

        // Κοινή βάρδια ζεύγους (Βασιλακη Βασιλικη + Δημακη Δεσποινα —
        // 14/11/2026): αν ο/η άλλος/η δουλεύει ΗΔΗ αυτή τη μέρα, η βάρδιά
        // του/της δοκιμάζεται ΠΡΩΤΗ. SOFT: αν δεν επιτρέπεται (canPlace),
        // η σειρά συνεχίζει κανονικά με τις υπόλοιπες επιλογές.
        const pssF = rule(a, 'prefer_same_shift');
        if (pssF) {
          const mate = agentByName(ctx, pssF.with);
          const me = mate ? w.plans.get(mate.id).days[d] : null;
          // Εξαιρούνται τα σπαστά και οι νυχτερινές/βραδινές Κ9: αυτές
          // ανατίθενται ΜΟΝΟ από τις φάσεις 3/6 που κρατούν τη λογιστική τους
          if (me && me.type === 'work' && !me.parts && !me.night &&
              !isK9Entry(me) && !isNight(me.start, me.end)) {
            const same = shifts.filter(([s, e]) => s === me.start && e === me.end);
            const rest = shifts.filter(([s, e]) => !(s === me.start && e === me.end));
            // Αν η βάρδιά του/της δεν είναι στη λίστα fillers, πρόσθεσέ τη
            // μπροστά — είναι υπάρχουσα βάρδια του συστήματος, όχι νέα
            shifts = same.length ? [...same, ...rest] : [[me.start, me.end], ...rest];
          }
        }
      }

      // ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ (15/11/2026): το αιτούμενο ωράριο δοκιμάζεται ΠΡΩΤΟ.
      // Εδώ είναι το σημείο με τη μεγαλύτερη ελευθερία — η φάση fillers
      // διαλέγει μόνη της ωράριο για να φτάσει ο agent τις 5 εργάσιμες — άρα
      // εδώ ικανοποιούνται τα περισσότερα αιτήματα. Οι επιλογές παραμένουν
      // ΟΙ ΙΔΙΕΣ: αλλάζει μόνο η σειρά και κάθε μία περνά τον ίδιο canPlace,
      // οπότε κανένας κανόνας δεν παρακάμπτεται για χάρη του αιτήματος.
      shifts = wish.withWishOption(shifts, wish.wishFor(w.wishIdx, a.id, w.dates[d]), w.dates[d]);

      // Πέρασμα 0: μόνο ωράρια που ΔΕΝ αχρηστεύουν γειτονική κενή μέρα
      // (νεκρή μέρα = αναγκαστικό 3ο ρεπό). Πέρασμα 1: ό,τι επιτρέπεται.
      outer:
      for (const pass of [0, 1]) {
        for (const [s, e] of shifts) {
          const telework = a.workLocation === 'home';
          if (!canPlace(w, plan, d, s, e, { telework })) continue;
          if (pass === 0 && killsAdjacentDay(w, plan, d, s, e)) continue;
          if (pass === 0 && breaksNeighbourWish(w, plan, d, s, e)) continue;
          const c = fillerColor(ctx, a, d, s, e);
          place(w, plan, d, {
            start: s, end: e,
            label: telework ? 'ΤΗΛΕΡΓΑΣΙΑ' : null,
            location: telework ? 'home' : 'office',
            filler: true, ...c
          });
          break outer;
        }
      }
    }
    }

    // Όσες μέρες έμειναν κενές μετά τον στόχο → ρεπό (πέρα από τα 2 = σημείωση)
    for (let d = 0; d < 7; d++) {
      if (!plan.days[d]) markOff(w, plan, d, 'repo');
    }
  }

  // Πέρασμα ΕΠΙΔΙΟΡΘΩΣΗΣ (HARD 2 ρεπό — 15/07/2026): όποιος έμεινε κάτω από
  // τον στόχο του με ΠΕΡΙΤΤΑ generator-ρεπό καθημερινής, τα ξαναδοκιμάζουμε
  // ως βάρδιες — η κατανομή ρεπό μπορεί να είχε κλειδώσει μέρα που τελικά
  // ήταν εργάσιμη (π.χ. το ΣΚ seat ήρθε αλλού απ' ό,τι υπέθεσε)
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);
    let deficit = workTarget(plan) - assignedCount(plan);
    if (deficit <= 0) continue;
    for (let d = 0; d < 5 && deficit > 0; d++) {
      const e = plan.days[d];
      if (!e || e.type !== 'off' || e.reason !== 'repo') continue;
      plan.days[d] = null; // δοκιμαστικό ξεκλείδωμα
      let placed = false;
      const alt = rule(a, 'weekly_alternation');
      const wantMorning = rule(a, 'only_morning') ? true : alt ? agentState(w, a.id).rizouMode === 'morning' : !rule(a, 'only_afternoon');
      const shifts = a.fixedStart && !a.fixedDays
        ? [[a.fixedStart, a.fixedEnd]]
        : (wantMorning ? [...FILLER_MORNING, ...FILLER_AFTERNOON] : [...FILLER_AFTERNOON, ...FILLER_MORNING]);
      for (const [s, e2] of shifts) {
        const telework = a.workLocation === 'home';
        if (canPlace(w, plan, d, s, e2, { telework })) {
          const c = fillerColor(ctx, a, d, s, e2);
          place(w, plan, d, {
            start: s, end: e2,
            label: telework ? 'ΤΗΛΕΡΓΑΣΙΑ' : null,
            location: telework ? 'home' : 'office',
            filler: true, ...c
          });
          placed = true;
          deficit--;
          break;
        }
      }
      if (!placed) markOff(w, plan, d, 'repo'); // επαναφορά
    }
    if (deficit > 0) {
      w.report.soft.push(`${a.name}: μόνο ${assignedCount(plan)}/${workTarget(plan)} εργάσιμες — δεν βρέθηκε επιτρεπτή βάρδια για ${deficit} μέρα/ες.`);
    }
  }

  // Πέρασμα ΣΚ WIN-WIN (15/07/2026): όποιος ΑΚΟΜΑ έχει έλλειμμα (μένει με 3ο
  // ρεπό) ΚΑΙ υπάρχει ΑΚΑΛΥΠΤΟ requirement slot ΣΚ που δικαιούται → τον βάζει
  // εκεί. Λύνει ΤΑΥΤΟΧΡΟΝΑ «ακριβώς 2 ρεπό» + «ΣΚ MIN καλυμμένο», ΧΩΡΙΣ να
  // σπάει το ΣΚ MAX (γεμίζει μόνο ΔΗΛΩΜΕΝΗ, ακάλυπτη θέση του πίνακα).
  if (reqByDay) {
    for (const a of ctx.agents) {
      const plan = w.plans.get(a.id);
      let deficit = workTarget(plan) - assignedCount(plan);
      if (deficit <= 0) continue;
      for (const d of [5, 6]) {
        if (deficit <= 0) break;
        const cur = plan.days[d];
        // Μόνο πάνω σε παραγόμενο ρεπό (όχι fixed_off/night_rest/αίτημα/κενό-άδεια)
        if (!cur || cur.type !== 'off' || cur.reason !== 'repo') continue;
        for (const rq of reqByDay[d]) {
          if (deficit <= 0) break;
          if (rq.covered >= rq.def.headcount) continue;
          if (rq.def.start === '23:00' || isK9Req(rq.def)) continue;
          if (!deptMatch(a, rq.def.department)) continue;
          if (rq.def.skill && !a.skills.has(rq.def.skill)) continue;
          const opts = rq.def.period
            ? (rq.def.period === 'morning'
                ? [[rq.def.start, rq.def.end], ...FILLER_MORNING.filter(([s]) => s !== rq.def.start)]
                : [[rq.def.start, rq.def.end], ...FILLER_AFTERNOON.filter(([s]) => s !== rq.def.start)])
            : [[rq.def.start, rq.def.end]];
          const telework = a.workLocation === 'home';
          plan.days[d] = null; // ξεκλείδωσε το ρεπό ΠΡΙΝ το probe (αλλιώς canPlace=false)
          // allowSundayOver: το «ακριβώς 2 ρεπό» υπερισχύει του ορίου Κυριακών
          // (απόφαση 15/07/2026) — ΜΟΝΟ όταν αυτή η μέρα φτάνει τον agent
          // ΑΚΡΙΒΩΣ στις 5 (deficit==1). Αν θα έμενε κι άλλο κοντός (π.χ.
          // νυχτερινός με πολλές αναπαύσεις), δεν «καίμε» 3η Κυριακή τζάμπα.
          const allowSundayOver = deficit === 1;
          let shift = null;
          for (const [s, e] of opts) {
            if (canPlace(w, plan, d, s, e, { telework, allowSundayOver })) { shift = [s, e]; break; }
          }
          if (!shift) { markOff(w, plan, d, 'repo'); continue; } // επαναφορά
          place(w, plan, d, {
            start: shift[0], end: shift[1],
            skill: rq.def.skill, reqLabel: rq.def.label, usedForReq: true,
            label: [telework ? 'ΤΗΛΕΡΓΑΣΙΑ' : null, rq.def.label === 'International' ? 'INTERNATIONAL' : null].filter(Boolean).join(' ') || null,
            location: telework ? 'home' : 'office',
            roleId: rq.def.roleId, color: rq.def.color
          });
          rq.covered++;
          deficit--;
          // Αφαίρεσε το slot από τα ακάλυπτα του report
          const ui = w.report.uncovered.findIndex(
            (u) => u.date === w.dates[d] && u.start === rq.def.start && u.end === rq.def.end
          );
          if (ui >= 0) w.report.uncovered.splice(ui, 1);
        }
      }
    }
  }
}

// Φάση 8: Κ4 — οριστικοποίηση ώρας νυχτερινής (23:00 ή 23:30)
function phaseK4(w) {
  const { ctx } = w;
  for (let d = 0; d < 7; d++) {
    for (const a of ctx.agents) {
      const plan = w.plans.get(a.id);
      const e = plan.days[d];
      if (!e || e.type !== 'work' || !e.night) continue;

      // Ανοίγει κάποιος στις 07:00/07:30 την επόμενη μέρα;
      let opener = false;
      if (d < 6) {
        for (const b of ctx.agents) {
          const ne = w.plans.get(b.id).days[d + 1];
          if (ne && ne.type === 'work' && (ne.start === '07:00' || ne.start === '07:30')) {
            opener = true;
            break;
          }
        }
      } else {
        opener = true; // Κυριακή: το πρωί της Δευτέρας έχει πάντα Supervisor 07:00 — αναθεωρείται στην επόμενη εβδομάδα αν χρειαστεί
      }

      if (!opener) {
        // Κανείς νωρίς το πρωί → η νυχτερινή ανοίγει η ίδια στις 23:00-07:00
        // (έλεγχος Κ8 προς τα πίσω για την κατά 30' νωρίτερη έναρξη)
        const old = plan.days[d];
        plan.days[d] = null;
        if (canPlace(w, plan, d, '23:00', '07:00', { ignoreTarget: true })) {
          plan.days[d] = { ...old, start: '23:00', end: '07:00' };
        } else {
          plan.days[d] = old;
        }
      }
    }
  }
}

// Φάση 9: soft έλεγχοι Σ5 (ίδια ώρα έναρξης ζεύγους) → αναφορά
function phasePairReport(w) {
  const { ctx } = w;
  const seen = new Set();
  for (const a of ctx.agents) {
    const pr = rule(a, 'pair_same_start');
    if (!pr || seen.has(a.name)) continue;
    const b = ctx.agents.find((x) => x.name === pr.with);
    if (!b) continue;
    seen.add(a.name);
    seen.add(b.name);
    for (let d = 0; d < 7; d++) {
      const ea = w.plans.get(a.id).days[d];
      const eb = w.plans.get(b.id).days[d];
      if (ea && eb && ea.type === 'work' && eb.type === 'work' && ea.start !== eb.start) {
        w.report.soft.push(`Σ5: ${w.dates[d]} διαφορετική έναρξη ${a.name} (${ea.start}) / ${b.name} (${eb.start}).`);
      }
    }
  }

  // Κοινή βάρδια ζεύγους (14/11/2026) — soft: αναφέρονται οι μέρες που
  // δουλεύουν ΚΑΙ οι δύο αλλά σε ΔΙΑΦΟΡΕΤΙΚΗ βάρδια, για να φαίνεται στον
  // χρήστη πού δεν βγήκε η προτίμηση. Οι μέρες που ο ένας έχει ρεπό ΔΕΝ
  // είναι παράβαση — η προτίμηση αφορά μόνο κοινές εργάσιμες.
  const seenPair = new Set();
  for (const a of ctx.agents) {
    const pss = rule(a, 'prefer_same_shift');
    if (!pss || seenPair.has(a.name)) continue;
    const b = agentByName(ctx, pss.with);
    if (!b) continue;
    seenPair.add(a.name);
    seenPair.add(b.name);
    for (let d = 0; d < 7; d++) {
      const ea = w.plans.get(a.id).days[d];
      const eb = w.plans.get(b.id).days[d];
      if (!ea || !eb || ea.type !== 'work' || eb.type !== 'work') continue;
      if (ea.start === eb.start && ea.end === eb.end) continue;
      w.report.soft.push(
        `Κοινή βάρδια: ${w.dates[d]} ${a.name} (${ea.start}-${ea.end}) / ${b.name} (${eb.start}-${eb.end}) — δεν βγήκε κοινή βάρδια.`
      );
    }
  }
}

// ==================== ΦΑΣΗ 11: ΕΛΕΓΧΟΣ ΝΕΩΝ ΚΑΝΟΝΩΝ ====================
// (14/11/2026) Δίχτυ ασφαλείας ΠΡΙΝ βγει το πρόγραμμα/Excel: επαληθεύει ότι
// οι υποχρεωτικοί κανόνες τηρήθηκαν όντως. Ο έλεγχος είναι ΓΕΝΙΚΟΣ (διαβάζει
// τους κανόνες, δεν έχει ονόματα μέσα), άρα πιάνει και μελλοντικούς agents.
//
// Δεν «διορθώνει» τίποτα και δεν παρακάμπτει κανέναν κανόνα: ό,τι βρει το
// ΑΝΑΦΕΡΕΙ στον χρήστη (report.soft) — π.χ. όταν ένα σταθερό ωράριο δεν
// μπήκε γιατί συγκρούστηκε με άδεια (Κ6) ή με το 6ήμερο (Κ10).
function phaseRulesAudit(w) {
  const { ctx } = w;
  const bad = (msg) => w.report.soft.push(`ΕΛΕΓΧΟΣ ΚΑΝΟΝΩΝ: ${msg}`);
  // Οι άδειες/αιτήματα ρεπό (Κ6) υπερισχύουν των σταθερών ωραρίων — δεν
  // είναι παράβαση, είναι ιεραρχία κανόνων
  const k6 = (e) => e && e.type === 'off' && (e.reason === 'leave' || e.reason === 'sick' || e.reason === 'repo_request');

  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);

    // Σταθερό εβδομαδιαίο πρόγραμμα: υποχρεωτικά ρεπό + ακριβή ωράρια
    const ws = rule(a, 'weekly_schedule');
    if (ws) {
      for (const dow of ws.off || []) {
        const d = dow - 1;
        const e = plan.days[d];
        if (e && e.type === 'work') {
          bad(`${a.name}: ${w.dates[d]} έπρεπε να είναι ΡΕΠΟ (σταθερό πρόγραμμα) — έχει ${e.start}-${e.end}.`);
        }
      }
      for (const [dowStr, sh] of Object.entries(ws.shifts || {})) {
        const d = Number(dowStr) - 1;
        const e = plan.days[d];
        if (!e || k6(e)) continue;
        if (e.type === 'off') {
          bad(`${a.name}: ${w.dates[d]} έπρεπε να έχει σταθερή βάρδια ${sh[0]}-${sh[1]} — έμεινε ρεπό (${e.reason}).`);
        } else if (e.start !== sh[0] || e.end !== sh[1]) {
          bad(`${a.name}: ${w.dates[d]} σταθερό ωράριο ${sh[0]}-${sh[1]} — έχει ${e.start}-${e.end}.`);
        }
      }
    }

    // Νωρίτερη επιτρεπτή ώρα έναρξης ανά ημέρα
    const sad = rule(a, 'start_after_days');
    if (sad) {
      for (const [dowStr, t] of Object.entries(sad.days || {})) {
        const d = Number(dowStr) - 1;
        const e = plan.days[d];
        if (e && e.type === 'work' && toMin(e.start) < toMin(t)) {
          bad(`${a.name}: ${w.dates[d]} ξεκινά ${e.start} — δεν επιτρέπεται έναρξη πριν τις ${t}.`);
        }
      }
    }

    // 06:00-14:00 απαγορευμένο στα ΣΚ (weekend: false)
    const std = rule(a, 'six_two_days');
    if (std && std.weekend === false) {
      for (const d of [5, 6]) {
        const e = plan.days[d];
        if (e && e.type === 'work' && e.start === '06:00' && e.end === '14:00') {
          bad(`${a.name}: ${w.dates[d]} (ΣΚ) έχει 06:00-14:00 — απαγορεύεται ρητά.`);
        }
      }
    }
  }

  // (14/11/2026) Supervisor Vega Bank σε ΠΡΩΙΝΗ βάρδια → πρέπει να υπάρχει
  // εργαζόμενος Atlas με έναρξη 07:00 την ίδια μέρα. Αφορά ΜΟΝΟ πρωινές —
  // απογευματινές και βραδινές δεν ελέγχονται.
  for (const a of ctx.agents) {
    if (!rule(a, 'vega_supervisor')) continue;
    const plan = w.plans.get(a.id);
    for (let d = 0; d < 7; d++) {
      const sup = plan.days[d];
      if (!sup || sup.type !== 'work' || !isMorning(sup.start, sup.end)) continue;
      const euro7 = ctx.agents.some((x) => {
        if (!x.skills.has('ATLAS')) return false;
        const other = w.plans.get(x.id).days[d];
        return other && other.type === 'work' && other.start === '07:00';
      });
      if (!euro7) {
        bad(`${a.name}: πρωινή Supervisor Vega Bank ${w.dates[d]} (${sup.start}-${sup.end}) ΧΩΡΙΣ εργαζόμενο Atlas με έναρξη 07:00.`);
      }
    }
  }

  // Βραδινή Κ9: σωστό ωράριο + ΙΔΙΑ άτομα (μόνο μέλη της λίστας) + ΟΡΙΑ
  // (14/11/2026) Έλεγχος ΠΡΙΝ την εξαγωγή Excel: πόσες βάρδιες Vega Bank
  // ανέλαβε ο καθένας και αν ξεπέρασε το προσωπικό εβδομαδιαίο όριό του.
  // Ο μετρητής είναι ΑΝΑ ΕΒΔΟΜΑΔΑ (plan.elig1903Used μηδενίζεται στο newWeek).
  const eligK9 = ctx.eligibility.get(K9_ELIG_KEY) || new Map();
  const k9Count = new Map(); // agentId → βάρδιες Κ9 αυτής της εβδομάδας
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);
    for (let d = 0; d < 7; d++) {
      const e = plan.days[d];
      if (!e || e.type !== 'work' || e.reqLabel !== K9_LABEL) continue;
      k9Count.set(a.id, (k9Count.get(a.id) || 0) + 1);
      if (e.start !== K9_START || e.end !== K9_END) {
        bad(`${a.name}: βραδινή Κ9 ${w.dates[d]} με ωράριο ${e.start}-${e.end} — αναμενόμενο ${K9_START}-${K9_END}.`);
      }
      if (!eligK9.has(a.id)) {
        bad(`${a.name}: πήρε βραδινή Κ9 ${w.dates[d]} χωρίς να είναι στη λίστα — η σύνθεση της ομάδας ΑΛΛΑΞΕ.`);
      }
    }
  }
  // Αυστηρό εβδομαδιαίο όριο ανά εργαζόμενο (υπερισχύει κάθε προτίμησης)
  for (const [agentId, n] of k9Count) {
    const el = eligK9.get(agentId);
    if (!el) continue; // αναφέρθηκε ήδη παραπάνω ως εκτός λίστας
    if (n > el.maxPerWeek) {
      const ag = ctx.agents.find((x) => x.id === agentId);
      bad(`${ag ? ag.name : agentId}: ${n} βάρδιες Vega Bank αυτή την εβδομάδα — ΟΡΙΟ ${el.maxPerWeek}. ΥΠΕΡΒΑΣΗ αυστηρού περιορισμού.`);
    }
  }
  // Αν η βάρδια έμεινε ακάλυπτη ενώ τα όρια έχουν εξαντληθεί, ενημέρωσε τον
  // χρήστη — ΔΕΝ παραβιάζουμε όριο και ΔΕΝ προσθέτουμε αυθαίρετα άτομα.
  {
    const unc = w.report.uncovered.filter((u) => u.label === K9_LABEL).length;
    if (unc > 0 && eligK9.size > 0) {
      let capacity = 0;
      let used = 0;
      for (const [agentId, el] of eligK9) {
        capacity += el.maxPerWeek;
        used += k9Count.get(agentId) || 0;
      }
      // ΕΝΗΜΕΡΩΣΗ, όχι παράβαση: ξεχωριστό πρόθεμα ώστε το «καθαρό audit»
      // να σημαίνει «κανένας κανόνας δεν παραβιάστηκε»
      const note = (m) => w.report.soft.push(`ΕΝΗΜΕΡΩΣΗ Vega Bank: ${m}`);
      if (used >= capacity) {
        note(`${unc} ημέρες ακάλυπτες και τα εβδομαδιαία όρια ΕΞΑΝΤΛΗΘΗΚΑΝ (${used}/${capacity}). Δεν επαρκούν τα διαθέσιμα άτομα — χρειάζεται απόφαση (αύξηση ορίου ή προσθήκη ατόμου στη λίστα).`);
      } else {
        note(`${unc} ημέρες ακάλυπτες ενώ υπάρχει υπόλοιπο ορίων (${used}/${capacity}) — τα εμπόδισαν άλλοι κανόνες (ρεπό/11ωρο/6ήμερο).`);
      }
    }
  }
}

// ==================== ΦΑΣΗ 10: ΤΕΛΙΚΟΣ ΕΛΕΓΧΟΣ 6ΗΜΕΡΟΥ ====================
// (05/09/2026) Δίχτυ ασφαλείας ΠΡΙΝ βγει το πρόγραμμα: κανένας εργαζόμενος
// δεν πρέπει να καταλήγει με εξαήμερη εργασία. Ο έλεγχος γίνεται σε επίπεδο
// ΗΜΕΡΩΝ ΕΡΓΑΣΙΑΣ (όχι αριθμού βαρδιών — μια μέρα με σπαστό ωράριο μετρά
// ΜΙΑ φορά) και έχει δύο σκέλη:
//   α) ημέρες εργασίας μέσα στην εβδομάδα ≤ στόχο (Κ2: 5 μείον οι άδειες)
//   β) συνεχόμενες ημέρες εργασίας ≤ 5 (Κ10) ΜΑΖΙ με τις ημέρες που
//      κουβαλάει ο εργαζόμενος από την ΠΡΟΗΓΟΥΜΕΝΗ εβδομάδα (state.streak —
//      υπολογίζεται και από το Excel που ανεβάζει ο χρήστης, μέσω του
//      computeStateFromAssignments) και από την ΕΠΟΜΕΝΗ όταν είναι γνωστή.
// Ό,τι βρεθεί διορθώνεται αφαιρώντας ΜΟΝΟ βάρδιες που τοποθέτησε ο
// generator — τα σταθερά ωράρια (Κ5), οι άδειες και τα αιτήματα ρεπό δεν
// αγγίζονται. Αν δεν υπάρχει τίποτα αφαιρέσιμο, ο κανόνας ΔΕΝ παρακάμπτεται:
// το πρόβλημα αναφέρεται στον χρήστη μέσω του report (uncovered/soft).

// Αφαίρεση βάρδιας μέρας d → η μέρα γίνεται ρεπό. Επιστρέφει false αν η
// βάρδια είναι κλειδωμένη (σταθερό ωράριο/σπαστό/μοτίβο) ή δεν υπάρχει.
function dropShiftForSixDay(w, plan, d, reason) {
  const e = plan.days[d];
  if (!e || e.type !== 'work' || e.fixed) return false;

  plan.days[d] = { type: 'off', reason: 'repo' };
  if (e.location === 'home' && plan.teleworkDays > 0) plan.teleworkDays--;

  // Λογιστική που κρατιέται εκτός plan.days (μετρητές κατάστασης)
  const st = agentState(w, plan.agent.id);
  if (e.night) st.nights = Math.max(0, st.nights - 1);
  if (isK9Entry(e)) {
    st.count1903 = Math.max(0, st.count1903 - 1);
    plan.elig1903Used = Math.max(0, plan.elig1903Used - 1);
  }

  // Η θέση που άδειασε ξαναγίνεται ακάλυπτη απαίτηση (ορατό στο UI)
  if (e.reqLabel) {
    w.report.uncovered.push({
      date: w.dates[d], start: e.start, end: e.end, label: e.reqLabel, missing: 1
    });
  }
  w.report.soft.push(
    `6ήμερο: ${plan.agent.name} — αφαιρέθηκε η βάρδια ${w.dates[d]} ${e.start}-${e.end} (${reason}).`
  );
  return true;
}

// Σπάσιμο σειράς συνεχόμενων ημερών που τελειώνει στη μέρα lastDay:
// αφαιρείται ΜΙΑ βάρδια μέσα στη σειρά, ξεκινώντας από το τέλος και
// προτιμώντας τις βάρδιες συμπλήρωσης (fillers) έναντι αυτών που καλύπτουν
// δηλωμένη απαίτηση.
function cutSixDayStreak(w, plan, lastDay, reason) {
  let first = lastDay;
  while (first > 0 && countsAsWork(plan, first - 1)) first--;
  for (const fillersOnly of [true, false]) {
    for (let d = lastDay; d >= first; d--) {
      const e = plan.days[d];
      if (!e || e.type !== 'work' || e.fixed) continue;
      if (fillersOnly && !e.filler) continue;
      if (dropShiftForSixDay(w, plan, d, reason)) return true;
    }
  }
  return false;
}

// ==================== ΦΑΣΗ: ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ ΕΡΓΑΣΙΑΣ (15/11/2026) ====================
//
// ΜΟΝΟ ΑΝΑΦΟΡΑ — εκτελείται ΤΕΛΕΥΤΑΙΑ, αφού το πρόγραμμα έχει οριστικοποιηθεί.
// Δεν μετακινεί, δεν προσθέτει και δεν αφαιρεί καμία ανάθεση.
//
// Η αιτιολόγηση δεν είναι εικασία: καλεί τα ΙΔΙΑ predicates που χρησιμοποιεί
// ο canPlace (shiftAllowedByRules, k8ok, k10ok, λίστες επιλεξιμότητας), με την
// ΙΔΙΑ σειρά, ώστε ο λόγος που αναφέρεται να είναι ο πραγματικός φραγμός.
function wishBlocker(w, a, d, reqByDay, start, end) {
  const plan = w.plans.get(a.id);
  const date = w.dates[d];

  // Κ6: άδειες/ασθένεια/αίτημα ρεπό — υπερισχύουν ΑΠΟΛΥΤΑ του αιτήματος
  const to = w.ctx.timeOff.get(`${a.id}|${date}`);
  if (to === 'leave') return 'άδεια εκείνη την ημέρα (Κ6)';
  if (to === 'sick') return 'ασθένεια εκείνη την ημέρα (Κ6)';
  if (to === 'repo_request') return 'αίτημα ρεπό την ίδια ημέρα (Κ6) — αντικρουόμενες καταχωρήσεις';

  // Προσομοίωση: καθαρίζουμε προσωρινά τη μέρα ώστε οι έλεγχοι να κρίνουν το
  // ΑΙΤΟΥΜΕΝΟ ωράριο και όχι αυτό που τελικά μπήκε. Το finally επαναφέρει
  // πάντα την αρχική κατάσταση — το πρόγραμμα ΔΕΝ μεταβάλλεται.
  const saved = plan.days[d];
  plan.days[d] = null;
  try {
    if (start === '06:00' && end === '14:00') {
      const list = w.ctx.eligibility.get('06:00-14:00');
      if (list && list.size > 0 && !list.has(a.id)) return 'δεν ανήκει στη λίστα της βάρδιας 06:00-14:00';
    }
    if (start === K9_START && end === K9_END) {
      const k9 = w.ctx.eligibility.get(K9_ELIG_KEY);
      const inK9 = k9 && k9.has(a.id);
      if (!inK9 && !a.canNight) {
        return `η ${K9_START}-${K9_END} δίνεται μόνο από τη λίστα Κ9 ή σε όσους έχουν σήμανση νυχτερινής (Κ7/Κ9)`;
      }
    }
    if (isNight(start, end) && !a.canNight) return 'δεν έχει σήμανση για νυχτερινές βάρδιες (Κ7)';
    if (!shiftAllowedByRules(a, d, start, end, { date })) return 'ασυμβίβαστο με ατομικό κανόνα ή σταθερό ωράριο (Κ3/Κ5)';
    if (!k8ok(w, plan, d, start, end)) return 'θα άφηνε λιγότερες από 11 ώρες ανάπαυση (Κ8)';
    if (!k10ok(w, plan, d)) {
      // Εξήγησε ΠΟΘΕΝ προκύπτει η σειρά — συχνά κουβαλιέται από την
      // προηγούμενη εβδομάδα και ο χρήστης δεν το βλέπει στο φύλλο του.
      const st = agentState(w, a.id);
      let back = 0;
      for (let i = d - 1; i >= 0; i--) { if (countsAsWork(plan, i)) back++; else break; }
      const carried = (back === d && st.streak) ? st.streak : 0;
      const total = carried + back + 1;
      return `θα ήταν η ${total}η συνεχόμενη ημέρα εργασίας — εξαήμερο (Κ2/Κ10)` +
        (carried ? `· ${carried} ημέρα/ες μεταφέρονται από την προηγούμενη εβδομάδα` : '') +
        (back ? `, ${back} μέσα σε αυτή την εβδομάδα` : '');
    }
  } finally {
    plan.days[d] = saved;
  }

  // Υπήρχε θέση σε αυτό το ωράριο εκείνη την ημέρα;
  const fits = (reqByDay[d] || []).some((rq) => {
    if (rq.def.start === start && rq.def.end === end) return true;
    if (rq.def.period === 'morning' && isMorning(start, end)) return true;
    if (rq.def.period === 'afternoon' && isAfternoon(start)) return true;
    return false;
  });
  if (!fits && d >= 5) {
    return 'τα Σαββατοκύριακα καλύπτονται ΜΟΝΟ από τις θέσεις του πίνακα απαιτήσεων και δεν υπήρχε θέση σε αυτό το ωράριο';
  }
  if (!fits) return 'δεν υπήρχε απαίτηση κάλυψης σε αυτό το ωράριο εκείνη την ημέρα';

  // Κανένας φραγμός: η θέση απλώς δόθηκε σε άλλον, βάσει της υπάρχουσας
  // λογικής κατανομής — που κατά την προδιαγραφή υπερισχύει του αιτήματος.
  return 'η θέση δόθηκε σε άλλον υποψήφιο με υψηλότερη βαθμολογία (η υφιστάμενη λογική κατανομής προηγείται του αιτήματος)';
}

function phaseWishReport(w, reqByDay) {
  const list = w.ctx.wishes || [];
  if (!list.length) return;

  const dayIdx = new Map(w.dates.map((dt, i) => [dt, i]));
  // Μόνο τα αιτήματα που πέφτουν ΜΕΣΑ σε αυτή την εβδομάδα
  const mine = list.filter((x) => dayIdx.has(x.date));
  if (!mine.length) return;

  const entryFor = (agentId, date) => {
    const plan = w.plans.get(agentId);
    const i = dayIdx.get(date);
    if (!plan || i === undefined) return null;
    const e = plan.days[i];
    if (!e) return null;
    if (e.type === 'off') {
      const t = w.ctx.timeOff.get(`${agentId}|${date}`);
      return { type: 'off', offType: t || e.reason || 'repo' };
    }
    // Σπαστό ωράριο: κρίνεται με το ΠΡΩΤΟ του κομμάτι
    if (e.parts && e.parts.length) return { type: 'work', start: e.parts[0][0], end: e.parts[0][1], reqLabel: e.reqLabel };
    return { type: 'work', start: e.start, end: e.end, reqLabel: e.reqLabel };
  };

  const probe = (agentId, date, start, end) => {
    const a = w.ctx.agents.find((x) => x.id === agentId);
    const i = dayIdx.get(date);
    if (!a || i === undefined) return null;
    try {
      return wishBlocker(w, a, i, reqByDay, start, end);
    } catch {
      return null; // η αιτιολόγηση δεν πρέπει ΠΟΤΕ να ρίξει την παραγωγή
    }
  };

  const results = wish.evaluate(mine, entryFor, probe);
  w.report.wishes = results;

  const sum = wish.summarize(results);
  w.report.soft.push(
    `ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ: ${sum.satisfied} ικανοποιήθηκαν, ${sum.partial} μερικώς, ${sum.unsatisfied} όχι (σύνολο ${sum.total}).`
  );
}

function phaseSixDayAudit(w) {
  const { ctx } = w;
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);
    // Δηλωμένες εξαιρέσεις 6ημέρου (Οικονομου — 11/07/2026)
    if (rule(a, 'no_streak_limit') || rule(a, 'weekly_pattern')) continue;
    const st = agentState(w, a.id);

    // --- α) Ημέρες εργασίας μέσα στην εβδομάδα ---
    const target = workTarget(plan);
    for (let guard = 0; guard < 7; guard++) {
      const days = [];
      for (let d = 0; d < 7; d++) if (worked(plan, d)) days.push(d);
      if (days.length <= target) break;
      let cut = false;
      for (let i = days.length - 1; i >= 0 && !cut; i--) {
        cut = dropShiftForSixDay(
          w, plan, days[i],
          `${days.length} ημέρες εργασίας στην εβδομάδα, όριο ${target}`
        );
      }
      if (!cut) {
        w.report.soft.push(
          `ΠΡΟΣΟΧΗ 6ήμερο: ${a.name} — ${days.length} ημέρες εργασίας (όριο ${target}) και όλες οι βάρδιες είναι κλειδωμένες (σταθερό ωράριο/μοτίβο). Χρειάζεται χειροκίνητη διόρθωση.`
        );
        break;
      }
    }

    // --- β) Συνεχόμενες ημέρες, με τα σύνορα των γειτονικών εβδομάδων ---
    // carry = ημέρες που κλείνει η ΠΡΟΗΓΟΥΜΕΝΗ εβδομάδα (και όταν αυτή έχει
    // εισαχθεί από Excel), lead = ημέρες που ανοίγει η ΕΠΟΜΕΝΗ όταν είναι γνωστή.
    const carry = st.streak || 0;
    const lead = leadingLeaveNextWeek(w, a.id);
    for (let guard = 0; guard < 14; guard++) {
      let run = carry;
      let over = -1;
      let len = 0;
      for (let d = 0; d < 7; d++) {
        if (!countsAsWork(plan, d)) { run = 0; continue; }
        run++;
        if (run > MAX_STREAK) { over = d; len = run; break; }
      }
      // Η σειρά που κλείνει την Κυριακή συνεχίζεται στην επόμενη εβδομάδα
      if (over === -1 && run > 0 && lead > 0 && run + lead > MAX_STREAK) {
        over = 6;
        len = run + lead;
      }
      if (over === -1) break;

      const reason = `${len} συνεχόμενες ημέρες εργασίας μαζί με τη γειτονική εβδομάδα, όριο ${MAX_STREAK}`;
      if (!cutSixDayStreak(w, plan, over, reason)) {
        // Σειρά που αποτελείται αποκλειστικά από άδειες/ασθένεια (μετράνε ως
        // εργάσιμες για το Κ10) δεν είναι εξαήμερη ΕΡΓΑΣΙΑ — δεν αναφέρεται.
        let hasWork = false;
        for (let d = over; d >= 0 && countsAsWork(plan, d); d--) {
          if (worked(plan, d)) { hasWork = true; break; }
        }
        if (hasWork) {
          w.report.soft.push(
            `ΠΡΟΣΟΧΗ 6ήμερο: ${a.name} — ${len} συνεχόμενες ημέρες εργασίας (όριο ${MAX_STREAK}, μαζί με την προηγούμενη/επόμενη εβδομάδα) και δεν υπάρχει βάρδια που να μπορεί να αφαιρεθεί (σταθερά ωράρια/άδειες). Χρειάζεται χειροκίνητη διόρθωση.`
          );
        }
        break;
      }
    }

    // --- γ) ΔΙΑΓΝΩΣΗ ΠΕΡΙΤΤΩΝ ΡΕΠΟ (28/09/2026) ---
    // Όποιος έμεινε κάτω από τις εργάσιμές του παίρνει αναγκαστικά 3ο ρεπό.
    // Δεν «διορθώνεται» με το ζόρι (θα έσπαγε το 6ήμερο ή το ΣΚ MAX) — αλλά
    // ΕΞΗΓΕΙΤΑΙ, ώστε ο χρήστης να βλέπει αν φταίει η συνέχεια της
    // προηγούμενης εβδομάδας, τα βράδια, ή άδειες/σταθερά ρεπό.
    const deficit = workTarget(plan) - assignedCount(plan);
    if (deficit > 0) {
      const causes = [];
      if (carry > 0) {
        causes.push(`ήρθε με ${carry} συνεχόμενες ημέρες από την προηγούμενη εβδομάδα (μπορεί να δουλέψει το πολύ ${MAX_STREAK - carry} σερί από Δευτέρα)`);
      }
      const nights = plan.days.filter((e) => e && e.type === 'work' && e.night).length;
      const nightRest = plan.days.filter((e) => e && e.type === 'off' && e.reason === 'night_rest').length;
      if (nights > 0) causes.push(`${nights} νυχτερινή/ές + ${nightRest} υποχρεωτική/ές ανάπαυση/εις`);
      const fixedOff = plan.days.filter((e) => e && e.type === 'off' && e.reason === 'fixed_off').length;
      if (fixedOff > 0) causes.push(`${fixedOff} σταθερό/ά ρεπό`);
      const req = plan.days.filter((e) => e && e.type === 'off' && e.reason === 'repo_request').length;
      if (req > 0) causes.push(`${req} αίτημα/τα ρεπό`);
      if (plan.leaveDays > 0) causes.push(`${plan.leaveDays} ημέρες άδειας/ασθένειας`);
      const wkndFree = [5, 6].filter((d) => {
        const e = plan.days[d];
        return e && e.type === 'off' && e.reason === 'repo';
      }).length;
      if (wkndFree > 0) causes.push(`${wkndFree} ημέρα/ες ΣΚ χωρίς ελεύθερη θέση στον πίνακα απαιτήσεων (ΣΚ MAX)`);
      w.report.soft.push(
        `Περιττό ρεπό: ${a.name} — ${assignedCount(plan)}/${workTarget(plan)} εργάσιμες. Αιτία: ${causes.length ? causes.join(' · ') : 'δεν βρέθηκε επιτρεπτό ωράριο στις ελεύθερες ημέρες'}.`
      );
    }
  }
}

// Τελική κατάσταση εβδομάδας → αρχική της επόμενης
function computeNextState(w) {
  const { ctx } = w;
  const next = {};
  for (const a of ctx.agents) {
    const plan = w.plans.get(a.id);
    const st = agentState(w, a.id);

    // Streak: συνεχόμενες εργάσιμες μέχρι και την Κυριακή — η άδεια/ασθένεια
    // μετράει ως εργάσιμη (13/07/2026)
    let streak = 0;
    for (let d = 6; d >= 0; d--) {
      if (countsAsWork(plan, d)) streak++;
      else break;
    }
    if (streak === 7) streak += st.streak; // ολόκληρη εβδομάδα (π.χ. πλήρης άδεια) — συνεχίζει από την προηγούμενη

    // Λήξη τελευταίας βάρδιας
    let lastEndAbs = st.lastEndAbs;
    for (let d = 0; d < 7; d++) {
      const abs = entryAbs(w, plan, d);
      if (abs) lastEndAbs = Math.max(lastEndAbs, abs.endAbs);
    }

    // ΣΚ που δούλεψε
    let wknd = 0;
    for (const d of [5, 6]) if (worked(plan, d)) wknd++;

    // Μετρητής 06:00-14:00 (δίκαιη εναλλαγή λίστας — 12/07/2026)
    let count62 = st.count62 || 0;
    for (let d = 0; d < 7; d++) {
      const e = plan.days[d];
      if (e && e.type === 'work' && e.start === '06:00' && e.end === '14:00') count62++;
    }

    // Μετρητής Κυριακών ανά μήνα (όριο 2/μήνα — 11/07/2026)
    const sundays = { ...(st.sundays || {}) };
    // Μετρητής ΡΕΠΟ Κυριακής (sunday_worker: το πολύ 1/μήνα — 12/07/2026)
    const sundaysOff = { ...(st.sundaysOff || {}) };
    const mk = w.dates[6].slice(0, 7);
    if (worked(plan, 6)) {
      sundays[mk] = (sundays[mk] || 0) + 1;
    } else {
      const e = plan.days[6];
      const isLeave = e && e.type === 'off' && (e.reason === 'leave' || e.reason === 'sick');
      if (!isLeave) sundaysOff[mk] = (sundaysOff[mk] || 0) + 1;
    }
    // Κράτα μόνο τους 3 πιο πρόσφατους μήνες
    for (const k of Object.keys(sundays).sort().slice(0, -3)) delete sundays[k];
    for (const k of Object.keys(sundaysOff).sort().slice(0, -3)) delete sundaysOff[k];

    next[a.id] = {
      streak,
      lastEndAbs,
      nights: st.nights,
      weekends: st.weekends + wknd,
      count1903: st.count1903,
      count62,
      sundays,
      sundaysOff,
      pendingNightRest: plan.pendingNightRest || 0,
      rizouMode: rule(a, 'weekly_alternation')
        ? (assignedCount(plan) > 0 ? (st.rizouMode === 'morning' ? 'afternoon' : 'morning') : st.rizouMode)
        : st.rizouMode
    };
  }
  return next;
}

// Εξαγωγή αναθέσεων εβδομάδας σε επίπεδη λίστα (για DB/preview/export)
function exportAssignments(w) {
  const out = [];
  for (const a of w.ctx.agents) {
    const plan = w.plans.get(a.id);
    for (let d = 0; d < 7; d++) {
      const e = plan.days[d];
      if (!e) continue;
      if (e.type === 'off') {
        out.push({ agentId: a.id, agentName: a.name, date: w.dates[d], off: true, reason: e.reason });
      } else if (e.parts) {
        for (const [ps, pe] of e.parts) {
          out.push({
            agentId: a.id, agentName: a.name, date: w.dates[d],
            start: ps, end: pe, skill: e.skill || null, label: e.label,
            reqLabel: e.reqLabel || null, color: e.color || null, roleId: e.roleId || null,
            location: e.location || 'office'
          });
        }
      } else {
        out.push({
          agentId: a.id, agentName: a.name, date: w.dates[d],
          start: e.start, end: e.end, skill: e.skill || null, label: e.label || null,
          reqLabel: e.reqLabel || null, color: e.color || null, roleId: e.roleId || null,
          roleName: e.roleName || null,
          location: e.location || 'office', night: e.night || false
        });
      }
    }
  }
  return out;
}

// ==================== ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ ΕΒΔΟΜΑΔΑΣ ====================
function generateWeek(ctx, weekStart, state, opts = {}) {
  const w = newWeek(ctx, weekStart, state);
  // Συνεχόμενες μέρες στην αρχή της ΕΠΟΜΕΝΗΣ εβδομάδας όταν είναι γνωστή
  // (εισηγμένη από Excel) — για τον εμπρόσθιο έλεγχο Κ10
  w.nextLead = opts.nextLead || null;
  // Πρώτη έναρξη κάθε agent στην εισηγμένη επόμενη εβδομάδα — εμπρόσθιο Κ8
  w.nextFirstStart = opts.nextFirstStart || null;

  // Απαιτήσεις ανά μέρα με μετρητή κάλυψης
  const reqByDay = [];
  const nightReqByDay = [];
  for (let d = 0; d < 7; d++) {
    const defs = ctx.requirements[d >= 5 ? 'weekend' : 'weekday'];
    reqByDay.push(defs.map((def) => ({ def, covered: 0 })));
    // Η «Νυχτερινή Atlas» ξεχωρίζει από τη βραδινή Κ9 με ΕΤΙΚΕΤΑ: από
    // 14/11/2026 έχουν ΙΔΙΕΣ ώρες (23:00-07:00), άρα η παλιά αναζήτηση με
    // start === '23:00' θα έπιανε κατά λάθος τη λάθος απαίτηση.
    nightReqByDay.push(reqByDay[d].find((r) => r.def.start === '23:00' && !isK9Req(r.def)) || null);
  }

  phaseLock(w);          // Κ5, Κ6, σταθερά ρεπό
  phaseS1(w);            // Σ1 + κανόνες σχολής (Κ3)
  phaseNights(w, nightReqByDay); // Κ4, Κ7, Σ3 + υποχρεωτική ανάπαυση
  phase1903(w, reqByDay, { firstPass: true }); // Κ9 pass A: κράτηση θέσης ΠΡΩΤΑ
  // ΣΚ MIN (15/07/2026): οι θέσεις του Σαββατοκύριακου γεμίζουν ΠΡΙΝ τα
  // ρεπό — εξασφαλισμένη κάλυψη, οι «αναγκεμένοι» (με υποχρεωτικά ρεπό
  // καθημερινής) παίρνουν τις θέσεις, και οι υπόλοιποι καθαρά Σαβ+Κυρ ρεπό
  phaseRequirements(w, reqByDay, { days: [5, 6] });
  phaseOffs(w, reqByDay); // ρεπό: Σ2, Σ3, Κ10
  phaseRequirements(w, reqByDay, { days: [0, 1, 2, 3, 4] }); // Κ1 καθημερινές
  phase1903(w, reqByDay); // Κ9 pass B: ό,τι έμεινε ακάλυπτο
  phaseFillers(w, reqByDay); // Κ2: όλοι στις 5 εργάσιμες
  phaseK4(w);            // οριστικοποίηση 23:00/23:30
  phaseSixDayAudit(w);   // ΤΕΛΙΚΟΣ έλεγχος 6ημέρου (Κ2/Κ10 + προηγούμενη εβδομάδα)
  phasePairReport(w);    // Σ5 αναφορά + κοινή βάρδια ζεύγους
  phaseRulesAudit(w);    // ΤΕΛΙΚΟ validation νέων κανόνων (14/11/2026)
  phaseWishReport(w, reqByDay); // ΑΝΑΦΟΡΑ επιθυμητών ωρών (15/11/2026) — καμία μεταβολή

  const nextState = computeNextState(w);
  return {
    weekStart,
    dates: w.dates,
    assignments: exportAssignments(w),
    report: w.report,
    nextState
  };
}

module.exports = {
  generateWeek, shiftAllowedByRules, rule, deptMatch, wishBlocker,
  REST_MIN, REST_MIN_SPLIT, MAX_STREAK, FILLER_MORNING, FILLER_AFTERNOON,
  K9_START, K9_END, K9_LABEL, K9_ELIG_KEY, NIGHT_LABEL, isK9Req, isK9Entry
};
