// Tests FRONTEND για Report button / modal και Admin Panel (14/11/2026).
//
// Φορτώνει τα ΠΡΑΓΜΑΤΙΚΑ αρχεία (public/*.html, public/js/*.js) σε jsdom και
// ελέγχει ότι το UI χτίζεται και συμπεριφέρεται σωστά — όχι απλώς ότι τα
// αρχεία υπάρχουν. Το fetch είναι stubbed, άρα δεν χρειάζεται server/βάση.
//
// Χρήση: node scripts/test_frontend.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let fail = 0;
let pass = 0;
function ta(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

// Φτιάχνει jsdom από πραγματικό HTML και τρέχει μέσα του πραγματικό JS
async function boot(htmlFile, scriptFile, fetchImpl) {
  const dom = new JSDOM(read(htmlFile), { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  window.fetch = fetchImpl;
  // Το script τρέχει στο context του παραθύρου, όπως στο browser
  window.eval(read(scriptFile));
  await tick();
  await tick();
  await tick();
  return dom;
}

const okJson = (data) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(data)
});

(async () => {
  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 1. Το report.js είναι συνδεδεμένο σε ΟΛΕΣ τις σελίδες ===');
  const pages = ['public/index.html', 'public/period.html', 'public/import.html', 'public/schedule.html'];
  for (const p of pages) {
    ta(`${path.basename(p)} φορτώνει /js/report.js`, read(p).includes('src="/js/report.js"'));
  }
  ta('καμία σελίδα δεν έχει inline script με κώδικα (CSP scriptSrc self)',
    pages.every((p) => !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(read(p))));
  ta('κανένα inline onclick/onsubmit handler (CSP)',
    [...pages, 'public/admin.html'].every((p) => !/\son(click|submit|change|input)=/i.test(read(p))));

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Το κουμπί μπαίνει ΑΡΙΣΤΕΡΑ από το username ===');
  {
    const dom = await boot('public/index.html', 'public/js/report.js',
      () => okJson({ ok: true, displayName: 'ΚΩΣΤΑΣ Π.', isAdmin: false }));
    const doc = dom.window.document;
    const btn = doc.getElementById('reportBtn');
    const userBox = doc.querySelector('.topbar .user');

    ta('το κουμπί δημιουργήθηκε', !!btn);
    ta('βρίσκεται μέσα στο .topbar .user', !!btn && btn.parentElement === userBox);
    const kids = [...userBox.children];
    const iBtn = kids.indexOf(btn);
    const iName = kids.indexOf(doc.getElementById('userName'));
    ta(`σειρά [Report] [Username]: θέσεις ${iBtn} < ${iName}`, iBtn >= 0 && iName > iBtn);
    ta('έχει εικονίδιο αναφοράς', !!btn.querySelector('.report-ico'));
    ta('έχει κείμενο «Αναφορά»', /Αναφορά/.test(btn.textContent));
    ta('έχει title για accessibility', !!btn.getAttribute('title'));
    ta('ΔΕΝ χάλασε η υπάρχουσα διάταξη (brand + nav + logout ανέπαφα)',
      !!doc.querySelector('.topbar .brand') && !!doc.querySelector('.topbar nav') && !!doc.getElementById('logoutBtn'));
    ta('ο employee ΔΕΝ βλέπει σύνδεσμο Admin', !doc.getElementById('adminLink'));
    ta('τα υπάρχοντα nav links παραμένουν 4',
      doc.querySelectorAll('.topbar nav a').length === 4);
  }

  console.log('\n=== 3. Ο admin βλέπει σύνδεσμο Admin Panel ===');
  {
    const dom = await boot('public/index.html', 'public/js/report.js',
      () => okJson({ ok: true, displayName: 'Διαχειριστής', isAdmin: true }));
    const doc = dom.window.document;
    const link = doc.getElementById('adminLink');
    ta('ο σύνδεσμος Admin υπάρχει', !!link);
    ta('δείχνει στο /admin.html', !!link && link.getAttribute('href') === '/admin.html');
    ta('το κουμπί Αναφοράς υπάρχει και για τον admin', !!doc.getElementById('reportBtn'));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Modal φόρμας αναφοράς ===');
  {
    let posted = null;
    let postCount = 0;
    const dom = await boot('public/index.html', 'public/js/report.js', (url, opts) => {
      if (url === '/api/me') return okJson({ ok: true, displayName: 'ΚΩΣΤΑΣ Π.', isAdmin: false });
      if (url === '/api/reports') {
        postCount++;
        posted = JSON.parse(opts.body);
        return okJson({ ok: true, id: 42, message: 'ok' });
      }
      return okJson({ ok: false });
    });
    const doc = dom.window.document;
    doc.getElementById('userName').textContent = 'ΚΩΣΤΑΣ Π.';
    doc.getElementById('reportBtn').click();
    await tick();

    ta('το modal άνοιξε', !!doc.querySelector('.report-modal') && doc.querySelector('.report-modal').closest('.modal-backdrop') !== null);
    ta('το υπάρχον modal της σελίδας δεν επηρεάστηκε',
      doc.getElementById('modalBackdrop') && doc.getElementById('modalBackdrop').style.display === 'none');
    const cats = [...doc.querySelectorAll('#rpCategory option')].map((o) => o.value).filter(Boolean);
    ta(`7 κατηγορίες προβλήματος (βρήκα ${cats.length})`, cats.length === 7, cats.join(', '));
    for (const need of ['WRONG_SHIFT', 'WRONG_DAY_OFF', 'WRONG_HOURS', 'WRONG_ASSIGNMENT', 'VEGA_BANK', 'CONSTRAINT_VIOLATION', 'OTHER']) {
      if (!cats.includes(need)) ta(`κατηγορία ${need}`, false);
    }
    ta('όλες οι απαιτούμενες κατηγορίες υπάρχουν',
      ['WRONG_SHIFT', 'WRONG_DAY_OFF', 'WRONG_HOURS', 'WRONG_ASSIGNMENT', 'VEGA_BANK', 'CONSTRAINT_VIOLATION', 'OTHER'].every((c) => cats.includes(c)));
    ta('υπάρχει πεδίο ημερομηνίας, προσυμπληρωμένο', !!doc.getElementById('rpDate').value);
    ta('υπάρχει πεδίο περιγραφής', !!doc.getElementById('rpDesc'));
    ta('υπάρχουν τα προαιρετικά πεδία (βάρδια, επιπλέον)',
      !!doc.getElementById('rpShift') && !!doc.getElementById('rpExtra'));

    const who = doc.getElementById('rpWho');
    ta('το όνομα συμπληρώνεται αυτόματα', who.value === 'ΚΩΣΤΑΣ Π.', who.value);
    ta('το όνομα ΔΕΝ είναι επεξεργάσιμο', who.disabled === true && who.readOnly === true);

    // Validation: υποβολή χωρίς κατηγορία
    const form = doc.querySelector('.report-form');
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await tick();
    ta('χωρίς κατηγορία → μήνυμα λάθους, καμία κλήση',
      /κατηγορία/i.test(doc.getElementById('rpErr').textContent) && postCount === 0);

    // Validation: κοντή περιγραφή
    doc.getElementById('rpCategory').value = 'VEGA_BANK';
    doc.getElementById('rpDesc').value = 'κοντό';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await tick();
    ta('κοντή περιγραφή → μήνυμα λάθους, καμία κλήση',
      /10 χαρακτήρες/.test(doc.getElementById('rpErr').textContent) && postCount === 0);

    // Έγκυρη υποβολή
    doc.getElementById('rpDesc').value = 'Η βάρδια Vega Bank είναι λάθος στις 18/11.';
    doc.getElementById('rpShift').value = '23:00-07:00';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await tick(); await tick(); await tick();

    ta('η υποβολή έστειλε POST /api/reports', postCount === 1);
    ta('στάλθηκαν τα σωστά πεδία',
      posted && posted.category === 'VEGA_BANK' && posted.description.includes('Vega Bank') && posted.relatedShift === '23:00-07:00',
      JSON.stringify(posted));
    ta('ΔΕΝ στάλθηκε όνομα/userId από τον client (το βάζει ο server)',
      posted && !('userId' in posted) && !('user' in posted) && !('userName' in posted));
    ta('το modal έκλεισε μετά την επιτυχία', !doc.querySelector('.report-modal'));
    ta('εμφανίστηκε επιβεβαίωση', /#42|υποβλήθηκε/.test((doc.getElementById('toast') || {}).textContent || ''));
  }

  console.log('\n=== 5. Αποφυγή διπλής υποβολής (γρήγορα clicks) ===');
  {
    let postCount = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const dom = await boot('public/index.html', 'public/js/report.js', (url) => {
      if (url === '/api/me') return okJson({ ok: true, displayName: 'Χ', isAdmin: false });
      if (url === '/api/reports') {
        postCount++;
        return gate.then(() => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 7 }) }));
      }
      return okJson({ ok: false });
    });
    const doc = dom.window.document;
    doc.getElementById('reportBtn').click();
    await tick();
    doc.getElementById('rpCategory').value = 'OTHER';
    doc.getElementById('rpDesc').value = 'Αρκετά μεγάλη περιγραφή για το τεστ.';
    const form = doc.querySelector('.report-form');
    const sub = () => form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    sub(); sub(); sub();   // τρία γρήγορα clicks
    await tick();
    ta(`τρία διαδοχικά submits → ${postCount} κλήση`, postCount === 1);
    ta('το κουμπί απενεργοποιήθηκε κατά την υποβολή', doc.getElementById('rpSend').disabled === true);
    release();
    await tick(); await tick();
  }

  console.log('\n=== 6. Σφάλμα server → το μήνυμα φαίνεται, το modal μένει ανοιχτό ===');
  {
    const dom = await boot('public/index.html', 'public/js/report.js', (url) => {
      if (url === '/api/me') return okJson({ ok: true, displayName: 'Χ', isAdmin: false });
      return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ ok: false, error: 'Διάλεξε κατηγορία προβλήματος' }) });
    });
    const doc = dom.window.document;
    doc.getElementById('reportBtn').click();
    await tick();
    doc.getElementById('rpCategory').value = 'OTHER';
    doc.getElementById('rpDesc').value = 'Αρκετά μεγάλη περιγραφή για το τεστ.';
    doc.querySelector('.report-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await tick(); await tick(); await tick();
    ta('το σφάλμα του server εμφανίζεται στη φόρμα',
      /κατηγορία/.test(doc.getElementById('rpErr').textContent), doc.getElementById('rpErr').textContent);
    ta('το modal ΔΕΝ έκλεισε (ο χρήστης δεν χάνει τα δεδομένα του)', !!doc.querySelector('.report-modal'));
    ta('το κουμπί ξανά ενεργό για νέα προσπάθεια', doc.getElementById('rpSend').disabled === false);
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 7. Admin Panel: δομή και φόρτωση ===');
  {
    const STATS = { ok: true, stats: { total: 15, NEW: 3, IN_REVIEW: 5, RESOLVED: 6, REJECTED: 1 }, unreadNotifications: 3 };
    const LIST = {
      ok: true,
      reports: [{
        id: 9, user_id: 2, userName: 'ΚΩΣΤΑΣ Π.', category: 'VEGA_BANK',
        issue_date: '2026-11-18', description: 'Λάθος βάρδια Vega Bank.',
        status: 'NEW', created_at: '2026-11-18 09:30:00', noteCount: 0
      }]
    };
    const calls = [];
    const dom = await boot('public/admin.html', 'public/js/admin.js', (url) => {
      calls.push(String(url));
      if (url === '/api/me') return okJson({ ok: true, displayName: 'Διαχειριστής', isAdmin: true, canEditAgents: true });
      if (String(url).startsWith('/api/reports/admin/stats')) return okJson(STATS);
      if (String(url).startsWith('/api/reports/admin/users')) return okJson({ ok: true, users: [{ id: 2, name: 'ΚΩΣΤΑΣ Π.', reportCount: 4 }] });
      if (String(url).startsWith('/api/reports/admin/list')) return okJson(LIST);
      if (String(url).startsWith('/api/reports/admin/notifications')) return okJson({ ok: true, notifications: [], unread: 3 });
      return okJson({ ok: true });
    });
    const doc = dom.window.document;
    await tick(); await tick(); await tick(); await tick();

    ta('εμφανίζεται το όνομα του admin', doc.getElementById('userName').textContent === 'Διαχειριστής');
    ta('υπάρχουν 5 κάρτες στατιστικών', doc.querySelectorAll('.stat-cards .stat-card').length === 5);
    ta(`Συνολικές = 15 (βρήκα ${doc.getElementById('stTotal').textContent})`, doc.getElementById('stTotal').textContent === '15');
    ta(`Νέες = 3`, doc.getElementById('stNew').textContent === '3');
    ta(`Υπό εξέταση = 5`, doc.getElementById('stReview').textContent === '5');
    ta(`Επιλυμένες = 6`, doc.getElementById('stResolved').textContent === '6');
    ta(`Απορριφθείσες = 1`, doc.getElementById('stRejected').textContent === '1');

    const badge = doc.getElementById('notifBadge');
    ta(`το badge δείχνει 3 και είναι ορατό`, badge.textContent === '3' && !badge.classList.contains('zero'));

    const tabs = [...doc.querySelectorAll('.admin-tabs button')].map((b) => b.dataset.tab);
    ta('υπάρχουν οι ενότητες Dashboard/Αναφορές/Ιστορικό/Ρυθμίσεις',
      ['dashboard', 'reports', 'history', 'settings'].every((t) => tabs.includes(t)), tabs.join(', '));
    ta('το Dashboard είναι ενεργό αρχικά',
      doc.querySelector('.admin-tabs button.active').dataset.tab === 'dashboard' &&
      !doc.getElementById('tab-dashboard').hidden);

    // Αλλαγή ενότητας
    doc.querySelector('.admin-tabs button[data-tab="reports"]').click();
    await tick(); await tick(); await tick();
    ta('η ενότητα Αναφορές εμφανίζεται', !doc.getElementById('tab-reports').hidden && doc.getElementById('tab-dashboard').hidden);
    const table = doc.querySelector('#reportsWrap table.data');
    ta('ο πίνακας αναφορών σχεδιάστηκε', !!table);
    const headers = [...(table ? table.querySelectorAll('thead th') : [])].map((th) => th.textContent);
    ta('ο πίνακας έχει τις απαιτούμενες στήλες',
      ['ID', 'Εργαζόμενος', 'Υποβλήθηκε', 'Αφορά', 'Κατηγορία', 'Περιγραφή', 'Κατάσταση'].every((h) => headers.includes(h)),
      headers.join(' | '));
    ta('η γραμμή δείχνει ID, όνομα και status badge',
      /#9/.test(table.textContent) && /ΚΩΣΤΑΣ/.test(table.textContent) && !!table.querySelector('.badge.st-NEW'));
    ta('υπάρχουν φίλτρα κατάστασης/κατηγορίας/εργαζομένου/ημερομηνίας + αναζήτηση',
      !!doc.getElementById('fStatus') && !!doc.getElementById('fCategory') &&
      !!doc.getElementById('fUser') && !!doc.getElementById('fFrom') &&
      !!doc.getElementById('fTo') && !!doc.getElementById('fQ'));

    // Το φίλτρο στέλνει query στον server
    const before = calls.length;
    doc.getElementById('fStatus').value = 'RESOLVED';
    doc.getElementById('fStatus').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick(); await tick();
    ta('αλλαγή φίλτρου → νέα κλήση με status=RESOLVED',
      calls.slice(before).some((u) => u.includes('status=RESOLVED')), calls.slice(before).join(' '));
  }

  console.log('\n=== 8. Admin Panel: ο employee αποκλείεται στο UI ===');
  {
    const dom = await boot('public/admin.html', 'public/js/admin.js',
      (url) => (url === '/api/me'
        ? okJson({ ok: true, displayName: 'ΚΩΣΤΑΣ Π.', isAdmin: false })
        : okJson({ ok: true, stats: {}, reports: [], users: [], notifications: [], unread: 0 })));
    const doc = dom.window.document;
    await tick(); await tick(); await tick();
    ta('εμφανίζεται μήνυμα άρνησης πρόσβασης',
      /Δεν έχεις δικαίωμα/.test(doc.querySelector('main').textContent));
    ta('δεν σχεδιάστηκε πίνακας αναφορών', !doc.querySelector('#reportsWrap table'));
  }

  console.log('\n=== 9. Responsive + στυλ ===');
  {
    const css = read('public/css/style.css');
    ta('υπάρχει media query για μικρές οθόνες', /@media \(max-width: 680px\)/.test(css));
    ta('στο mobile κρύβεται η ετικέτα, μένει το εικονίδιο', /\.topbar \.report-label \{ display: none; \}/.test(css));
    ta('το κουμπί έχει στυλ εναρμονισμένο με το header', /\.topbar \.report-btn/.test(css));
    ta('υπάρχουν στυλ status badge για τις 4 καταστάσεις',
      ['st-NEW', 'st-IN_REVIEW', 'st-RESOLVED', 'st-REJECTED'].every((c) => css.includes(c)));
    ta('οι κάρτες στατιστικών είναι responsive grid', /\.stat-cards[\s\S]*?auto-fit/.test(css));
    ta('δεν αλλοιώθηκε το υπάρχον στυλ (τα βασικά selectors υπάρχουν)',
      ['.topbar', '.modal-backdrop', 'table.data', '.btn.primary'].every((s) => css.includes(s)));
  }

  // ════════════════════════════════════════════════════════════════
  console.log('\n=== 10. Επιθυμητές ώρες εργασίας — UI (15/11/2026) ===');
  {
    const html = read('public/period.html');
    ta('η ενότητα είναι ΚΑΤΩ από τις άδειες',
      html.indexOf('Επιθυμητές ώρες εργασίας') > html.indexOf('Καταχώρηση άδειας'),
      'Η προδιαγραφή ζητά «ακριβώς κάτω από το υπάρχον πεδίο καταχώρησης αδειών»');
    ta('υπάρχουν και τα 5 πεδία του αιτήματος',
      ['wAgent', 'wDate', 'wShift', 'wNotes'].every((id) => html.includes(`id="${id}"`)));
    ta('ΔΕΝ χρησιμοποιείται input type=time (δεν δέχεται 24:00)',
      !/id="wStart"|id="wEnd"/.test(html),
      'Το <input type="time"> δεν μπορεί να εκφράσει το 24:00 της βάρδιας 16:00-24:00');
    ta('υπάρχει κουμπί καταχώρησης', html.includes('id="addWishBtn"'));
    ta('υπάρχει πίνακας αιτημάτων', html.includes('id="wishTable"'));
    ta('η ενότητα αδειών παρέμεινε άθικτη',
      ['toAgent', 'toType', 'toFrom', 'toTo', 'addTimeOffBtn', 'timeoffTable'].every((id) => html.includes(`id="${id}"`)),
      'Χάθηκε στοιχείο της υπάρχουσας φόρμας αδειών');
  }

  // Λειτουργικός έλεγχος με jsdom: φόρτωση, προσθήκη, επεξεργασία, διαγραφή
  {
    const AGENTS = { ok: true, agents: [{ id: 7, full_name: 'ΔΟΚΙΜΗ ΑΛΦΑ' }, { id: 8, full_name: 'ΔΟΚΙΜΗ ΒΗΤΑ' }] };
    const wishes = [{
      id: 11, agent_id: 7, date: '2026-11-18', start_time: '10:00', end_time: '18:00',
      notes: 'σχολή', full_name: 'ΔΟΚΙΜΗ ΑΛΦΑ', active: 1, conflict_type: null
    }];
    const calls = [];
    const fetchImpl = (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (url.startsWith('/api/agents')) return okJson(AGENTS);
      if (url.startsWith('/api/wishes/shifts')) {
        return okJson({ ok: true, shifts: [
          { start: '06:00', end: '14:00' }, { start: '08:00', end: '16:00' },
          { start: '10:00', end: '18:00' }, { start: '16:00', end: '24:00' },
          { start: '23:00', end: '07:00' }
        ] });
      }
      if (url.startsWith('/api/wishes')) {
        if ((opts.method || 'GET') === 'GET') return okJson({ ok: true, entries: wishes });
        return okJson({ ok: true, id: 99 });
      }
      if (url.startsWith('/api/timeoff')) return okJson({ ok: true, entries: [] });
      if (url.startsWith('/api/me')) return okJson({ ok: true, displayName: 'Τεστ' });
      return okJson({ ok: true });
    };

    const dom = await boot('public/period.html', 'public/js/period.js', fetchImpl);
    const { window } = dom;
    const doc = window.document;

    ta('φορτώθηκαν τα αιτήματα από το API', calls.some((c) => c.url.startsWith('/api/wishes') && c.method === 'GET'));
    const rows = doc.querySelectorAll('#wishTable tbody tr');
    ta(`ο πίνακας έχει 1 γραμμή (${rows.length})`, rows.length === 1);
    ta('φαίνεται το όνομα', !!rows[0] && /ΔΟΚΙΜΗ ΑΛΦΑ/.test(rows[0].textContent));
    ta('φαίνεται το ωράριο 10:00-18:00', !!rows[0] && /10:00.18:00/.test(rows[0].textContent));
    ta('ο select εργαζομένων γέμισε', doc.querySelectorAll('#wAgent option').length === 3);
    ta('ο select αδειών ΔΕΝ χάλασε', doc.querySelectorAll('#toAgent option').length === 3);
    ta('ο select βαρδιών γέμισε με τις ΥΠΑΡΧΟΥΣΕΣ βάρδιες', doc.querySelectorAll('#wShift option').length === 6);
    ta('περιλαμβάνεται η 16:00-24:00 (που το input type=time δεν δέχεται)',
      [...doc.querySelectorAll('#wShift option')].some((o) => o.value === '16:00|24:00'));

    // --- Προσθήκη: validation πρώτα ---
    doc.getElementById('addWishBtn').dispatchEvent(new window.Event('click'));
    await tick();
    ta('χωρίς εργαζόμενο: μήνυμα λάθους και κανένα POST',
      /Επίλεξε εργαζόμενο/.test(doc.getElementById('wishErr').textContent) &&
      !calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/wishes')));

    doc.getElementById('wAgent').value = '8';
    doc.getElementById('wDate').value = '2026-11-19';
    doc.getElementById('addWishBtn').dispatchEvent(new window.Event('click'));
    await tick();
    ta('χωρίς επιλογή βάρδιας: απορρίπτεται τοπικά',
      /βάρδια/.test(doc.getElementById('wishErr').textContent) &&
      !calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/wishes')));

    doc.getElementById('wShift').value = '16:00|24:00';
    doc.getElementById('addWishBtn').dispatchEvent(new window.Event('click'));
    await tick(); await tick();
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/api/wishes'));
    ta('έγκυρο αίτημα: POST /api/wishes', !!post);
    ta('το POST στέλνει σωστά πεδία',
      !!post && post.body.agent_id === 8 && post.body.date === '2026-11-19' &&
      post.body.start_time === '16:00' && post.body.end_time === '24:00',
      JSON.stringify(post && post.body));

    // --- Επεξεργασία ---
    const editBtn = doc.querySelector('#wishTable tbody button[data-edit]');
    ta('υπάρχει κουμπί επεξεργασίας', !!editBtn);
    editBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick();
    ta('η φόρμα γέμισε με τα στοιχεία του αιτήματος',
      doc.getElementById('wDate').value === '2026-11-18' &&
      doc.getElementById('wShift').value === '10:00|18:00' &&
      doc.getElementById('wNotes').value === 'σχολή');
    ta('ο εργαζόμενος κλειδώνει σε επεξεργασία', doc.getElementById('wAgent').disabled === true);
    ta('το κουμπί έγινε Αποθήκευση', doc.getElementById('addWishBtn').textContent === 'Αποθήκευση');

    doc.getElementById('wShift').value = '08:00|16:00';
    doc.getElementById('addWishBtn').dispatchEvent(new window.Event('click'));
    await tick(); await tick();
    const put = calls.find((c) => c.method === 'PUT');
    ta('η αποθήκευση κάνει PUT /api/wishes/11', !!put && /\/api\/wishes\/11$/.test(put.url));
    ta('το PUT στέλνει το νέο ωράριο', !!put && put.body.start_time === '08:00' && put.body.end_time === '16:00');
    ta('η φόρμα επανήλθε σε Καταχώρηση', doc.getElementById('addWishBtn').textContent === 'Καταχώρηση');

    // --- Διαγραφή ---
    window.confirm = () => true;
    doc.querySelector('#wishTable tbody button[data-del]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick(); await tick();
    const del = calls.find((c) => c.method === 'DELETE' && c.url.startsWith('/api/wishes'));
    ta('η διαγραφή κάνει DELETE με ids', !!del && Array.isArray(del.body.ids) && del.body.ids[0] === 11);
  }

  // Το πάνελ αποτελεσμάτων στην οθόνη προγράμματος
  {
    const html = read('public/schedule.html');
    ta('υπάρχει πάνελ επιθυμητών ωρών', html.includes('id="wishPanel"') && html.includes('id="wishList"'));
    ta('ξεκινά κρυφό (εμφανίζεται μόνο αν υπάρχουν αιτήματα)', /id="wishPanel"[^>]*display:\s*none/.test(html));
    ta('υπάρχουν στυλ για τις 3 καταστάσεις',
      ['wish-ok', 'wish-part', 'wish-no'].every((c) => html.includes(c)));
    const js = read('public/js/schedule.js');
    ta('το schedule.js ζωγραφίζει τα αποτελέσματα', js.includes('renderWishes'));
    ta('εμφανίζει και την αιτιολόγηση', /x\.reason/.test(js));
    ta('δείχνει και τι πήρε ο εργαζόμενος', /x\.got/.test(js));
  }

  console.log(`\n${fail === 0 ? '✔ ΟΛΑ ΠΕΡΑΣΑΝ' : '✘ ' + fail + ' ΑΠΕΤΥΧΑΝ'}  (${pass} ok, ${fail} fail)\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nΣΦΑΛΜΑ ΕΚΤΕΛΕΣΗΣ:', e && e.stack ? e.stack : e);
  process.exit(1);
});
