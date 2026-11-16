// Migrations: δημιουργία βάσης και όλων των πινάκων της ενότητας 6 του spec.
// Εκτελείται με: npm run migrate  (ασφαλές να ξανατρέξει — CREATE IF NOT EXISTS)
const mysql = require('mysql2/promise');
const config = require('./config');

async function migrate() {
  // Πρώτα σύνδεση ΧΩΡΙΣ database για να δημιουργηθεί αν δεν υπάρχει
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4_unicode_ci'
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.changeUser({ database: config.database });

  const tables = [
    // Χρήστες εφαρμογής (προϊστάμενοι) για login
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      display_name VARCHAR(100),
      can_edit_agents TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Ρόλοι/γραμμές με χρώμα ARGB για το Excel (επεξεργάσιμοι από Ρυθμίσεις)
    `CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      color_argb CHAR(8) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Δεξιότητες ανά project (ATLAS, ΑΡΓΩ, VEGA, INTERNATIONAL, ΛΟΙΠΑ, ΖΕΦΥΡΟΣ, ΑΙΓΑΙΟΥ)
    `CREATE TABLE IF NOT EXISTS skills (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Agents — active=0 σημαίνει αποχώρηση (soft delete, ΠΟΤΕ DELETE)
    `CREATE TABLE IF NOT EXISTS agents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      company VARCHAR(20),
      departments JSON NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      can_night TINYINT(1) NULL,
      is_new TINYINT(1) NOT NULL DEFAULT 0,
      fixed_shift_start VARCHAR(5) NULL,
      fixed_shift_end VARCHAR(5) NULL,
      fixed_days JSON NULL,
      fixed_days_off JSON NULL,
      weekend_shift VARCHAR(11) NULL,
      work_location VARCHAR(10) NULL,
      notes TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Ποιες δεξιότητες έχει κάθε agent (γενίκευση του agent_roles του spec)
    `CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id INT NOT NULL,
      skill_id INT NOT NULL,
      PRIMARY KEY (agent_id, skill_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Ειδικοί κανόνες ανά agent (γενίκευση κανόνα Γεωργιου — Κ3)
    `CREATE TABLE IF NOT EXISTS agent_constraints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      day_of_week TINYINT NULL,
      allowed_shifts JSON NULL,
      required_shift VARCHAR(11) NULL,
      description TEXT,
      -- Δομημένος κανόνας που διαβάζει ο generator (src/scheduler). Μέχρι
      -- 14/11/2026 τον πρόσθετε ΜΟΝΟ το seed_rules.js με ALTER, οπότε μια
      -- καθαρή βάση από migrate.js ΔΕΝ είχε το ίδιο σχήμα με την παραγωγή.
      rule JSON NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Απαιτήσεις κάλυψης ανά βάρδια (ενότητα 4 — επεξεργάσιμες από Ρυθμίσεις).
    // Δείχνουν σε skill + τμήμα (π.χ. 'Verification & call Atlas' =
    // department 'verification' + skill ATLAS). role_id = προτεινόμενο χρώμα.
    `CREATE TABLE IF NOT EXISTS shift_requirements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      day_type ENUM('weekday','weekend') NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      skill_id INT NULL,
      department VARCHAR(30) NULL,
      period VARCHAR(10) NULL,
      headcount INT NOT NULL,
      label VARCHAR(100),
      role_id INT NULL,
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      FOREIGN KEY (role_id) REFERENCES roles(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Επιλεξιμότητα ειδικών βαρδιών (π.χ. 19:00-03:00) με όρια & τοποθεσία (Κ9).
    // Γενικός μηχανισμός — μπορεί να οριστεί λίστα και για άλλες βάρδιες.
    `CREATE TABLE IF NOT EXISTS shift_eligibility (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      shift_start VARCHAR(5) NOT NULL,
      shift_end VARCHAR(5) NOT NULL,
      max_per_week INT NOT NULL,
      location VARCHAR(10) NOT NULL,
      not_alone TINYINT(1) NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Άδειες / αιτήματα ρεπό / ασθένειες ανά ημερομηνία (Κ6)
    `CREATE TABLE IF NOT EXISTS time_off (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      date DATE NOT NULL,
      type ENUM('repo_request','leave','sick') NOT NULL,
      notes TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      INDEX idx_time_off_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // ==================== ΗΜΕΡΟΛΟΓΙΟ ΑΣΦΑΛΕΙΑΣ (15/11/2026) ====================
    // Καταγραφή ενεργειών για ανίχνευση και διερεύνηση περιστατικών.
    //
    // ΤΙ ΔΕΝ ΜΠΑΙΝΕΙ ΠΟΤΕ ΕΔΩ: κωδικοί, hashes, session ids, tokens, cookies,
    // ολόκληρα request bodies, προσωπικά δεδομένα εργαζομένων πέρα από το
    // αναγκαίο αναγνωριστικό. Το `details` κρατά μικρή, δομημένη σύνοψη.
    //
    // ΧΩΡΙΣ foreign key στο users: οι αποτυχημένες συνδέσεις δεν έχουν χρήστη,
    // και το ημερολόγιο δεν πρέπει να χάνεται αν διαγραφεί λογαριασμός.
    // Το actor_name κρατιέται ως στιγμιότυπο για να διαβάζεται και μετά.
    //
    // Καμία διαδρομή της εφαρμογής δεν κάνει UPDATE ή DELETE εδώ — μόνο INSERT.
    `CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actor_user_id INT NULL,
      actor_name VARCHAR(100) NULL,
      action VARCHAR(40) NOT NULL,
      target_type VARCHAR(30) NULL,
      target_id VARCHAR(64) NULL,
      success TINYINT(1) NOT NULL DEFAULT 1,
      ip VARCHAR(45) NULL,
      details TEXT NULL,
      INDEX idx_audit_created (created_at),
      INDEX idx_audit_actor (actor_user_id),
      INDEX idx_audit_action (action),
      INDEX idx_audit_action_time (action, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // ==================== ΕΠΙΘΥΜΗΤΕΣ ΩΡΕΣ ΕΡΓΑΣΙΑΣ (15/11/2026) ====================
    // Soft αιτήματα εργαζομένων για συγκεκριμένο ωράριο σε συγκεκριμένη μέρα.
    // UNIQUE(agent_id, date): ένα άτομο δουλεύει ΜΙΑ βάρδια τη μέρα (Κ2), άρα
    // δύο αντικρουόμενα αιτήματα για την ίδια μέρα δεν έχουν νόημα.
    `CREATE TABLE IF NOT EXISTS shift_wishes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      date DATE NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_wish_agent_date (agent_id, date),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      INDEX idx_shift_wishes_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Παραγόμενα προγράμματα ανά εβδομάδα (ιστορικό + μετρητές δικαιοσύνης)
    `CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      week_start DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      data LONGTEXT NOT NULL,
      INDEX idx_schedules_week (week_start)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Αναθέσεις βαρδιών. Το color_argb είναι το ΤΕΛΙΚΟ χρώμα του κελιού —
    // ο generator μόνο προτείνει, ο προϊστάμενος το αλλάζει ελεύθερα.
    `CREATE TABLE IF NOT EXISTS assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id INT NOT NULL,
      agent_id INT NOT NULL,
      date DATE NOT NULL,
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      skill_id INT NULL,
      role_id INT NULL,
      color_argb CHAR(8) NULL,
      label VARCHAR(50) NULL,
      is_manual_edit TINYINT(1) NOT NULL DEFAULT 0,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      FOREIGN KEY (role_id) REFERENCES roles(id),
      INDEX idx_assignments_date (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // ==================== ΑΝΑΦΟΡΕΣ ΛΑΘΩΝ (14/11/2026) ====================
    // Αναφορές εργαζομένων για λάθη στο πρόγραμμα. Χρησιμοποιούν τον ΥΠΑΡΧΟΝΤΑ
    // πίνακα users — δεν δημιουργείται δεύτερο σύστημα χρηστών.
    `CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      category VARCHAR(40) NOT NULL,
      issue_date DATE NOT NULL,
      description TEXT NOT NULL,
      related_shift VARCHAR(100) NULL,
      extra_info TEXT NULL,
      status ENUM('NEW','IN_REVIEW','RESOLVED','REJECTED') NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_reports_status (status),
      INDEX idx_reports_user (user_id),
      INDEX idx_reports_issue_date (issue_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Ιστορικό αλλαγών κατάστασης — ποιος, πότε, από τι σε τι
    `CREATE TABLE IF NOT EXISTS report_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      report_id INT NOT NULL,
      from_status VARCHAR(20) NULL,
      to_status VARCHAR(20) NOT NULL,
      changed_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_rsh_report (report_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Εσωτερικές σημειώσεις — ΟΡΑΤΕΣ ΜΟΝΟ ΣΕ ADMIN (επιβάλλεται στο backend)
    `CREATE TABLE IF NOT EXISTS report_notes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      report_id INT NOT NULL,
      author_id INT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_rn_report (report_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Ειδοποιήσεις admin — μία εγγραφή ανά νέα αναφορά
    `CREATE TABLE IF NOT EXISTS admin_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      report_id INT NOT NULL,
      message VARCHAR(255) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP NULL,
      FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
      INDEX idx_an_unread (is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const sql of tables) {
    await conn.query(sql);
  }

  // Στήλες που προστίθενται σε ΥΠΑΡΧΟΝΤΕΣ πίνακες — idempotent, δεν πειράζουν
  // δεδομένα. Το users.is_admin είναι η βάση του RBAC (προεπιλογή: 0 = employee).
  const columns = [
    ['users', 'is_admin', 'ALTER TABLE users ADD COLUMN is_admin TINYINT NOT NULL DEFAULT 0'],
    ['users', 'can_edit_agents', 'ALTER TABLE users ADD COLUMN can_edit_agents TINYINT NOT NULL DEFAULT 1'],
    // Για βάσεις που φτιάχτηκαν πριν μπει η στήλη στο CREATE παραπάνω
    ['agent_constraints', 'rule', 'ALTER TABLE agent_constraints ADD COLUMN rule JSON NULL']
  ];
  for (const [table, column, sql] of columns) {
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [config.database, table, column]
    );
    if (n === 0) {
      await conn.query(sql);
      console.log(`OK: προστέθηκε στήλη ${table}.${column}`);
    }
  }

  // Bootstrap RBAC: αν ΔΕΝ υπάρχει κανένας admin, γίνεται ο χρήστης «admin».
  // Χωρίς αυτό το Admin Panel θα ήταν απρόσιτο σε όλους. Τρέχει ΜΟΝΟ όταν
  // οι admin είναι μηδέν — δεν αφαιρεί και δεν αλλάζει υπάρχοντα δικαιώματα.
  const [[{ admins }]] = await conn.query('SELECT COUNT(*) AS admins FROM users WHERE is_admin = 1');
  if (admins === 0) {
    const [r] = await conn.query("UPDATE users SET is_admin = 1 WHERE username = 'admin'");
    if (r.affectedRows) {
      console.log('OK: ο χρήστης «admin» ορίστηκε ADMIN (δεν υπήρχε κανένας).');
    } else {
      console.log('ΠΡΟΣΟΧΗ: δεν υπάρχει κανένας admin και δεν βρέθηκε χρήστης «admin».');
      console.log('         Όρισε έναν: node scripts/set_admin.js <username> on');
    }
  } else {
    console.log(`Admins: ${admins} — καμία αλλαγή δικαιωμάτων.`);
  }

  await conn.end();
  console.log(`OK: βάση "${config.database}" και ${tables.length} πίνακες έτοιμοι.`);
}

migrate().catch((err) => {
  console.error('Σφάλμα migration:', err.message);
  process.exit(1);
});
