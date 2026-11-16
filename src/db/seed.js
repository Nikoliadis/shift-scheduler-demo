// Seed αρχικών δεδομένων:
//  1. Ρόλοι/χρώματα (ενότητα 3 του spec)
//  2. Δεξιότητες (skills)
//  3. Απαιτήσεις κάλυψης βαρδιών (ενότητα 4 — καθημερινές + ΣΚ)
//  4. Αρχικός χρήστης admin/admin
//  5. Import seed_agents.json: agents + skills + constraints + λίστα βραδινής Κ9
//
// Εκτελείται με: npm run seed
// Είναι idempotent: ό,τι υπάρχει ήδη ΔΕΝ ξαναγράφεται. Με --force αδειάζουν
// και ξαναγεμίζουν οι πίνακες αναφοράς (agents/roles/skills/requirements) —
// ΟΧΙ τα schedules/assignments/time_off.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const FORCE = process.argv.includes('--force');

// ---- 1. Ρόλοι/χρώματα — ενότητα 3 του spec (ARGB) ----
const ROLES = [
  { name: 'Supervisor', color_argb: 'FFC792D6' },
  { name: 'Αιγαίου', color_argb: 'FFFFE699' },
  { name: 'Ζέφυρος', color_argb: 'FFC6E0B4' },
  { name: 'Atlas', color_argb: 'FF66CCFF' },
  { name: 'Υπόλοιπα call', color_argb: 'FFF4B084' },
  { name: 'Νέος agent (προς επιβεβαίωση)', color_argb: 'FF2F5496' },
  { name: 'Verification', color_argb: 'FFA6A6A6' },
  { name: 'Ροδακινί (προς επιβεβαίωση)', color_argb: 'FFFCE4D6' },
  { name: 'Σκούρο κίτρινο (προς επιβεβαίωση)', color_argb: 'FFFFC000' }
];

// ---- 3. Απαιτήσεις κάλυψης — αποφάσεις προϊσταμένου 10-11/07/2026 ----
// period: 'morning'/'afternoon' = απαίτηση «Χ άτομα του ρόλου σε πρωινή/
// απογευματινή βάρδια» (οποιοδήποτε ωράριο της περιόδου — το start/end είναι
// το ΠΡΟΕΠΙΛΕΓΜΕΝΟ για νέες τοποθετήσεις). period null = ακριβές ωράριο.
// department με '+' σημαίνει ότι απαιτούνται ΟΛΑ τα τμήματα.
// Καθημερινές: Αιγαίου 9 πρωί (1 εξ αυτών 06:00-14:00 από τη λίστα 6-2)
// + 2 απόγευμα, ΖΕΦΥΡΟΣ 3 πρωί + 2 απόγευμα, Verification 4 πρωί + 5 απόγευμα
// (ΟΠΩΣΔΗΠΟΤΕ — ξεχωριστές μετρήσεις, κάθε άτομο μετρά σε ΜΙΑ κατηγορία),
// calls: 2 Vega (1 ΑΡΓΩ) + 1 International + 2 Atlas + 1 Verif&call Euro.
// ΣΚ: Αιγαίου 1+1, Verification 1+1, Atlas 2+2, Vega 2+2.
// Η ΣΕΙΡΑ έχει σημασία: τα ακριβή/ειδικά πρώτα, τα γενικά (period) μετά,
// ώστε κάθε άτομο να μετρηθεί στη σωστή κατηγορία.
// Η νυχτερινή αποθηκεύεται ως 23:00-07:00 — η εναλλακτική 23:30-07:30
// αποφασίζεται από τον generator βάσει του κανόνα Κ4.
const REQUIREMENTS = {
  weekday: [
    // Το 06:00-14:00 καλύπτεται ΑΠΟΚΛΕΙΣΤΙΚΑ από τη λίστα επιλεξιμότητας
    // (Χριστοδουλου Κ., Γεωργιου, Γεωργιου, Τζανη, Γαλανη,
    // Παπαθανασιου + Αντωνιου μόνο ΣΚ) με δίκαιη εναλλαγή — απόφαση 12/07/2026.
    // Χωρίς απαίτηση skill: η λίστα ορίζει ποιοι το κάνουν (όπως η βραδινή Κ9).
    { start: '06:00', end: '14:00', skill: null, department: null, period: null, headcount: 1, label: 'Αιγαίου', color: 'Αιγαίου' },
    // Supervisors Δευ-Παρ: ΠΑΝΤΑ ένας 07:00-15:00 και ένας 16:00-24:00 (14/07/2026)
    { start: '07:00', end: '15:00', skill: null, department: 'supervisor', period: null, headcount: 1, label: 'Supervisor', color: 'Supervisor' },
    { start: '16:00', end: '24:00', skill: null, department: 'supervisor', period: null, headcount: 1, label: 'Supervisor', color: 'Supervisor' },
    // Αιγαίου απόγευμα ×2 + ΖΕΦΥΡΟΣ απόγευμα ×2: ΝΩΡΙΣ στη σειρά (SOS,
    // 13/07/2026) — τα μικρά απογευματινά pools (π.χ. Βεργου/Σιδερη) δεν
    // πρέπει να «καίγονται» πρώτα σε πρωινά slots
    { start: '16:00', end: '24:00', skill: 'ΑΙΓΑΙΟΥ', department: null, period: 'afternoon', headcount: 2, label: 'Αιγαίου', color: 'Αιγαίου' },
    { start: '16:00', end: '24:00', skill: 'ΖΕΦΥΡΟΣ', department: null, period: 'afternoon', headcount: 2, label: 'Ζέφυρος', color: 'Ζέφυρος' },
    { start: '09:00', end: '17:00', skill: 'ΖΕΦΥΡΟΣ', department: null, period: 'morning', headcount: 3, label: 'Ζέφυρος', color: 'Ζέφυρος' },
    // (14/11/2026) Άνοιγμα στις 07:00 αντί 07:30: ώστε όταν ο πρωινός
    // Supervisor καλύπτει Vega Bank να υπάρχει Atlas από τις 07:00.
    { start: '07:00', end: '15:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (άνοιγμα)', color: 'Atlas' },
    { start: '07:30', end: '15:30', skill: 'INTERNATIONAL', department: 'call', period: null, headcount: 1, label: 'International', color: 'Υπόλοιπα call' },
    { start: '08:00', end: '16:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (μόνο)', color: 'Atlas' },
    { start: '08:00', end: '16:00', skill: 'ΑΡΓΩ', department: 'call', period: null, headcount: 1, label: 'Vega/ΑΡΓΩ', color: 'Υπόλοιπα call' },
    { start: '08:00', end: '16:00', skill: 'VEGA', department: 'call', period: null, headcount: 1, label: 'Vega', color: 'Υπόλοιπα call' },
    { start: '15:30', end: '23:30', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas', color: 'Atlas' },
    { start: '15:30', end: '23:30', skill: 'INTERNATIONAL', department: 'call', period: null, headcount: 1, label: 'International', color: 'Υπόλοιπα call' },
    { start: '16:00', end: '24:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (μόνο)', color: 'Atlas' },
    { start: '16:00', end: '24:00', skill: 'ΑΡΓΩ', department: 'call', period: null, headcount: 1, label: 'Vega/ΑΡΓΩ', color: 'Υπόλοιπα call' },
    { start: '16:00', end: '24:00', skill: 'VEGA', department: 'call', period: null, headcount: 1, label: 'Vega', color: 'Υπόλοιπα call' },
    { start: '08:00', end: '16:00', skill: 'ΑΙΓΑΙΟΥ', department: null, period: 'morning', headcount: 8, label: 'Αιγαίου', color: 'Αιγαίου' },
    { start: '08:00', end: '16:00', skill: null, department: 'verification', period: 'morning', headcount: 4, label: 'Verification', color: 'Verification' },
    { start: '16:00', end: '24:00', skill: null, department: 'verification', period: 'afternoon', headcount: 5, label: 'Verification', color: 'Verification' },
    { start: '23:00', end: '07:00', skill: null, department: null, period: null, headcount: 1, label: 'Verification & call υπόλοιπα', color: 'Verification' },
    { start: '23:00', end: '07:00', skill: 'ATLAS', department: null, period: null, headcount: 1, label: 'Νυχτερινή Atlas', color: 'Atlas' }
  ],
  weekend: [
    // ΣΚ: ο πρωινός Αιγαίου δουλεύει ΑΚΡΙΒΩΣ 06:00-14:00, από τη λίστα
    // επιλεξιμότητας του 06:00 με δίκαιη εναλλαγή (απόφαση 12/07/2026).
    // ΠΡΩΤΟ στη σειρά: το pool του είναι το πιο περιορισμένο — να μην
    // «καίγονται» τα μέλη της λίστας σε άλλα slots (π.χ. Γεωργιου σε Atlas)
    { start: '06:00', end: '14:00', skill: null, department: null, period: null, headcount: 1, label: 'Αιγαίου', color: 'Αιγαίου' },
    { start: '07:00', end: '15:00', skill: null, department: 'supervisor', period: null, headcount: 1, label: 'Supervisor', color: 'Supervisor' },
    // (14/11/2026) Άνοιγμα στις 07:00 αντί 07:30: ώστε όταν ο πρωινός
    // Supervisor καλύπτει Vega Bank να υπάρχει Atlas από τις 07:00.
    { start: '07:00', end: '15:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (άνοιγμα)', color: 'Atlas' },
    // ΣΚ International: 1 πρωί + 1 απόγευμα (15/07/2026)
    { start: '07:30', end: '15:30', skill: 'INTERNATIONAL', department: 'call', period: null, headcount: 1, label: 'International', color: 'Υπόλοιπα call' },
    { start: '08:00', end: '16:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (μόνο)', color: 'Atlas' },
    { start: '08:00', end: '16:00', skill: 'VEGA', department: 'call', period: null, headcount: 2, label: 'Vega', color: 'Υπόλοιπα call' },
    { start: '08:00', end: '16:00', skill: null, department: 'verification', period: 'morning', headcount: 1, label: 'Verification', color: 'Verification' },
    // ΣΚ απόγευμα supervisor = 16:00-24:00 (14/07/2026) — ακριβώς η σταθερή
    // βάρδια ΣΚ της Φραγκου
    { start: '16:00', end: '24:00', skill: null, department: 'supervisor', period: null, headcount: 1, label: 'Supervisor', color: 'Supervisor' },
    { start: '15:30', end: '23:30', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas', color: 'Atlas' },
    // ΣΚ International: 1 πρωί + 1 απόγευμα (15/07/2026)
    { start: '15:30', end: '23:30', skill: 'INTERNATIONAL', department: 'call', period: null, headcount: 1, label: 'International', color: 'Υπόλοιπα call' },
    { start: '16:00', end: '24:00', skill: 'ATLAS', department: 'call', period: null, headcount: 1, label: 'Atlas (μόνο)', color: 'Atlas' },
    { start: '16:00', end: '24:00', skill: 'VEGA', department: 'call', period: null, headcount: 2, label: 'Vega', color: 'Υπόλοιπα call' },
    { start: '16:00', end: '24:00', skill: 'ΑΙΓΑΙΟΥ', department: null, period: 'afternoon', headcount: 1, label: 'Αιγαίου', color: 'Αιγαίου' },
    { start: '16:00', end: '24:00', skill: null, department: 'verification', period: 'afternoon', headcount: 1, label: 'Verification', color: 'Verification' },
    // Η βραδινή Κ9 τρέχει ΚΑΘΕ μέρα Δευ-Κυρ (14/07/2026) — μέσω λίστας Κ9.
    // (14/11/2026) Ωράριο 23:00-07:00 — ΙΔΙΟ με τη νυχτερινή Atlas: οι δύο
    // απαιτήσεις ξεχωρίζουν από την ΕΤΙΚΕΤΑ τους, όχι από την ώρα.
    { start: '23:00', end: '07:00', skill: null, department: null, period: null, headcount: 1, label: 'Verification & call υπόλοιπα', color: 'Verification' },
    { start: '23:00', end: '07:00', skill: 'ATLAS', department: null, period: null, headcount: 1, label: 'Νυχτερινή Atlas', color: 'Atlas' }
  ]
};

// Βοηθητικό: 'HH:MM-HH:MM' → { start, end }
function splitShift(s) {
  const [start, end] = s.split('-');
  return { start, end };
}

async function seed() {
  const conn = await pool.getConnection();
  try {
    if (FORCE) {
      // Καθαρισμός ΜΟΝΟ πινάκων αναφοράς — όχι ιστορικό προγραμμάτων
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of ['agent_skills', 'agent_constraints', 'shift_eligibility', 'agents', 'shift_requirements', 'skills', 'roles']) {
        await conn.query(`TRUNCATE TABLE ${t}`);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log('(--force) Καθαρίστηκαν οι πίνακες αναφοράς.');
    }

    // ---- Φόρτωση seed_agents.json ----
    const seedPath = path.join(__dirname, '..', '..', 'seed_agents.json');
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    // ---- 1. Ρόλοι ----
    const [[{ nRoles }]] = await conn.query('SELECT COUNT(*) AS nRoles FROM roles');
    if (nRoles === 0) {
      for (const r of ROLES) {
        await conn.query('INSERT INTO roles (name, color_argb) VALUES (?, ?)', [r.name, r.color_argb]);
      }
      console.log(`OK: ${ROLES.length} ρόλοι/χρώματα.`);
    } else {
      console.log('Ρόλοι: υπάρχουν ήδη, παραλείπονται.');
    }

    // ---- 2. Skills (από το seed file) ----
    const [[{ nSkills }]] = await conn.query('SELECT COUNT(*) AS nSkills FROM skills');
    if (nSkills === 0) {
      for (const s of seedData.skills) {
        await conn.query('INSERT INTO skills (name) VALUES (?)', [s]);
      }
      console.log(`OK: ${seedData.skills.length} δεξιότητες.`);
    } else {
      console.log('Δεξιότητες: υπάρχουν ήδη, παραλείπονται.');
    }

    // Χάρτες όνομα → id για roles και skills
    const [roleRows] = await conn.query('SELECT id, name FROM roles');
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    const [skillRows] = await conn.query('SELECT id, name FROM skills');
    const skillId = Object.fromEntries(skillRows.map((s) => [s.name, s.id]));

    // ---- 3. Απαιτήσεις κάλυψης ----
    const [[{ nReq }]] = await conn.query('SELECT COUNT(*) AS nReq FROM shift_requirements');
    if (nReq === 0) {
      let count = 0;
      for (const [dayType, reqs] of Object.entries(REQUIREMENTS)) {
        for (const r of reqs) {
          await conn.query(
            `INSERT INTO shift_requirements
             (day_type, start_time, end_time, skill_id, department, period, headcount, label, role_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              dayType, r.start, r.end,
              r.skill ? skillId[r.skill] : null,
              r.department, r.period || null, r.headcount, r.label,
              r.color ? roleId[r.color] : null
            ]
          );
          count++;
        }
      }
      console.log(`OK: ${count} απαιτήσεις κάλυψης (καθημερινές + ΣΚ).`);
    } else {
      console.log('Απαιτήσεις κάλυψης: υπάρχουν ήδη, παραλείπονται.');
    }

    // ---- 4. Αρχικός χρήστης admin/admin ----
    const [[{ nUsers }]] = await conn.query('SELECT COUNT(*) AS nUsers FROM users');
    if (nUsers === 0) {
      const hash = bcrypt.hashSync('admin', 10);
      await conn.query(
        'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
        ['admin', hash, 'Διαχειριστής']
      );
      console.log('OK: χρήστης admin/admin.');
    } else {
      console.log('Χρήστες: υπάρχουν ήδη, παραλείπονται.');
    }

    // ---- 5. Import agents + agent_skills + agent_constraints ----
    const [[{ nAgents }]] = await conn.query('SELECT COUNT(*) AS nAgents FROM agents');
    if (nAgents === 0) {
      let cAgents = 0;
      let cConstraints = 0;
      const agentIdByName = {};

      for (const a of seedData.agents) {
        const fixed = a.fixed_shift ? splitShift(a.fixed_shift) : null;
        const [res] = await conn.query(
          `INSERT INTO agents
           (full_name, company, departments, active, can_night, is_new,
            fixed_shift_start, fixed_shift_end, fixed_days, fixed_days_off,
            weekend_shift, work_location, notes)
           VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            a.full_name,
            a.company,
            JSON.stringify(a.departments),
            a.can_night === null || a.can_night === undefined ? null : (a.can_night ? 1 : 0),
            fixed ? fixed.start : null,
            fixed ? fixed.end : null,
            a.fixed_days ? JSON.stringify(a.fixed_days) : null,
            a.fixed_days_off ? JSON.stringify(a.fixed_days_off) : null,
            a.weekend_shift || null,
            a.work_location || null
          ]
        );
        const id = res.insertId;
        agentIdByName[a.full_name] = id;
        cAgents++;

        // Δεξιότητες του agent
        for (const s of a.skills || []) {
          if (!skillId[s]) throw new Error(`Άγνωστη δεξιότητα "${s}" στον ${a.full_name}`);
          await conn.query('INSERT INTO agent_skills (agent_id, skill_id) VALUES (?, ?)', [id, skillId[s]]);
        }

        // Το κείμενο constraints του seed → agent_constraints.description
        // (τα δομημένα πεδία day_of_week/allowed_shifts/required_shift
        //  συμπληρώνονται από τον generator/UI στα επόμενα βήματα)
        if (a.constraints) {
          await conn.query(
            'INSERT INTO agent_constraints (agent_id, description) VALUES (?, ?)',
            [id, a.constraints]
          );
          cConstraints++;
        }
      }
      console.log(`OK: ${cAgents} agents, ${cConstraints} constraints.`);

      // ---- Λίστα επιλεξιμότητας βραδινής Κ9 23:00-07:00 ----
      let cElig = 0;
      for (const e of seedData.shift_eligibility_19_03) {
        const id = agentIdByName[e.agent];
        if (!id) throw new Error(`Άγνωστος agent στη λίστα βραδινής Κ9: "${e.agent}"`);
        await conn.query(
          `INSERT INTO shift_eligibility
           (agent_id, shift_start, shift_end, max_per_week, location, not_alone, notes)
           VALUES (?, '23:00', '07:00', ?, ?, ?, ?)`,
          [id, e.max_per_week, e.location, e.not_alone ? 1 : 0, e['σημείωση'] || null]
        );
        cElig++;
      }
      console.log(`OK: ${cElig} εγγραφές επιλεξιμότητας βραδινής Κ9 23:00-07:00.`);
    } else {
      console.log('Agents: υπάρχουν ήδη, παραλείπονται (τρέξε με --force για επανεισαγωγή).');
    }

    console.log('Seed ολοκληρώθηκε.');
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Σφάλμα seed:', err.message);
  process.exit(1);
});
