// Στοχευμένη εγκατάσταση ΜΟΝΟ των αλλαγών της 14/11/2026 — ΧΩΡΙΣ να πειράξει
// τίποτε άλλο στη βάση. Ίδιο μοτίβο με το scripts/add_shift_rules.js.
//
//   1. Βραδινή Κ9 («Vega Bank»): 19:00-03:00 → 23:00-07:00, ΙΔΙΑ άτομα
//      (η λίστα επιλεξιμότητας μεταφέρεται ως έχει — ίδια μέλη, ίδια όρια)
//   2. ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ: ΠΟΤΕ 06:00-14:00 Σάββατο/Κυριακή (hard)
//   3. ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ: Δευ+Παρ ρεπό, Τρι+Τετ 16:00-24:00
//   4. ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ: Δευ+Τρι 10:00-18:00, Τετ+Πεμ ρεπό,
//      Παρ από 15:00, Σαβ/Κυρ από 12:00
//   5. ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ + ΔΗΜΑΚΗ ΓΙΩΤΑ: soft προτίμηση κοινής βάρδιας
//
// Σε αντίθεση με το src/db/seed_rules.js (που σβήνει και ξαναγράφει τους
// κανόνες ΟΛΩΝ των agents του χάρτη του και πειράζει skills/λίστες), αυτό
// το script αγγίζει ΜΟΝΟ τους παραπάνω εργαζομένους και από αυτούς σβήνει
// ΜΟΝΟ τους κανόνες των τύπων που αντικαθιστά. Είναι idempotent.
//
// Χρήση (τοπικά):
//   node scripts/add_rules_1411.js
// Χρήση (Railway — MYSQL_PUBLIC_URL από τις Variables του MySQL service):
//   DATABASE_URL="mysql://root:XXXX@host.proxy.rlwy.net:12345/railway" node scripts/add_rules_1411.js
//
// Πρόσθεσε --dry-run για να δεις τι ΘΑ έκανε, χωρίς καμία εγγραφή.
const pool = require('../src/db/pool');
const cfg = require('../src/db/config');

const DRY = process.argv.includes('--dry-run');

// Σε DRY-RUN το UPDATE του ωραρίου ΔΕΝ έχει γίνει, οπότε οι γραμμές της λίστας
// είναι ακόμα στο ΠΑΛΙΟ ωράριο. Χωρίς αυτό το dry-run θα έλεγε ψευδώς
// «δεν είναι στη λίστα» και «χωρητικότητα 0» — παραπλανητικό σε migration.
const ALSO_OLD = DRY ? "OR (shift_start = '19:00' AND shift_end = '03:00')" : '';

// `remove`: τύποι παλιών κανόνων που ΑΝΤΙΚΑΘΙΣΤΑΝΤΑΙ και πρέπει να φύγουν,
// πέρα από τους τύπους που γράφουμε. Κρίσιμο για τους Οικονομου: ο παλιός
// κανόνας ήταν `weekly_pattern` και ο νέος `weekly_schedule` — αν έμενε ο
// παλιός, θα κλείδωνε ΟΛΗ την εβδομάδα και θα ακύρωνε το νέο πρόγραμμα.
// Αυστηρά εβδομαδιαία όρια βαρδιών Vega Bank 23:00-07:00 (14/11/2026).
// ΔΕΝ αφορούν το σύνολο των βαρδιών του εργαζομένου — μόνο αυτή τη βάρδια.
// Όσοι ΔΕΝ είναι εδώ (Αλεξιου 1, Αντωνιου 3, Ντοκου 2) μένουν ΑΜΕΤΑΒΛΗΤΟΙ.
// Αφαιρούνται από τη λίστα επιλεξιμότητας της Κ9 (απόφαση 14/11/2026).
// ΑΦΟΡΑ ΜΟΝΟ την Κ9: οι υπόλοιποι κανόνες, τα ωράρια και οι επιτρεπόμενες
// βάρδιές τους παραμένουν ΑΚΕΡΑΙΟΙ (π.χ. η Αντωνιου μένει στη λίστα 06:00-14:00).
const K9_REMOVE = ['ΑΛΕΞΙΟΥ ΔΙΟΝΥΣΗΣ', 'ΑΝΤΩΝΙΟΥ ΜΑΝΩΛΑΚΗ', 'ΝΤΟΚΟΥ ΙΡΙΣ'];

const K9_CAPS = {
  'ΘΕΟΔΩΡΟΥ ΗΛΙΑΣ': 1,
  'ΣΑΒΒΙΔΟΥ ΠΗΝΕΛΟΠΗ': 1,      // ΝΕΑ στη λίστα
  'ΙΩΑΝΝΙΔΗΣ ΘΑΝΑΣΗΣ': 1,
  'ΜΑΝΩΛΑΚΗ ΛΙΝΑ': 2,
  'ΚΩΝΣΤΑΝΤΙΝΙΔΗΣ ΑΝΔΡΕΑΣ': 2,
  'ΔΗΜΟΠΟΥΛΟΣ ΖΗΣΗΣ': 1
};

const RULES = {
  'ΛΑΜΠΡΟΥ ΚΩΣΤΑΣ': {
    rules: [
      {
        d: 'Supervisor Vega Bank (14/11/2026): όταν είναι σε ΠΡΩΙΝΗ βάρδια, πρέπει να υπάρχει εργαζόμενος Atlas με έναρξη 07:00. Αφορά ΜΟΝΟ πρωινές.',
        r: { type: 'vega_supervisor' }
      }
    ]
  },
  'ΧΡΙΣΤΟΔΟΥΛΟΥ ΤΑΣΙΑ': {
    rules: [
      {
        d: 'Supervisor Vega Bank (14/11/2026): όταν είναι σε ΠΡΩΙΝΗ βάρδια, πρέπει να υπάρχει εργαζόμενος Atlas με έναρξη 07:00. Αφορά ΜΟΝΟ πρωινές.',
        r: { type: 'vega_supervisor' }
      }
    ]
  },
  'ΛΑΜΠΡΟΥ ΦΑΝΗ': {
    remove: ['prefer_same_start_any'],
    rules: [
      {
        d: 'Supervisor Vega Bank (14/11/2026): όταν είναι σε ΠΡΩΙΝΗ βάρδια, πρέπει να υπάρχει εργαζόμενος Atlas με έναρξη 07:00. Αφορά ΜΟΝΟ πρωινές.',
        r: { type: 'vega_supervisor' }
      },
      {
        d: 'Συνοδεία ανά ωράριο (14/11/2026): στις 07:00-15:00 μαζί με ΕΝΑΝ από Γεωργιου Νίκο / Γεωργιου Ρενα / ΡΟΥΣΣΟΥ ΟΛΓΑ· στις 16:00-24:00 μαζί με τον ΡΟΥΣΣΟΥ ΟΛΓΑ. Σε ΟΠΟΙΟΔΗΠΟΤΕ άλλο ωράριο ΔΕΝ απαιτείται συνοδεία.',
        r: {
          type: 'escort_by_shift',
          shifts: {
            '07:00-15:00': ['ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ', 'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ', 'ΡΟΥΣΣΟΥ ΟΛΓΑ'],
            '16:00-24:00': ['ΡΟΥΣΣΟΥ ΟΛΓΑ']
          }
        }
      }
    ]
  },
  'ΓΕΩΡΓΙΟΥ ΒΑΓΓΕΛΗΣ': {
    rules: [
      {
        d: 'Το 06:00-14:00 ΜΟΝΟ Δευτέρα/Παρασκευή — ΣΚ μόνο αν βγαίνει.',
        r: { type: 'six_two_days', days: [1, 5] }
      },
      {
        d: 'Soft: ΑΠΟΦΥΓΗ του 06:00-14:00 τα Σαββατοκύριακα (14/11/2026). Προτεραιότητα αποφυγής, ΟΧΙ απαγόρευση — αν δεν υπάρχει άλλη εφικτή λύση, η βάρδια ανατίθεται. Πριν ήταν hard· χαλάρωσε με απόφαση της ίδιας ημέρας.',
        r: { type: 'avoid_weekend_62' }
      }
    ]
  },
  'ΤΡΙΑΝΤΑΦΥΛΛΟΥ ΡΕΝΑ': {
    rules: [
      {
        d: 'Soft: ΑΠΟΦΥΓΗ του 06:00-14:00 τα Σαββατοκύριακα (14/11/2026). Προτεραιότητα αποφυγής, ΟΧΙ απαγόρευση — αν δεν υπάρχει άλλη εφικτή λύση, η βάρδια ανατίθεται.',
        r: { type: 'avoid_weekend_62' }
      }
    ]
  },
  'ΠΕΤΡΙΔΗΣ ΠΕΤΡΟΣ': {
    remove: ['weekly_pattern'],
    rules: [
      {
        d: 'Σταθερό πρόγραμμα (14/11/2026): Δευτέρα + Παρασκευή ΥΠΟΧΡΕΩΤΙΚΟ ΡΕΠΟ, Τρίτη + Τετάρτη ΑΠΟΚΛΕΙΣΤΙΚΑ 16:00-24:00. Πέμπτη/Σάββατο/Κυριακή: κανονικά, κατά τους υπόλοιπους κανόνες.',
        r: { type: 'weekly_schedule', shifts: { 2: ['16:00', '24:00'], 3: ['16:00', '24:00'] }, off: [1, 5] }
      }
    ]
  },
  'ΟΙΚΟΝΟΜΟΥ ΟΡΕΣΤΗΣ': {
    remove: ['weekly_pattern'],
    rules: [
      {
        d: 'Σταθερό πρόγραμμα (14/11/2026): Δευ+Τρι ΑΠΟΚΛΕΙΣΤΙΚΑ 10:00-18:00, Τετ+Πεμ ΥΠΟΧΡΕΩΤΙΚΟ ΡΕΠΟ.',
        r: { type: 'weekly_schedule', shifts: { 1: ['10:00', '18:00'], 2: ['10:00', '18:00'] }, off: [3, 4] }
      },
      {
        d: 'Διαθεσιμότητα (14/11/2026): Παρασκευή ΔΕΝ ξεκινά πριν τις 15:00· Σάββατο/Κυριακή ΔΕΝ ξεκινά πριν τις 12:00. Είναι οι ΝΩΡΙΤΕΡΕΣ επιτρεπτές ώρες έναρξης, όχι υποχρεωτικές.',
        r: { type: 'start_after_days', days: { 5: '15:00', 6: '12:00', 7: '12:00' } }
      }
    ]
  },
  'ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ': {
    rules: [
      {
        d: 'Soft: κατά προτίμηση ΙΔΙΑ βάρδια με τη Δημακη Δεσποινα (14/11/2026). Προτίμηση, ΟΧΙ υποχρέωση — δεν παραβιάζονται οι ανάγκες στελέχωσης.',
        r: { type: 'prefer_same_shift', with: 'ΔΗΜΑΚΗ ΓΙΩΤΑ' }
      }
    ]
  },
  'ΔΗΜΑΚΗ ΓΙΩΤΑ': {
    rules: [
      {
        d: 'Soft: κατά προτίμηση ΙΔΙΑ βάρδια με την Βασιλακη Βασιλικη (14/11/2026). Προτίμηση, ΟΧΙ υποχρέωση — δεν παραβιάζονται οι ανάγκες στελέχωσης.',
        r: { type: 'prefer_same_shift', with: 'ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ' }
      }
    ]
  }
};

// Εναλλακτικές γραφές ονόματος (σειρά επωνύμου/μικρού, τόνοι)
const norm = (s) => String(s).toUpperCase().replace(/[΄']/g, '').replace(/\s+/g, ' ').trim();
const sortedKey = (s) => norm(s).split(' ').sort().join(' ');

async function findAgent(conn, name) {
  const [[exact]] = await conn.query('SELECT id, full_name, active, can_night FROM agents WHERE full_name = ?', [name]);
  if (exact) return exact;
  const [all] = await conn.query('SELECT id, full_name, active, can_night FROM agents');
  const want = sortedKey(name);
  const hits = all.filter((a) => sortedKey(a.full_name) === want);
  if (hits.length === 1) return hits[0];
  const token = norm(name).split(' ').sort((x, y) => y.length - x.length)[0];
  const t = all.filter((a) => norm(a.full_name).split(' ').includes(token));
  return t.length === 1 ? t[0] : null;
}

async function run() {
  console.log(`Βάση: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}${DRY ? '   [DRY-RUN — καμία εγγραφή]' : ''}\n`);
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_constraints' AND COLUMN_NAME = 'rule'`
    );
    if (cols[0].n === 0) {
      console.error('ΣΦΑΛΜΑ: λείπει η στήλη agent_constraints.rule — τρέξε πρώτα: node src/db/seed_rules.js');
      process.exitCode = 1;
      return;
    }

    // ΟΛΕΣ οι εγγραφές σε ΜΙΑ συναλλαγή: αν σπάσει στη μέση, η βάση μένει
    // ασυνεπής — π.χ. απαιτήσεις στις 23:00 αλλά λίστα επιλεξιμότητας ακόμα
    // στις 19:00, οπότε το κλειδί δεν ταιριάζει και η βάρδια βγαίνει ΜΟΝΙΜΑ
    // ακάλυπτη. Στο --dry-run δεν ανοίγει συναλλαγή (δεν γράφουμε τίποτα).
    if (!DRY) await conn.beginTransaction();

    // ---------- 1. Βραδινή Κ9: 19:00-03:00 → 23:00-07:00 ----------
    console.log('— Βραδινή Κ9 («Vega Bank») 19:00-03:00 → 23:00-07:00 —');
    const [oldReq] = await conn.query(
      "SELECT id, day_type, label FROM shift_requirements WHERE start_time = '19:00' AND end_time = '03:00'"
    );
    const [oldElig] = await conn.query(
      `SELECT se.agent_id, a.full_name, se.max_per_week, se.location, se.not_alone
       FROM shift_eligibility se JOIN agents a ON a.id = se.agent_id
       WHERE se.shift_start = '19:00' AND se.shift_end = '03:00'`
    );
    if (oldReq.length === 0 && oldElig.length === 0) {
      console.log('    ήδη 23:00-07:00 — παραλείπεται');
    } else {
      console.log(`    απαιτήσεις προς αλλαγή: ${oldReq.length} (${oldReq.map((r) => `${r.day_type}/${r.label}`).join(', ')})`);
      console.log(`    ΙΔΙΑ άτομα που μεταφέρονται: ${oldElig.length}`);
      for (const e of oldElig) {
        console.log(`      · ${e.full_name} — max ${e.max_per_week}/εβδ., ${e.location}${e.not_alone ? ', (παλιό not_alone — καταργείται)' : ''}`);
      }
      if (!DRY) {
        await conn.query(
          "UPDATE shift_requirements SET start_time = '23:00', end_time = '07:00' WHERE start_time = '19:00' AND end_time = '03:00'"
        );
        await conn.query(
          "UPDATE shift_eligibility SET shift_start = '23:00', shift_end = '07:00' WHERE shift_start = '19:00' AND shift_end = '03:00'"
        );
        console.log('    ✓ ενημερώθηκε (σύνθεση ομάδας αμετάβλητη)');
      }
    }
    // Έλεγχος ακεραιότητας
    const [[{ nElig }]] = await conn.query(
      "SELECT COUNT(*) AS nElig FROM shift_eligibility WHERE shift_start = '23:00' AND shift_end = '07:00'"
    );
    const [[{ nReq }]] = await conn.query(
      "SELECT COUNT(*) AS nReq FROM shift_requirements WHERE label = 'Verification & call υπόλοιπα'"
    );
    if (!DRY && nElig === 0) {
      console.log('    ⚠ η λίστα επιλεξιμότητας της βραδινής Κ9 είναι ΑΔΕΙΑ — η βάρδια θα βγαίνει ακάλυπτη');
    }
    console.log(`    τώρα: ${nReq} απαιτήσεις «Verification & call υπόλοιπα», ${nElig} μέλη λίστας\n`);

    // ---------- 1α. Atlas: 07:30-15:30 → 07:00-15:00 (ΠΑΡΑΛΛΑΓΗ Γ) ----------
    // Εγκρίθηκε 14/11/2026 μετά από προσομοίωση 4 παραλλαγών σε 2 μήνες.
    // ΜΕΤΑΤΡΕΠΕΙ την υπάρχουσα βάρδια — ΔΕΝ προσθέτει νέα: κανένα επιπλέον
    // άτομο, ίδιο πλήθος πρωινών θέσεων Atlas. Η προσθήκη τρίτης πρωινής
    // θέσης (παραλλαγή Β) εκτίναζε τα ακάλυπτα απογεύματα 4 → 17.
    // Η γραμμή κρατά το id της, άρα η σειρά των απαιτήσεων μένει σωστή.
    console.log('— Atlas 07:30-15:30 → 07:00-15:00 —');
    {
      const [[euroSkill]] = await conn.query("SELECT id FROM skills WHERE name = 'ATLAS'");
      if (!euroSkill) {
        console.log('    ✗ λείπει το skill ATLAS — παραλείπεται');
      } else {
        const [old] = await conn.query(
          "SELECT id, day_type, label FROM shift_requirements WHERE start_time = '07:30' AND end_time = '15:30' AND skill_id = ?",
          [euroSkill.id]
        );
        const [already] = await conn.query(
          "SELECT id, day_type FROM shift_requirements WHERE start_time = '07:00' AND end_time = '15:00' AND skill_id = ?",
          [euroSkill.id]
        );
        if (old.length === 0) {
          console.log(`    = ήδη 07:00-15:00 (${already.length} απαιτήσεις) — παραλείπεται`);
        } else {
          for (const r of old) console.log(`    · #${r.id} ${r.day_type}: 07:30-15:30 → 07:00-15:00`);
          if (!DRY) {
            await conn.query(
              `UPDATE shift_requirements SET start_time = '07:00', end_time = '15:00', label = 'Atlas (άνοιγμα)'
               WHERE start_time = '07:30' AND end_time = '15:30' AND skill_id = ?`,
              [euroSkill.id]
            );
            console.log(`    ✓ ${old.length} απαιτήσεις μετατράπηκαν (ίδια id, ίδια σειρά)`);
          }
        }
        // Η International 07:30-15:30 ΔΕΝ πειράζεται
        const [intl] = await conn.query(
          "SELECT COUNT(*) AS n FROM shift_requirements WHERE start_time = '07:30' AND skill_id <> ?",
          [euroSkill.id]
        );
        console.log(`    (άλλες 07:30 απαιτήσεις — π.χ. International — αμετάβλητες: ${intl[0].n})`);
      }
    }
    console.log('');

    // ---------- 1β. Εβδομαδιαία όρια βαρδιών Vega Bank 23:00-07:00 ----------
    // Αυστηρά όρια ανά εργαζόμενο (14/11/2026). Επιβάλλονται από τον υπάρχοντα
    // μηχανισμό shift_eligibility.max_per_week (φάση 6 + validator) — καμία
    // αλλαγή στον generator. Ο μετρητής είναι ΑΝΑ ΕΒΔΟΜΑΔΑ και μηδενίζεται.
    // Όσοι ΔΕΝ αναφέρονται μένουν ΑΜΕΤΑΒΛΗΤΟΙ: η σύνθεση της ομάδας δεν
    // αλλάζει και δεν γίνονται αυθαίρετες αντικαταστάσεις (κανόνας 6).
    // Αφαίρεση από τη λίστα Κ9 — ΠΡΙΝ από τα όρια, ώστε να μην μείνουν
    // παλιές εγγραφές που αναιρούν τη νέα σύνθεση. Idempotent: στη 2η
    // εκτέλεση το DELETE δεν βρίσκει γραμμές.
    console.log('— Αφαίρεση από τη λίστα Κ9 (μόνο η επιλεξιμότητα Κ9) —');
    for (const name of K9_REMOVE) {
      const ag = await findAgent(conn, name);
      if (!ag) {
        console.log(`    ✗ ${name}: ΔΕΝ ΒΡΕΘΗΚΕ — παραλείπεται`);
        continue;
      }
      const [[row]] = await conn.query(
        `SELECT id, max_per_week FROM shift_eligibility
         WHERE agent_id = ? AND ((shift_start = '23:00' AND shift_end = '07:00') ${ALSO_OLD})`,
        [ag.id]
      );
      if (!row) {
        console.log(`    = ${ag.full_name}: δεν είναι στη λίστα Κ9 (ήδη εντάξει)`);
        continue;
      }
      console.log(`    − ${ag.full_name}: αφαίρεση από Κ9 (ήταν ${row.max_per_week}/εβδ.)`);
      if (!DRY) await conn.query('DELETE FROM shift_eligibility WHERE id = ?', [row.id]);
      // Οι άλλες λίστες του (π.χ. 06:00-14:00) ΔΕΝ αγγίζονται
      const [other] = await conn.query(
        `SELECT shift_start, shift_end FROM shift_eligibility
         WHERE agent_id = ? AND NOT ((shift_start = '23:00' AND shift_end = '07:00') ${ALSO_OLD})`,
        [ag.id]
      );
      if (other.length) {
        console.log(`        (παραμένει σε: ${other.map((o) => `${o.shift_start}-${o.shift_end}`).join(', ')})`);
      }
    }
    console.log('');

    console.log('— Εβδομαδιαία όρια Vega Bank 23:00-07:00 —');
    for (const [name, max] of Object.entries(K9_CAPS)) {
      const ag = await findAgent(conn, name);
      if (!ag) {
        console.log(`    ✗ ${name}: ΔΕΝ ΒΡΕΘΗΚΕ — παραλείπεται`);
        continue;
      }
      const [[cur]] = await conn.query(
        `SELECT id, max_per_week FROM shift_eligibility
         WHERE agent_id = ? AND ((shift_start = '23:00' AND shift_end = '07:00') ${ALSO_OLD})`,
        [ag.id]
      );
      if (!cur) {
        console.log(`    + ${ag.full_name}: ΠΡΟΣΘΗΚΗ στη λίστα, όριο ${max}/εβδ.`);
        if (!DRY) {
          await conn.query(
            `INSERT INTO shift_eligibility (agent_id, shift_start, shift_end, max_per_week, location, not_alone)
             VALUES (?, '23:00', '07:00', ?, 'office', 0)`,
            [ag.id, max]
          );
        }
      } else if (cur.max_per_week !== max) {
        console.log(`    · ${ag.full_name}: ${cur.max_per_week} → ${max}/εβδ.`);
        if (!DRY) {
          // not_alone = 0: ο περιορισμός καταργήθηκε (14/11/2026) και δεν
          // επιβάλλεται πουθενά — μηδενίζεται ώστε η βάση να μη δείχνει
          // ενεργό κανόνα που ο generator αγνοεί.
          await conn.query('UPDATE shift_eligibility SET max_per_week = ?, not_alone = 0 WHERE id = ?', [max, cur.id]);
        }
      } else {
        console.log(`    = ${ag.full_name}: ήδη ${max}/εβδ.`);
      }
    }
    // Σύνοψη χωρητικότητας: η βάρδια τρέχει 7 μέρες/εβδομάδα
    // Σε DRY-RUN μετράμε και το παλιό ωράριο — αλλιώς βγάζει ψευδές «0 άτομα»
    const [[cap]] = await conn.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(max_per_week),0) AS total FROM shift_eligibility
       WHERE (shift_start = '23:00' AND shift_end = '07:00') ${ALSO_OLD}`
    );
    console.log(`    σύνολο: ${cap.n} άτομα, χωρητικότητα ${cap.total} βάρδιες/εβδομάδα (χρειάζονται 7)`);
    if (Number(cap.total) < 7) {
      console.log('    ⚠ Η χωρητικότητα είναι ΚΑΤΩ από 7 — η βάρδια θα βγαίνει ακάλυπτη κάποιες μέρες.');
    }
    console.log('');

    // ---------- 2. Κανόνες ανά εργαζόμενο ----------
    console.log('— Κανόνες εργαζομένων —');
    let missing = 0;
    const resolved = new Map(); // όνομα χάρτη → γραμμή agent που βρέθηκε
    for (const [name, spec] of Object.entries(RULES)) {
      const rules = spec.rules;
      const agent = await findAgent(conn, name);
      if (!agent) {
        console.log(`✗ ${name}: ΔΕΝ ΒΡΕΘΗΚΕ στη βάση — παραλείπεται`);
        missing++;
        continue;
      }
      resolved.set(name, agent);
      const label = agent.full_name === name ? name : `${name}  →  βρέθηκε ως "${agent.full_name}"`;
      console.log(`• ${label}  (id=${agent.id}, active=${agent.active})`);

      // Τύποι που φεύγουν: όσοι ξαναγράφονται + όσοι αντικαθίστανται ρητά
      const types = new Set([...rules.map((x) => x.r.type), ...(spec.remove || [])]);
      const [existing] = await conn.query('SELECT id, rule FROM agent_constraints WHERE agent_id = ?', [agent.id]);
      const stale = existing.filter((row) => {
        if (!row.rule) return false;
        try {
          const r = typeof row.rule === 'string' ? JSON.parse(row.rule) : row.rule;
          return types.has(r.type);
        } catch { return false; }
      });
      const kept = existing.length - stale.length;

      if (!DRY) {
        for (const s of stale) await conn.query('DELETE FROM agent_constraints WHERE id = ?', [s.id]);
        for (const { d, r } of rules) {
          await conn.query(
            'INSERT INTO agent_constraints (agent_id, description, rule) VALUES (?, ?, ?)',
            [agent.id, d, JSON.stringify(r)]
          );
        }
      }
      console.log(`    ${stale.length ? `αφαιρέθηκαν ${stale.length} παλιοί κανόνες (${[...types].join(', ')}), ` : ''}γράφτηκαν ${rules.length}, έμειναν ανέπαφοι ${kept} άλλοι κανόνες του/της`);
      if (!agent.active) console.log('    ⚠ ΑΝΕΝΕΡΓΟΣ: δεν θα μπει σε πρόγραμμα');
    }

    // ---------- 3. Καθαρισμός fixed_days_off όσων πήραν weekly_schedule ----------
    // Τα σταθερά ρεπό δηλώνονται πλέον ΜΕΣΑ στον κανόνα (off: [...]). Αν έμενε
    // και η στήλη fixed_days_off, τα ρεπό θα μετρούνταν ΔΥΟ φορές.
    // Χρησιμοποιούνται τα id που ΟΝΤΩΣ βρέθηκαν παραπάνω — ΟΧΙ LIKE σε όνομα:
    // το findAgent ταιριάζει και εναλλακτικές γραφές, ένα LIKE όχι, οπότε θα
    // μπορούσε να αφήσει τη στήλη γεμάτη σε αλλιώς γραμμένο όνομα.
    const wsIds = [...resolved.entries()]
      .filter(([name]) => (RULES[name].rules || []).some((x) => x.r.type === 'weekly_schedule'))
      .map(([, ag]) => ag);
    if (wsIds.length) {
      const [fdo] = await conn.query(
        `SELECT id, full_name, fixed_days_off FROM agents
         WHERE id IN (${wsIds.map(() => '?').join(',')}) AND fixed_days_off IS NOT NULL`,
        wsIds.map((a) => a.id)
      );
      if (fdo.length) {
        console.log('\n— Καθαρισμός fixed_days_off (δηλώνονται πλέον στο weekly_schedule) —');
        for (const r of fdo) console.log(`    · ${r.full_name}: ${r.fixed_days_off} → NULL`);
        if (!DRY) {
          await conn.query(
            `UPDATE agents SET fixed_days_off = NULL WHERE id IN (${fdo.map(() => '?').join(',')})`,
            fdo.map((r) => r.id)
          );
        }
      } else {
        console.log('\nfixed_days_off: ήδη καθαρό.');
      }
    }

    // ---------- 4. Έλεγχος ζεύγους κοινής βάρδιας ----------
    const pairNames = ['ΒΑΣΙΛΑΚΗ ΒΑΣΙΛΙΚΗ', 'ΔΗΜΑΚΗ ΓΙΩΤΑ'];
    const pair = [];
    for (const n of pairNames) {
      const a = await findAgent(conn, n);
      if (a) pair.push(a);
    }
    if (pair.length === 2) {
      console.log(`\n— Ζεύγος κοινής βάρδιας: ${pair[0].full_name} ↔ ${pair[1].full_name} (soft) —`);
    } else {
      console.log('\n⚠ Το ζεύγος κοινής βάρδιας δεν ολοκληρώθηκε — λείπει εργαζόμενος');
    }

    if (!DRY) await conn.commit();
    console.log(`\n${DRY ? 'DRY-RUN: δεν γράφτηκε τίποτα.' : 'Έτοιμο (commit).'}${missing ? ` ${missing} εργαζόμενος/οι δεν βρέθηκαν.` : ''}`);
    if (!DRY) {
      console.log('Επόμενο βήμα: ξαναδημιούργησε το πρόγραμμα και έλεγξε την αναφορά.');
    }
  } catch (e) {
    if (!DRY) {
      try { await conn.rollback(); console.error('ROLLBACK — καμία αλλαγή δεν εφαρμόστηκε.'); } catch {}
    }
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((e) => {
  // Τα σφάλματα σύνδεσης της mysql2 είναι AggregateError με ΚΕΝΟ message —
  // χωρίς το code/τα errors δεν φαίνεται ΤΙ πήγε στραβά σε ένα migration
  const parts = [e && e.code, e && e.message].filter(Boolean);
  if (e && Array.isArray(e.errors)) {
    for (const sub of e.errors) parts.push(`${sub.code || ''} ${sub.message || ''}`.trim());
  }
  console.error('Σφάλμα:', parts.length ? parts.join(' | ') : e);
  process.exit(1);
});
