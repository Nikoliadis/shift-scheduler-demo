// Test script generator (ΒΗΜΑ 4): παράγει ΟΛΟΚΛΗΡΟ μήνα στην κονσόλα και
// ελέγχει αυτόματα:
//   1. Κανένα 6ήμερο (Κ10) — και στα σύνορα εβδομάδων
//   2. Κανένα σπάσιμο 11ώρου (Κ8) — και στα σύνορα εβδομάδων
//      (εξαίρεση: σπαστό Νικολαου 24:00→09:00 = 9h, δηλωμένο σταθερό Κ5)
//   3. 2 ρεπό/εβδομάδα και μέγιστο 5 εργάσιμες για ΟΛΟΥΣ (Κ2)
//   4. Όλα τα σταθερά ωράρια στη θέση τους (Κ5)
//   5. Νυχτερινές μόνο από επιτρεπόμενους (Κ7) + βραδινή Κ9 23:00-07:00 μόνο από λίστα με όρια (Κ9)
//   6. Κανόνες Γεωργιου/Γεωργιου Ρενα (Κ3): μόνο πρωί, μέρες σχολής
//   7. Νέοι κανόνες 14/11/2026: Vega Bank 23:00-07:00 (ίδια άτομα), Γεωργιου
//      χωρίς 06:00-14:00 στα ΣΚ, σταθερά προγράμματα Οικονομου, κοινή
//      βάρδια Βασιλακη/Δημακη
// Τυπώνει PASS/FAIL ανά έλεγχο.
//
// Χρήση: node scripts/test_generator.js [YYYY-MM]   (default: 2026-07)
const { generatePeriod } = require('../src/scheduler');
const { weeksCovering, monthBounds, dayOfWeek, addDays } = require('../src/utils/dates');
const { shiftAbs, toMin, isMorning } = require('../src/scheduler/time');
const pool = require('../src/db/pool');

const month = process.argv[2] || '2026-07';
const DAY_GR = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];

let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (cond || !detail ? '' : '\n       ' + detail));
  if (!cond) failures++;
}

// (14/11/2026) Η βραδινή Κ9 («Vega Bank») είναι πλέον 23:00-07:00 — ΙΔΙΕΣ
// ώρες με τη «Νυχτερινή Atlas». Ξεχωρίζουν ΜΟΝΟ από το reqLabel.
const K9_LABEL = 'Verification & call υπόλοιπα';
const isK9 = (a) => !a.off && a.start === '23:00' && a.end === '07:00' && a.reqLabel === K9_LABEL;
// «Νυχτερινή» για Κ7 και για τα όρια βραδιών — η βραδινή Κ9 ΔΕΝ μετράει
const isNightRow = (a) => !a.off && !isK9(a) &&
  (a.start === '23:00' || a.start === '23:30') && toMin(a.end) < toMin(a.start);

(async () => {
  const { from, to } = monthBounds(month);
  const weeks = weeksCovering(from, to);
  console.log(`\n=== Παραγωγή προγράμματος: ${month} → ${weeks.length} εβδομάδες (${weeks[0].start} … ${weeks[weeks.length - 1].end}) ===\n`);

  const t0 = Date.now();
  const result = await generatePeriod(weeks);
  console.log(`(χρόνος παραγωγής: ${Date.now() - t0}ms)\n`);

  // Φόρτωση agents για ονόματα/έλεγχο
  const [agents] = await pool.query('SELECT id, full_name FROM agents WHERE active = 1');
  const nameOf = Object.fromEntries(agents.map((a) => [a.id, a.full_name]));
  const idOf = Object.fromEntries(agents.map((a) => [a.full_name, a.id]));
  const [eligRows] = await pool.query('SELECT agent_id, max_per_week FROM shift_eligibility');
  const eligMax = Object.fromEntries(eligRows.map((e) => [e.agent_id, e.max_per_week]));
  // Σταθερά ωράρια (Κ5) όπως είναι ΤΩΡΑ στη βάση — επεξεργάσιμα από την οθόνη
  // Εργαζομένων, γι' αυτό δεν γράφονται σταθερά μέσα στο test
  const [fixedAgents] = await pool.query(
    `SELECT full_name, fixed_shift_start, fixed_shift_end, fixed_days FROM agents
     WHERE active = 1 AND fixed_shift_start IS NOT NULL AND fixed_days IS NOT NULL`
  );

  // ---------- Εκτύπωση προγράμματος ----------
  for (const wk of [...result.weeks]) {
    console.log(`\n──────── Εβδομάδα ${wk.weekStart} ────────`);
    const byAgent = new Map();
    for (const a of wk.assignments) {
      if (!byAgent.has(a.agentId)) byAgent.set(a.agentId, new Array(7).fill(''));
      const d = wk.dates.indexOf(a.date);
      const cell = a.off
        ? (a.reason === 'leave' ? 'ΑΔΕΙΑ' : a.reason === 'sick' ? 'ΑΣΘΕΝ' : 'ΡΕΠΟ')
        : `${a.start}-${a.end}${a.label ? '*' : ''}`;
      byAgent.get(a.agentId)[d] = byAgent.get(a.agentId)[d] ? byAgent.get(a.agentId)[d] + '+' + cell : cell;
    }
    const names = [...byAgent.keys()].sort((x, y) => (nameOf[x] || '').localeCompare(nameOf[y] || '', 'el'));
    for (const id of names) {
      const row = byAgent.get(id).map((c) => (c || '—').padEnd(13)).join('');
      console.log(String(nameOf[id] || `agent#${id}(ανενεργός)`).padEnd(30) + row);
    }
    if (wk.report.uncovered.length) {
      console.log('  ΑΚΑΛΥΠΤΑ: ' + wk.report.uncovered.map((u) => `${u.date} ${u.start}-${u.end} ${u.label}`).join(' | '));
    }
    if (wk.report.soft.length) {
      console.log('  SOFT: ' + wk.report.soft.join(' | '));
    }
  }

  // ---------- Συγκέντρωση αναθέσεων ----------
  // Οι ΕΙΣΗΓΜΕΝΕΣ από Excel εβδομάδες είναι εξωτερική πραγματικότητα
  // (κρατιούνται ως έχουν) — ΔΕΝ ελέγχονται ως προϊόν του generator, αλλά
  // μετράνε στα ΣΥΝΟΡΑ (Κ8/Κ10 προς τις παραγόμενες εβδομάδες).
  const genWeeks = result.weeks.filter((w) => !(w.report && w.report.imported));
  const genDates = new Set(genWeeks.flatMap((w) => w.dates));
  if (genWeeks.length < result.weeks.length) {
    console.log(`\n(${result.weeks.length - genWeeks.length} εβδομάδες εισηγμένες από Excel — ελέγχονται μόνο ως σύνορα)`);
  }
  const workRows = []; // ΜΟΝΟ παραγόμενες εβδομάδες
  const offRows = [];
  const allWorkRows = []; // όλες (για ελέγχους συνόρων)
  for (const wk of [...result.weeks]) {
    const imported = wk.report && wk.report.imported;
    for (const a of wk.assignments) {
      if (a.off) {
        if (!imported) offRows.push(a);
      } else {
        allWorkRows.push(a);
        if (!imported) workRows.push(a);
      }
    }
  }

  console.log('\n=== ΑΥΤΟΜΑΤΟΙ ΕΛΕΓΧΟΙ ===\n');

  // ---------- 1. Κ10: κανένα 6ήμερο (σε ΟΛΗ την περίοδο, με σύνορα) ----------
  // Εξαίρεση (11/07/2026): οι δύο Οικονομου δεν έχουν όριο 6ημέρου
  {
    const k10Exempt = new Set([idOf['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ'], idOf['ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ']]);
    const daysWorked = new Map(); // agentId → Set(dates) — ΟΛΕΣ οι εβδομάδες (σύνορα)
    const reallyWorked = new Set(); // agentId|date ΜΟΝΟ για πραγματικές βάρδιες
    for (const a of allWorkRows) {
      if (k10Exempt.has(a.agentId)) continue;
      if (!daysWorked.has(a.agentId)) daysWorked.set(a.agentId, new Set());
      daysWorked.get(a.agentId).add(a.date);
      reallyWorked.add(`${a.agentId}|${a.date}`);
    }
    // Η άδεια/ασθένεια μετράει ως ΕΡΓΑΣΙΜΗ για το Κ10 (13/07/2026)
    for (const a of offRows) {
      if (a.reason !== 'leave' && a.reason !== 'sick') continue;
      if (k10Exempt.has(a.agentId)) continue;
      if (!daysWorked.has(a.agentId)) daysWorked.set(a.agentId, new Set());
      daysWorked.get(a.agentId).add(a.date);
    }
    // Παράβαση μόνο αν η σειρά αγγίζει ΠΑΡΑΓΟΜΕΝΗ εβδομάδα — σειρές εξ
    // ολοκλήρου μέσα σε εισηγμένο πρόγραμμα είναι εξωτερική πραγματικότητα
    let bad = null;
    for (const [id, dates] of daysWorked) {
      const sorted = [...dates].sort();
      let run = 1;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + 'T12:00:00');
        const cur = new Date(sorted[i] + 'T12:00:00');
        if ((cur - prev) / 86400000 === 1) {
          run++;
          if (run > 5) {
            const runDates = sorted.slice(i - run + 1, i + 1);
            // Παράβαση ΜΟΝΟ αν ΔΟΥΛΕΨΕ την 6η ή μεταγενέστερη μέρα της σειράς.
            // Σειρά μόνο από ΑΔΕΙΑ (π.χ. 17 μέρες διακοπές) ΔΕΝ είναι εξαήμερο
            // εργασίας — η άδεια συνεχίζει τη σειρά για το Κ10, αλλά κανείς
            // δεν δούλεψε. Χωρίς αυτό ο έλεγχος έβγαζε false positive και
            // έκρυβε τα πραγματικά εξαήμερα μέσα στον θόρυβο.
            const workedLate = runDates.slice(5).some((dd) => reallyWorked.has(`${id}|${dd}`));
            if (workedLate && runDates.some((dd) => genDates.has(dd))) {
              bad = `${nameOf[id]}: 6+ συνεχόμενες μέρες έως ${sorted[i]}`;
              break;
            }
          }
        } else {
          run = 1;
        }
      }
      if (bad) break;
    }
    check('Κ10: κανένα 6ήμερο σε όλη την περίοδο (και στα σύνορα εβδομάδων)', !bad, bad);
  }

  // ---------- 2. Κ8: 11ωρο παντού (σύνορα εβδομάδων συμπεριλαμβάνονται) ----------
  {
    const koulId = idOf['ΙΑΣΟΝΑΣ ΜΑΝΟΛΗΣ'];
    // Ενοποίηση σπαστών (ίδιος agent, ίδια μέρα) σε ένα διάστημα — ΟΛΕΣ οι
    // εβδομάδες, αλλά παράβαση μόνο όταν αγγίζει ΠΑΡΑΓΟΜΕΝΗ μέρα
    const merged = new Map(); // agentId|date → {startAbs, endAbs}
    for (const a of allWorkRows) {
      const abs = shiftAbs(a.date, a.start, a.end);
      const key = `${a.agentId}|${a.date}`;
      const cur = merged.get(key);
      if (cur) {
        cur.startAbs = Math.min(cur.startAbs, abs.startAbs);
        cur.endAbs = Math.max(cur.endAbs, abs.endAbs);
      } else {
        merged.set(key, { agentId: a.agentId, date: a.date, ...abs });
      }
    }
    const byAgent = new Map();
    for (const m of merged.values()) {
      if (!byAgent.has(m.agentId)) byAgent.set(m.agentId, []);
      byAgent.get(m.agentId).push(m);
    }
    let bad = null;
    let koulNote = false;
    for (const [id, list] of byAgent) {
      list.sort((x, y) => x.startAbs - y.startAbs);
      const minRest = id === koulId ? 9 * 60 : 11 * 60;
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].startAbs - list[i - 1].endAbs;
        if (gap < minRest && (genDates.has(list[i].date) || genDates.has(list[i - 1].date))) {
          bad = `${nameOf[id]}: ανάπαυση ${(gap / 60).toFixed(1)}h (${list[i - 1].date} → ${list[i].date})`;
          break;
        }
        if (id === koulId && gap < 11 * 60) koulNote = true;
      }
      if (bad) break;
    }
    check('Κ8: ανάπαυση ≥ 11h παντού (εξαίρεση: σπαστό Νικολαου ≥ 9h βάσει Κ5)', !bad, bad);
    if (koulNote) console.log('       (σημ.: το σπαστό του Νικολαου δίνει 9h 24:00→09:00 — δηλωμένο σταθερό ωράριο)');
  }

  // ---------- 3. Κ2: ≤5 εργάσιμες & ≥2 ρεπό ανά εβδομάδα για όλους ----------
  {
    let bad = null;
    for (const wk of genWeeks) {
      const workDays = new Map();
      const offDays = new Map();
      const leaveDays = new Map();
      for (const a of wk.assignments) {
        const map = a.off ? (a.reason === 'leave' || a.reason === 'sick' ? leaveDays : offDays) : workDays;
        if (!map.has(a.agentId)) map.set(a.agentId, new Set());
        map.get(a.agentId).add(a.date);
      }
      // Εξαίρεση Κ2: οι Οικονομου με καλοκαιρινό weekly_pattern (11/07/2026 —
      // ο Πετρος δουλεύει 7/7 χωρίς ρεπό)
      const k2Exempt = new Set([idOf['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ'], idOf['ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ']]);
      for (const ag of agents) {
        const wcount = (workDays.get(ag.id) || new Set()).size;
        const ocount = (offDays.get(ag.id) || new Set()).size;
        const lcount = (leaveDays.get(ag.id) || new Set()).size;
        if (!k2Exempt.has(ag.id)) {
          if (wcount > 5) { bad = `${ag.full_name} εβδ. ${wk.weekStart}: ${wcount} εργάσιμες`; break; }
          if (ocount + lcount < 2 && wcount + ocount + lcount === 7) { bad = `${ag.full_name} εβδ. ${wk.weekStart}: μόνο ${ocount} ρεπό`; break; }
        }
        if (wcount + ocount + lcount !== 7) { bad = `${ag.full_name} εβδ. ${wk.weekStart}: ${wcount}+${ocount}+${lcount} ≠ 7 μέρες`; break; }
      }
      if (bad) break;
    }
    check('Κ2: μέγιστο 5 εργάσιμες, τουλάχιστον 2 ρεπό (εκτός Οικονομου), 7 μέρες λογαριασμένες', !bad, bad);
  }

  // ---------- 4. Κ5: σταθερά ωράρια στη θέση τους ----------
  {
    // (14/11/2026) Τα σταθερά ωράρια διαβάζονται ΑΠΟ ΤΗ ΒΑΣΗ, όχι από
    // hardcoded λίστα: ο προϊστάμενος τα αλλάζει από την οθόνη Εργαζομένων,
    // και μια σταθερή λίστα έβγαζε ψευδή αποτυχία μόλις άλλαζε κάποιο.
    const fixedChecks = fixedAgents.map((a) => ({
      name: a.full_name, days: JSON.parse(a.fixed_days), start: a.fixed_shift_start, end: a.fixed_shift_end
    }));
    let bad = null;
    const workIdx = new Map(); // agentId|date → [rows]
    for (const a of workRows) {
      const k = `${a.agentId}|${a.date}`;
      if (!workIdx.has(k)) workIdx.set(k, []);
      workIdx.get(k).push(a);
    }
    const offIdx = new Set(offRows.map((o) => `${o.agentId}|${o.date}`));

    outer:
    for (const fc of fixedChecks) {
      const id = idOf[fc.name];
      for (const wk of genWeeks) {
        for (const date of wk.dates) {
          if (!fc.days.includes(dayOfWeek(date))) continue;
          const rows = workIdx.get(`${id}|${date}`) || [];
          const okRow = rows.some((r) => r.start === fc.start && r.end === fc.end);
          const isOff = offIdx.has(`${id}|${date}`);
          if (!okRow && !isOff) { bad = `${fc.name} ${date}: δεν βρέθηκε ${fc.start}-${fc.end}`; break outer; }
        }
      }
    }
    check('Κ5: σταθερά ωράρια (Ζερβα, Αργυρου, Παπανικολαου, Ξενος, Φλωρου, Αλεξακη)', !bad, bad);

    // Φραγκου: ρεπό Δευ+Τρι, ΣΚ 16:00-24:00 — μέρες με άδεια/αίτημα ή
    // ρεπό-προστασίας Κ10 δικαιολογούνται
    const aggId = idOf['ΦΡΑΓΚΟΥ ΓΕΩΡΓΙΑ'];
    let aggBad = null;
    for (const wk of genWeeks) {
      for (const date of wk.dates) {
        const dow = dayOfWeek(date);
        if (dow <= 2 && !offIdx.has(`${aggId}|${date}`)) aggBad = `${date}: δεν έχει ρεπό (Δευ/Τρι)`;
        if (dow >= 6) {
          const rows = workIdx.get(`${aggId}|${date}`) || [];
          const ok = rows.some((r) => r.start === '16:00' && r.end === '24:00') || offIdx.has(`${aggId}|${date}`);
          if (!ok) aggBad = `${date}: λείπει ΣΚ 16:00-24:00`;
        }
      }
    }
    check('Κ5/constraints: Φραγκου — ρεπό Δευ+Τρι, ΣΚ 16:00-24:00 (με δικαιολογημένες απουσίες)', !aggBad, aggBad);

    // (14/11/2026) Τα καλοκαιρινά weekly_pattern των Οικονομου
    // ΚΑΤΑΡΓΗΘΗΚΑΝ και αντικαταστάθηκαν από weekly_schedule. Οι νέοι τους
    // κανόνες ελέγχονται αναλυτικά στην ενότητα 13 — εδώ μένει μόνο ο
    // έλεγχος ότι ΔΕΝ επανεμφανίζεται κάποιο ωράριο του παλιού μοτίβου.
    {
      const OLD_SHIFTS = ['18:00-24:00', '13:00-21:00', '20:00-24:00', '18:00-22:00', '15:00-23:00'];
      let oldBad = null;
      for (const name of ['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ', 'ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ']) {
        const id = idOf[name];
        const hit = workRows.find((r) => r.agentId === id && OLD_SHIFTS.includes(`${r.start}-${r.end}`));
        if (hit) { oldBad = `${name}: ${hit.date} ${hit.start}-${hit.end} (παλιό καλοκαιρινό μοτίβο)`; break; }
      }
      check('Οικονομου: κανένα ωράριο του καταργημένου καλοκαιρινού μοτίβου', !oldBad, oldBad);
    }

    // Νικολαου: σπαστό 09-14 + 21-24 καθημερινές, ΣΚ ρεπό
    const koulId = idOf['ΙΑΣΟΝΑΣ ΜΑΝΟΛΗΣ'];
    let koulBad = null;
    for (const wk of genWeeks) {
      for (const date of wk.dates) {
        const dow = dayOfWeek(date);
        const rows = workIdx.get(`${koulId}|${date}`) || [];
        if (dow <= 5) {
          const hasParts = rows.some((r) => r.start === '09:00' && r.end === '14:00') &&
            rows.some((r) => r.start === '21:00' && r.end === '24:00');
          if (!hasParts && !offIdx.has(`${koulId}|${date}`)) koulBad = `${date}: λείπει το σπαστό`;
        } else if (rows.length) {
          koulBad = `${date}: δουλεύει ΣΚ`;
        }
      }
    }
    check('Constraints: Νικολαου — σπαστό 09:00-14:00 + 21:00-24:00 καθημερινές, ΣΚ ρεπό', !koulBad, koulBad);
  }

  // ---------- 5. Κ7/Κ9: νυχτερινές & βραδινή Κ9 (23:00-07:00) ----------
  {
    // Δυναμικά από τη βάση: νυχτερινή επιτρέπεται ΜΟΝΟ με can_night=1 + skill
    // ATLAS (ό,τι ισχύει τη στιγμή του τεστ — επεξεργάσιμο από οθόνη Agents)
    const [nightRows] = await pool.query(
      `SELECT DISTINCT a.id FROM agents a
       JOIN agent_skills ask ON ask.agent_id = a.id
       JOIN skills s ON s.id = ask.skill_id
       WHERE a.active = 1 AND a.can_night = 1 AND s.name = 'ATLAS'`
    );
    const nightOk = new Set(nightRows.map((r) => r.id));
    let bad = null;
    for (const a of workRows) {
      if (isNightRow(a)) {
        if (!nightOk.has(a.agentId)) { bad = `${nameOf[a.agentId]} πήρε νυχτερινή ${a.date}`; break; }
      }
    }
    check(`Κ7: νυχτερινές ΜΟΝΟ από agents με can_night + ATLAS (${nightRows.length} επιλέξιμοι)`, !bad, bad);

    let bad19 = null;
    const usage = new Map(); // week|agent → count
    for (const wk of genWeeks) {
      for (const a of wk.assignments) {
        if (isK9(a)) {
          if (eligMax[a.agentId] === undefined) { bad19 = `${nameOf[a.agentId]} εκτός λίστας πήρε βραδινή Κ9 (${a.date})`; break; }
          const k = `${wk.weekStart}|${a.agentId}`;
          usage.set(k, (usage.get(k) || 0) + 1);
          if (usage.get(k) > eligMax[a.agentId]) { bad19 = `${nameOf[a.agentId]} ξεπέρασε το όριο (${usage.get(k)}>${eligMax[a.agentId]}) εβδ. ${wk.weekStart}`; break; }
        }
      }
      if (bad19) break;
    }
    check('Κ9: βραδινή 23:00-07:00 μόνο από τη λίστα, εντός ορίων/εβδομάδα', !bad19, bad19);

    // (14/11/2026) Η βραδινή Κ9 έχει ΤΟ ΝΕΟ ωράριο και ΤΑ ΙΔΙΑ άτομα:
    // καμία ανάθεση δεν πρέπει να έχει μείνει στο παλιό 19:00-03:00
    const old1903 = workRows.filter((a) => a.start === '19:00' && a.end === '03:00');
    check('Vega Bank: καμία βάρδια 19:00-03:00 (άλλαξε σε 23:00-07:00)', old1903.length === 0,
      old1903.length ? `${old1903.length} αναθέσεις ακόμα στο παλιό ωράριο (π.χ. ${nameOf[old1903[0].agentId]} ${old1903[0].date})` : null);
    const k9Rows = workRows.filter((a) => isK9(a));
    const k9Outsiders = k9Rows.filter((a) => eligMax[a.agentId] === undefined);
    check(`Vega Bank 23:00-07:00: ${k9Rows.length} αναθέσεις, ΙΔΙΑ άτομα (λίστα Κ9)`,
      k9Rows.length > 0 && k9Outsiders.length === 0,
      k9Outsiders.length ? `εκτός λίστας: ${nameOf[k9Outsiders[0].agentId]} ${k9Outsiders[0].date}`
        : (k9Rows.length === 0 ? 'καμία ανάθεση βραδινής Κ9 — έλεγξε απαιτήσεις/λίστα' : null));
  }

  // ---------- 6. Κ3: Γεωργιου & Γεωργιου Ρενα ----------
  {
    const nikId = idOf['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ'];
    const alikiId = idOf['ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ'];
    let bad = null;
    for (const a of workRows) {
      if (a.agentId !== nikId && a.agentId !== alikiId) continue;
      const who = nameOf[a.agentId];
      const dow = dayOfWeek(a.date);
      if (!isMorning(a.start, a.end)) { bad = `${who} ${a.date}: όχι πρωινή (${a.start}-${a.end})`; break; }
      const ruleDays = a.agentId === nikId ? [1, 5] : [2, 5];
      if (ruleDays.includes(dow) && !(a.start === '06:00' && a.end === '14:00')) {
        bad = `${who} ${a.date} (μέρα σχολής): ${a.start}-${a.end} αντί για ρεπό/τηλεργασία 06:00-14:00`;
        break;
      }
      // ΣΚ: το 06:00-14:00 επιτρέπεται («μόνο αν βγαίνει» — 11/07/2026)
      if (a.agentId === alikiId && !ruleDays.includes(dow) && !['07:30', '08:00'].includes(a.start) &&
          !(dow >= 6 && a.start === '06:00' && a.end === '14:00')) {
        bad = `Ρενα ${a.date}: έναρξη ${a.start} (επιτρεπτές 07:30/08:00)`;
        break;
      }
    }
    check('Κ3: Γεωργιου/Γεωργιου Ρενα — μόνο πρωί, μέρες σχολής ρεπό ή τηλεργασία 06:00-14:00', !bad, bad);
  }

  // ---------- 7. Όριο Κυριακών/μήνα (11/07/2026) ----------
  {
    const [exemptRows] = await pool.query(
      `SELECT id, full_name FROM agents WHERE active = 1 AND
       (departments LIKE '%supervisor%' OR weekend_shift IS NOT NULL OR (fixed_shift_start IS NOT NULL AND fixed_days IS NOT NULL))`
    );
    const exempt = new Set(exemptRows.map((r) => r.id));
    // Σταθερό καλοκαιρινό μοτίβο = σταθεροί → εκτός ορίου Κυριακών
    exempt.add(idOf['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ']);
    exempt.add(idOf['ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ']);
    const nikId = idOf['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ'];
    const perMonth = new Map(); // agentId|YYYY-MM → count
    for (const a of workRows) {
      const dow = dayOfWeek(a.date);
      if (dow !== 7) continue;
      const k = `${a.agentId}|${a.date.slice(0, 7)}`;
      if (!perMonth.has(k)) perMonth.set(k, new Set());
      perMonth.get(k).add(a.date);
    }
    // Ρεπό (μη-άδεια) ανά agent ανά εβδομάδα — για την εξαίρεση της απόφασης
    // 15/07/2026: 3η+ Κυριακή επιτρέπεται ΜΟΝΟ όταν εξασφαλίζει «ακριβώς 2 ρεπό»
    // (η εβδομάδα της έξτρα Κυριακής πρέπει να έχει ≤2 ρεπό — αλλιώς σπατάλη)
    const offsInWeek = new Map(); // agentId|weekStart → πλήθος ρεπό (όχι άδεια)
    for (const wk of genWeeks) {
      for (const a of wk.assignments) {
        if (a.off && !['leave', 'sick'].includes(a.reason)) {
          const k = `${a.agentId}|${wk.weekStart}`;
          offsInWeek.set(k, (offsInWeek.get(k) || 0) + 1);
        }
      }
    }
    // weekStart για μια ημερομηνία Κυριακής = η Δευτέρα 6 μέρες πριν
    const weekStartOfSunday = (d) => addDays(d, -6);

    let bad = null;
    for (const [k, ds] of perMonth) {
      const [idStr, mk] = k.split('|');
      const id = Number(idStr);
      if (exempt.has(id) || id === nikId) continue; // Γεωργιου: χωρίς όριο δουλεμένων Κυριακών
      if (ds.size <= 2) continue;
      // >2 Κυριακές: επιτρεπτό μόνο αν ΚΑΘΕ εβδομάδα δουλεμένης Κυριακής
      // έχει ≤2 ρεπό (η Κυριακή ήταν load-bearing για τα «ακριβώς 2 ρεπό»)
      const wasteful = [...ds].some((sun) => (offsInWeek.get(`${id}|${weekStartOfSunday(sun)}`) || 0) > 2);
      if (wasteful) { bad = `${nameOf[id]}: ${ds.size} Κυριακές τον ${mk} (όριο 2, χωρίς να εξυπηρετούν «2 ρεπό»)`; break; }
    }
    check('Όριο Κυριακών: ≤2/μήνα — εξαίρεση 3ης μόνο για «ακριβώς 2 ρεπό» (15/07/2026)', !bad, bad);

    // Γεωργιου: δουλεύει Κυριακές — το πολύ 1 ΡΕΠΟ Κυριακής/μήνα (12/07/2026)
    const nikSundaysOff = new Map(); // month → count
    for (const wk of genWeeks) {
      const sunday = wk.dates[6];
      const workedSunday = wk.assignments.some((a) => !a.off && a.agentId === nikId && a.date === sunday);
      // Άδεια/ασθένεια ΚΑΙ δικά του αιτήματα ρεπό δεν μετράνε στο όριο —
      // μόνο τα ρεπό που διάλεξε ο generator (13/07/2026)
      const excused = wk.assignments.some((a) => a.off && a.agentId === nikId && a.date === sunday &&
        ['leave', 'sick', 'repo_request'].includes(a.reason));
      if (!workedSunday && !excused) {
        const mk = sunday.slice(0, 7);
        nikSundaysOff.set(mk, (nikSundaysOff.get(mk) || 0) + 1);
      }
    }
    const nikBad = [...nikSundaysOff.entries()].find(([, n]) => n > 1);
    check('Γεωργιου: το πολύ 1 ρεπό Κυριακής τον μήνα — τις υπόλοιπες δουλεύει',
      !nikBad, nikBad ? `${nikBad[1]} ρεπό Κυριακής τον ${nikBad[0]}` : null);
  }

  // ---------- 8. Λίστα 06:00-14:00 (11/07/2026) ----------
  {
    const [eligRows62] = await pool.query(
      "SELECT agent_id FROM shift_eligibility WHERE shift_start = '06:00' AND shift_end = '14:00'"
    );
    const allowed62 = new Set(eligRows62.map((r) => r.agent_id));
    // Κ5 > λίστα: όποιος έχει ΔΗΛΩΜΕΝΟ σταθερό ωράριο 06:00-14:00 το παίρνει
    // νόμιμα χωρίς να είναι στη λίστα επιλεξιμότητας (π.χ. Σιδερη κάθε Τρίτη).
    // Ο generator το τοποθετεί στη φάση 1, πριν από κάθε έλεγχο λίστας.
    for (const fa of fixedAgents) {
      if (fa.fixed_shift_start === '06:00' && fa.fixed_shift_end === '14:00') allowed62.add(idOf[fa.full_name]);
    }
    let bad = null;
    for (const a of workRows) {
      if (a.start === '06:00' && a.end === '14:00' && !allowed62.has(a.agentId)) {
        bad = `${nameOf[a.agentId]} πήρε 06:00-14:00 (${a.date}) εκτός λίστας`;
        break;
      }
    }
    check(`Το 06:00-14:00 ΜΟΝΟ από τη λίστα των ${allowed62.size} εγκεκριμένων`, !bad, bad);

    // Γεωργιου/Γεωργιου: 6-2 μόνο στις μέρες τους (ΣΚ επιτρεπτό)
    const nikDays = { [idOf['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ']]: [1, 5], [idOf['ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ']]: [2, 5] };
    let bad2 = null;
    for (const a of workRows) {
      const days = nikDays[a.agentId];
      if (!days || a.start !== '06:00' || a.end !== '14:00') continue;
      const dow = dayOfWeek(a.date);
      if (!days.includes(dow) && dow < 6) { bad2 = `${nameOf[a.agentId]} 06:00-14:00 ${a.date} (μέρα ${dow})`; break; }
    }
    check('Γεωργιου 6-2 μόνο Δευ/Παρ, Γεωργιου μόνο Τρι/Παρ (ΣΚ επιτρεπτό)', !bad2, bad2);
  }

  // ---------- 9. Κανόνες νυχτερινών (14/07/2026) ----------
  {
    const { addDays } = require('../src/utils/dates');
    // ≤2 βράδια/εβδομάδα
    let bad = null;
    for (const wk of genWeeks) {
      const per = new Map();
      for (const a of wk.assignments) {
        if (!isNightRow(a)) continue;
        per.set(a.agentId, (per.get(a.agentId) || 0) + 1);
      }
      for (const [id, n] of per) if (n > 2) { bad = `${nameOf[id]}: ${n} βράδια εβδ. ${wk.weekStart}`; break; }
      if (bad) break;
    }
    check('Βράδια: το πολύ 2/εβδομάδα ανά agent', !bad, bad);

    // Τα 2 βράδια της εβδομάδας ΣΥΝΕΧΟΜΕΝΑ (14/07/2026)
    let badPair = null;
    for (const wk of genWeeks) {
      const per = new Map();
      for (const a of wk.assignments) {
        if (!isNightRow(a)) continue;
        if (!per.has(a.agentId)) per.set(a.agentId, []);
        per.get(a.agentId).push(a.date);
      }
      for (const [id, ds] of per) {
        if (ds.length === 2) {
          ds.sort();
          if (ds[1] !== addDays(ds[0], 1)) { badPair = `${nameOf[id]}: βράδια ${ds[0]} & ${ds[1]} μη συνεχόμενα`; break; }
        }
      }
      if (badPair) break;
    }
    check('Βράδια: όταν είναι 2 την εβδομάδα, είναι ΣΥΝΕΧΟΜΕΝΑ (π.χ. Δευ+Τρι → ρεπό Τετ+Πεμ)', !badPair, badPair);

    // Ρεπό μετά το βράδυ (σε ΟΛΗ την περίοδο, με σύνορα): μετά από σειρά
    // Ν συνεχόμενων βραδιών → Ν μέρες χωρίς βάρδια
    const nightDates = new Map();
    const workDates = new Map();
    for (const wk of genWeeks) {
      for (const a of wk.assignments) {
        if (a.off) continue;
        if (!workDates.has(a.agentId)) workDates.set(a.agentId, new Set());
        workDates.get(a.agentId).add(a.date);
        if (isNightRow(a)) {
          if (!nightDates.has(a.agentId)) nightDates.set(a.agentId, []);
          nightDates.get(a.agentId).push(a.date);
        }
      }
    }
    let badRest = null;
    for (const [id, dates] of nightDates) {
      dates.sort();
      let i = 0;
      while (i < dates.length) {
        let len = 1;
        while (i + len < dates.length && dates[i + len] === addDays(dates[i + len - 1], 1)) len++;
        if (len > 2) { badRest = `${nameOf[id]}: ${len} συνεχόμενα βράδια`; break; }
        const last = dates[i + len - 1];
        for (let r = 1; r <= len; r++) {
          const rest = addDays(last, r);
          // εντός περιόδου μόνο
          if (rest <= result.weeks[result.weeks.length - 1].dates[6] && workDates.get(id).has(rest)) {
            badRest = `${nameOf[id]}: βράδυ έως ${last} (σειρά ${len}) αλλά δουλεύει ${rest}`;
            break;
          }
        }
        if (badRest) break;
        i += len;
      }
      if (badRest) break;
    }
    check('Βράδια: υποχρεωτικό ρεπό μετά (2 σερί βράδια → 2 σερί ρεπό), και στα σύνορα', !badRest, badRest);
  }

  // ---------- 10. βραδινή Κ9 κάθε μέρα & Supervisors Δευ-Παρ (14/07/2026) ----------
  {
    let placed1903 = 0;
    let unc1903 = 0;
    let supUnc = 0;
    let supM = 0;
    let supA = 0;
    for (const wk of genWeeks) {
      for (const a of wk.assignments) {
        if (a.off) continue;
        if (isK9(a)) placed1903++;
        if (a.reqLabel === 'Supervisor' && a.start === '07:00') supM++;
        if (a.reqLabel === 'Supervisor' && a.start === '16:00') supA++;
      }
      for (const u of wk.report.uncovered) {
        if (u.label === K9_LABEL) unc1903++;
        if (u.label === 'Supervisor') supUnc++;
      }
    }
    const genDays = 7 * genWeeks.length;
    check(`Βραδινή Κ9 23:00-07:00 κάθε μέρα Δευ-Κυρ: ${placed1903}/${genDays} τοποθετημένες`, placed1903 + unc1903 === genDays && placed1903 >= genDays - 5, `placed=${placed1903} unc=${unc1903}`);
    // Ανοχή 1: σε εβδομάδες με σωρευμένες άδειες supervisors μπορεί μία
    // θέση να είναι δομικά αδύνατη (Κ2/Κ10 - η άδεια μετρά ως εργάσιμη) —
    // εμφανίζεται στην αναφορά για χειροκίνητη απόφαση
    check(`Supervisors ΚΑΘΕ μέρα Δευ-Κυρ 07:00-15:00 & 16:00-24:00 (${supM} πρωί / ${supA} απόγευμα, ακάλυπτα ${supUnc})`, supUnc <= 1 && supM >= genDays - 2 && supA >= genDays - 2, `unc=${supUnc} m=${supM} a=${supA}`);
  }

  // ---------- 10β. βραδινή Κ9 ομαδοποίηση + ΣΚ International (15/07/2026) ----------
  {
    const { addDays } = require('../src/utils/dates');
    // Πολλαπλές βραδινές Κ9/εβδομάδα: ΜΟΝΟ συνεχόμενες, και ρεπό μετά τη σειρά
    let bad = null;
    for (const wk of genWeeks) {
      const per = new Map();
      for (const a of wk.assignments) {
        if (isK9(a)) {
          if (!per.has(a.agentId)) per.set(a.agentId, []);
          per.get(a.agentId).push(a.date);
        }
      }
      for (const [id, ds] of per) {
        if (ds.length < 2) continue;
        ds.sort();
        for (let i = 1; i < ds.length; i++) {
          if (ds[i] !== addDays(ds[i - 1], 1)) { bad = `${nameOf[id]}: βραδινές Κ9 μη συνεχόμενες ${ds.join(',')}`; break; }
        }
        if (bad) break;
        const rest = addDays(ds[ds.length - 1], 1);
        const lastPeriodDate = result.weeks[result.weeks.length - 1].dates[6];
        if (rest <= lastPeriodDate) {
          const worksRest = result.weeks.some((w2) => w2.assignments.some((a) => a.agentId === id && a.date === rest && !a.off));
          if (worksRest) { bad = `${nameOf[id]}: δουλεύει ${rest} μετά από σειρά βραδινών Κ9 (${ds.join(',')})`; break; }
        }
      }
      if (bad) break;
    }
    check('Βραδινή Κ9: πολλαπλές = ΣΥΝΕΧΟΜΕΝΕΣ + ρεπό μετά τη σειρά', !bad, bad);

    // ΣΚ International: 2 slots/μέρα ΣΚ (πρωί+απόγευμα) λογαριασμένα
    let intPlaced = 0;
    let intUnc = 0;
    for (const wk of genWeeks) {
      for (const date of [wk.dates[5], wk.dates[6]]) {
        intPlaced += wk.assignments.filter((a) => !a.off && a.date === date && a.reqLabel === 'International').length;
      }
      for (const u of wk.report.uncovered) {
        const dow = dayOfWeek(u.date);
        if (dow >= 6 && u.label === 'International') intUnc++;
      }
    }
    const intTotal = 4 * genWeeks.length; // 2 slots × 2 μέρες ΣΚ ανά εβδομάδα
    check(`ΣΚ International 1 πρωί + 1 απόγευμα: ${intPlaced}/${intTotal} τοποθετημένα`, intPlaced + intUnc === intTotal && intPlaced >= intTotal - 4, `placed=${intPlaced} unc=${intUnc}`);
  }

  // ---------- 11. ΣΚ MAX = HARD (14/07/2026) ----------
  {
    // Ανά μέρα ΣΚ, ανά κατηγορία: μέγιστα 2 euro πρωί, 2 euro απόγ, 2 vega
    // πρωί, 2 vega απόγ, 1 Αιγαίου 06:00, 1 Αιγαίου απόγ, 1 verif πρωί,
    // 1 verif απόγ (+2 sup, 1× βραδινή Κ9, 1 νύχτα, καλοκαιρινά μοτίβα)
    const CAPS = [
      ['Atlas πρωί', (x) => ['Atlas', 'Atlas (μόνο)'].includes(x.reqLabel) && x.start < '12:00', 2],
      ['Atlas απόγευμα', (x) => ['Atlas', 'Atlas (μόνο)'].includes(x.reqLabel) && x.start >= '12:00' && x.start < '19:00', 2],
      ['Vega πρωί', (x) => x.reqLabel === 'Vega' && x.start < '12:00', 2],
      ['Vega απόγευμα', (x) => x.reqLabel === 'Vega' && x.start >= '12:00', 2],
      ['Αιγαίου 06:00', (x) => x.start === '06:00' && x.end === '14:00', 1],
      ['Αιγαίου απόγευμα', (x) => x.reqLabel === 'Αιγαίου' && x.start >= '12:00', 1],
      ['Verification πρωί', (x) => x.reqLabel === 'Verification' && x.start < '12:00', 1],
      ['Supervisor', (x) => x.reqLabel === 'Supervisor', 2]
    ];
    let bad = null;
    outerMax:
    for (const wk of genWeeks) {
      for (const date of [wk.dates[5], wk.dates[6]]) {
        const day = wk.assignments.filter((a) => !a.off && a.date === date);
        for (const [name, fn, cap] of CAPS) {
          const n = day.filter(fn).length;
          if (n > cap) { bad = `${date}: ${name} = ${n} (max ${cap})`; break outerMax; }
        }
      }
    }
    check('ΣΚ MAX (hard): κανένα ΣΚ πάνω από τα μέγιστα ανά κατηγορία', !bad, bad);

    // Και κανένας filler ΣΚ: όλες οι ΣΚ βάρδιες έχουν reqLabel ή είναι
    // δηλωμένες σταθερές (καλοκαιρινά μοτίβα Οικονομου = εντολή προϊσταμένου)
    const patternIds = new Set([idOf['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ'], idOf['ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ']]);
    let extra = null;
    for (const wk of genWeeks) {
      for (const date of [wk.dates[5], wk.dates[6]]) {
        for (const a of wk.assignments) {
          if (a.off || a.date !== date) continue;
          if (patternIds.has(a.agentId)) continue; // σταθερό μοτίβο — δικαιολογημένο
          const isNight = isNightRow(a);
          if (!a.reqLabel && !isNight) { extra = `${date}: ${a.agentName} ${a.start}-${a.end} χωρίς απαίτηση`; break; }
        }
        if (extra) break;
      }
      if (extra) break;
    }
    check('ΣΚ MAX (hard): καμία βάρδια ΣΚ εκτός απαιτήσεων/σταθερών (κανένας filler)', !extra, extra);
  }

  // ---------- 13. Νέοι κανόνες 14/11/2026 ----------
  {
    const workByKey = new Map();
    for (const a of workRows) {
      const k = `${a.agentId}|${a.date}`;
      if (!workByKey.has(k)) workByKey.set(k, []);
      workByKey.get(k).push(a);
    }
    // Μέρες της περιόδου όπου ο agent έχει άδεια/ασθένεια — εκεί τα σταθερά
    // ωράρια δικαιολογημένα δεν μπαίνουν (Κ6 υπερισχύει του Κ5)
    const leaveByKey = new Set(
      offRows.filter((o) => o.reason === 'leave' || o.reason === 'sick').map((o) => `${o.agentId}|${o.date}`)
    );

    // --- ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ: ΠΟΤΕ 06:00-14:00 το ΣΚ ---
    {
      // (14/11/2026) Ο κανόνας χαλάρωσε από hard σε SOFT αποφυγή: και οι δύο
      // Γεωργιου αποφεύγουν το 06:00-14:00 στα ΣΚ, αλλά το παίρνουν όταν δεν
      // υπάρχει εναλλακτική. Ο έλεγχος μετρά ΑΝΑΛΟΓΙΑ, δεν απαιτεί μηδέν.
      const avoiders = [idOf['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ'], idOf['ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ']];
      const wknd62 = workRows.filter((a) => a.start === '06:00' && a.end === '14:00' && dayOfWeek(a.date) >= 6);
      const theirs = wknd62.filter((a) => avoiders.includes(a.agentId));
      const pct = wknd62.length ? Math.round(theirs.length / wknd62.length * 100) : 0;
      // Με 7 άτομα στη λίστα, αν η αποφυγή δουλεύει παίρνουν σαφή μειοψηφία
      check(`Γεωργιου: αποφυγή 06:00-14:00 στα ΣΚ (${theirs.length}/${wknd62.length} = ${pct}%, soft)`,
        wknd62.length === 0 || pct <= 25,
        theirs.map((a) => `${a.date} ${nameOf[a.agentId]}`).join(', '));
      for (const id of avoiders) {
        const other = workRows.filter((a) => a.agentId === id && dayOfWeek(a.date) >= 6 && a.start !== '06:00').length;
        console.log(`       (πληροφοριακά: ${nameOf[id]} — ${other} βάρδιες ΣΚ με άλλο ωράριο)`);
      }
    }

    // --- ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ: Δευ+Παρ ρεπό, Τρι+Τετ 16:00-24:00 ---
    {
      const id = idOf['ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ'];
      const badOff = workRows.find((a) => a.agentId === id && [1, 5].includes(dayOfWeek(a.date)));
      check('Οικονομου Πετρος: ΡΕΠΟ κάθε Δευτέρα + Παρασκευή', !badOff,
        badOff ? `δουλεύει ${badOff.date} (${DAY_GR[dayOfWeek(badOff.date) - 1]}) ${badOff.start}-${badOff.end}` : null);

      const tueWed = workRows.filter((a) => a.agentId === id && [2, 3].includes(dayOfWeek(a.date)));
      const badShift = tueWed.find((a) => a.start !== '16:00' || a.end !== '24:00');
      check(`Οικονομου Πετρος: Τρίτη + Τετάρτη ΜΟΝΟ 16:00-24:00 (${tueWed.length} βάρδιες)`, !badShift,
        badShift ? `${badShift.date} ${badShift.start}-${badShift.end}` : null);

      // Τα σταθερά ωράρια πρέπει να μπήκαν όντως, εκτός όπου υπάρχει άδεια
      let missingFixed = null;
      for (const wk of genWeeks) {
        for (const d of [1, 2]) { // index 1=Τρι, 2=Τετ
          const date = wk.dates[d];
          if (leaveByKey.has(`${id}|${date}`)) continue;
          if (!workByKey.has(`${id}|${date}`)) { missingFixed = date; break; }
        }
        if (missingFixed) break;
      }
      check('Οικονομου Πετρος: οι σταθερές Τρι/Τετ μπήκαν (εκτός αδειών)', !missingFixed,
        missingFixed ? `λείπει η σταθερή βάρδια ${missingFixed}` : null);
    }

    // --- ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ: Δευ+Τρι 10:00-18:00, Τετ+Πεμ ρεπό, όρια έναρξης ---
    {
      const id = idOf['ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ'];
      const monTue = workRows.filter((a) => a.agentId === id && [1, 2].includes(dayOfWeek(a.date)));
      const badShift = monTue.find((a) => a.start !== '10:00' || a.end !== '18:00');
      check(`Οικονομου Ορεστης: Δευτέρα + Τρίτη ΜΟΝΟ 10:00-18:00 (${monTue.length} βάρδιες)`, !badShift,
        badShift ? `${badShift.date} ${badShift.start}-${badShift.end}` : null);

      const badOff = workRows.find((a) => a.agentId === id && [3, 4].includes(dayOfWeek(a.date)));
      check('Οικονομου Ορεστης: ΡΕΠΟ κάθε Τετάρτη + Πέμπτη', !badOff,
        badOff ? `δουλεύει ${badOff.date} (${DAY_GR[dayOfWeek(badOff.date) - 1]}) ${badOff.start}-${badOff.end}` : null);

      const LIMITS = { 5: '15:00', 6: '12:00', 7: '12:00' };
      const badStart = workRows.find((a) => {
        if (a.agentId !== id) return false;
        const lim = LIMITS[dayOfWeek(a.date)];
        return lim && toMin(a.start) < toMin(lim);
      });
      check('Οικονομου Ορεστης: Παρ από 15:00, Σαβ/Κυρ από 12:00 (νωρίτερη έναρξη)', !badStart,
        badStart ? `${badStart.date} (${DAY_GR[dayOfWeek(badStart.date) - 1]}) ξεκινά ${badStart.start}` : null);

      // Οι ώρες είναι ΟΡΙΑ, όχι υποχρεωτικές ώρες έναρξης — πληροφοριακά
      const flexDays = workRows.filter((a) => a.agentId === id && [5, 6, 7].includes(dayOfWeek(a.date)));
      const starts = [...new Set(flexDays.map((a) => a.start))].sort();
      console.log(`       (πληροφοριακά: Παρ/Σαβ/Κυρ ${flexDays.length} βάρδιες, ώρες έναρξης: ${starts.join(', ') || '—'})`);
    }

    // --- ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ + ΔΗΜΑΚΗ ΓΙΩΤΑ: κοινή βάρδια (SOFT) ---
    {
      const idA = idOf['ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ'];
      const idB = idOf['ΔΗΜΑΚΗ ΓΙΩΤΑ'];
      let both = 0;
      let same = 0;
      for (const wk of genWeeks) {
        for (const date of wk.dates) {
          const ra = (workByKey.get(`${idA}|${date}`) || [])[0];
          const rb = (workByKey.get(`${idB}|${date}`) || [])[0];
          if (!ra || !rb) continue;
          both++;
          if (ra.start === rb.start && ra.end === rb.end) same++;
        }
      }
      const pct = both ? Math.round((same / both) * 100) : 0;
      // SOFT: δεν απαιτείται 100%. Αποτυχία μόνο αν δεν πέτυχε ΠΟΤΕ, ενώ
      // υπήρχαν κοινές εργάσιμες μέρες — τότε η προτίμηση δεν λειτουργεί.
      check(`Βασιλακη Βασιλικη + Δημακη Δεσποινα: κοινή βάρδια ${same}/${both} κοινές εργάσιμες (${pct}%, soft)`,
        both === 0 || same > 0,
        both > 0 && same === 0 ? 'καμία κοινή βάρδια σε όλη την περίοδο — έλεγξε τον κανόνα prefer_same_shift' : null);
    }

    // --- Η αναφορά του generator δεν περιέχει παραβιάσεις νέων κανόνων ---
    {
      const auditMsgs = [];
      for (const wk of genWeeks) {
        for (const s of wk.report.soft) {
          if (String(s).startsWith('ΕΛΕΓΧΟΣ ΚΑΝΟΝΩΝ:')) auditMsgs.push(`${wk.weekStart}: ${s}`);
        }
      }
      check(`phaseRulesAudit: καμία παραβίαση υποχρεωτικού κανόνα (${auditMsgs.length} ευρήματα)`,
        auditMsgs.length === 0, auditMsgs.slice(0, 5).join('\n       '));
    }
  }

  // ---------- Σύνοψη κάλυψης ----------
  {
    let totalUncovered = 0;
    for (const wk of [...result.weeks]) totalUncovered += wk.report.uncovered.length;
    console.log(`\nΑκάλυπτες απαιτήσεις συνολικά: ${totalUncovered}`);
    const byLabel = new Map();
    for (const wk of [...result.weeks]) {
      for (const u of wk.report.uncovered) {
        const k = `${u.start}-${u.end} ${u.label}`;
        byLabel.set(k, (byLabel.get(k) || 0) + 1);
      }
    }
    for (const [k, n] of byLabel) console.log(`  ${k}: ${n} φορές`);
  }

  console.log(`\n${failures === 0 ? '✔ ΟΛΟΙ ΟΙ ΕΛΕΓΧΟΙ ΠΕΡΑΣΑΝ' : '✘ ' + failures + ' ΕΛΕΓΧΟΙ ΑΠΕΤΥΧΑΝ'}\n`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('Σφάλμα:', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
