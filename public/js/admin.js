// Admin Panel — διαχείριση αναφορών λαθών (14/11/2026).
//
// Όλα τα δεδομένα έρχονται από /api/reports/admin/* που προστατεύονται με
// requireAdmin στο backend. Το UI κρύβει/δείχνει, αλλά ΔΕΝ είναι η ασφάλεια:
// ένας employee που φτάσει εδώ παίρνει 403 από κάθε κλήση.
(function () {
  'use strict';

  const CATEGORY_LABELS = {
    WRONG_SHIFT: 'Λάθος βάρδια',
    WRONG_DAY_OFF: 'Λάθος ρεπό',
    WRONG_HOURS: 'Λάθος ωράριο',
    WRONG_ASSIGNMENT: 'Λάθος ανάθεση',
    VEGA_BANK: 'Vega Bank',
    CONSTRAINT_VIOLATION: 'Παραβίαση περιορισμού',
    OTHER: 'Άλλο'
  };
  const STATUS_LABELS = {
    NEW: 'Νέα', IN_REVIEW: 'Υπό εξέταση', RESOLVED: 'Επιλύθηκε', REJECTED: 'Απορρίφθηκε'
  };

  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  const fmtDate = (s) => (s ? String(s).slice(0, 10) : '—');
  const fmtDT = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? String(s).slice(0, 16).replace('T', ' ')
      : d.toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 403) {
      document.body.innerHTML = '<div class="empty-state">Δεν έχεις δικαίωμα πρόσβασης στο Admin Panel.</div>';
      throw new Error('forbidden');
    }
    if (res.status === 401) { location.href = '/login.html'; throw new Error('unauthorized'); }
    const data = await res.json().catch(() => ({ ok: false, error: 'Άκυρη απάντηση' }));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Σφάλμα');
    return data;
  }

  const statusBadge = (s) => el('span', { className: `badge st-${s}` }, STATUS_LABELS[s] || s);
  const catBadge = (c) => el('span', { className: 'badge cat' }, CATEGORY_LABELS[c] || c);

  // ---------- Πίνακας αναφορών ----------
  function renderTable(container, rows, onOpen) {
    container.textContent = '';
    if (!rows.length) {
      container.appendChild(el('div', { className: 'empty-state' }, 'Καμία αναφορά.'));
      return;
    }
    const thead = el('thead', {}, el('tr', {}, [
      el('th', {}, 'ID'), el('th', {}, 'Εργαζόμενος'), el('th', {}, 'Υποβλήθηκε'),
      el('th', {}, 'Αφορά'), el('th', {}, 'Κατηγορία'), el('th', {}, 'Περιγραφή'),
      el('th', {}, 'Κατάσταση'), el('th', {}, '')
    ]));
    const tbody = el('tbody');
    for (const r of rows) {
      const short = String(r.description || '');
      const btn = el('button', { className: 'btn small primary', type: 'button' }, 'Άνοιγμα');
      btn.addEventListener('click', () => onOpen(r.id));
      tbody.appendChild(el('tr', {}, [
        el('td', {}, '#' + r.id),
        el('td', {}, r.userName || '—'),
        el('td', {}, fmtDT(r.created_at)),
        el('td', {}, fmtDate(r.issue_date)),
        el('td', {}, catBadge(r.category)),
        el('td', { title: short }, short.length > 90 ? short.slice(0, 90) + '…' : short),
        el('td', {}, statusBadge(r.status)),
        el('td', {}, btn)
      ]));
    }
    container.appendChild(el('table', { className: 'data' }, [thead, tbody]));
  }

  // ---------- Modal λεπτομερειών ----------
  async function openReport(id) {
    let data;
    try { data = await api('/api/reports/admin/' + id); } catch (e) { toast(e.message); return; }
    const r = data.report;

    const row = (label, value) => el('div', { className: 'rd-row' }, [el('strong', {}, label), el('span', {}, value)]);

    const statusSel = el('select', {});
    for (const s of ['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']) {
      const o = el('option', { value: s }, STATUS_LABELS[s]);
      if (s === r.status) o.selected = true;
      statusSel.appendChild(o);
    }
    const saveStatus = el('button', { className: 'btn primary small', type: 'button' }, 'Αλλαγή κατάστασης');

    const timeline = el('ul', { className: 'timeline' });
    for (const h of data.history) {
      timeline.appendChild(el('li', {}, `${fmtDT(h.created_at)} — ${h.from_status ? STATUS_LABELS[h.from_status] + ' → ' : 'Δημιουργία: '}${STATUS_LABELS[h.to_status] || h.to_status}${h.byName ? ' (' + h.byName + ')' : ''}`));
    }

    const notesWrap = el('div', {});
    const renderNotes = (notes) => {
      notesWrap.textContent = '';
      if (!notes.length) notesWrap.appendChild(el('p', { className: 'muted' }, 'Καμία σημείωση.'));
      for (const n of notes) {
        notesWrap.appendChild(el('div', { className: 'note-item' }, [
          el('div', { className: 'note-meta' }, `${n.authorName || 'Admin'} · ${fmtDT(n.created_at)}`),
          el('div', {}, n.note)
        ]));
      }
    };
    renderNotes(data.notes);

    const noteTa = el('textarea', { rows: 2, placeholder: 'Νέα εσωτερική σημείωση…', style: 'width:100%' });
    const addNote = el('button', { className: 'btn small', type: 'button' }, 'Προσθήκη σημείωσης');

    const modal = el('div', { className: 'modal report-detail' }, [
      el('h2', {}, `Αναφορά #${r.id}`),
      row('Εργαζόμενος', r.userName || '—'),
      row('Υποβλήθηκε', fmtDT(r.created_at)),
      row('Αφορά την ημερομηνία', fmtDate(r.issue_date)),
      el('div', { className: 'rd-row' }, [el('strong', {}, 'Κατηγορία'), catBadge(r.category)]),
      el('div', { className: 'rd-row' }, [el('strong', {}, 'Κατάσταση'), statusBadge(r.status)]),
      r.related_shift ? row('Σχετική βάρδια', r.related_shift) : null,
      el('div', { style: 'margin-top:.8rem' }, [
        el('strong', { style: 'font-size:.85rem;color:#56607a' }, 'Περιγραφή'),
        el('pre', { className: 'rd-text' }, String(r.description || ''))
      ]),
      r.extra_info ? el('div', { style: 'margin-top:.6rem' }, [
        el('strong', { style: 'font-size:.85rem;color:#56607a' }, 'Επιπλέον πληροφορίες'),
        el('pre', { className: 'rd-text' }, String(r.extra_info))
      ]) : null,
      el('fieldset', { style: 'margin-top:1.1rem' }, [
        el('legend', {}, 'Διαχείριση'),
        el('div', { style: 'display:flex;gap:.6rem;align-items:center;flex-wrap:wrap' }, [statusSel, saveStatus])
      ]),
      el('fieldset', { style: 'margin-top:.9rem' }, [
        el('legend', {}, [document.createTextNode('Εσωτερικές σημειώσεις'), el('span', { className: 'admin-only-tag' }, 'ΜΟΝΟ ADMIN')]),
        notesWrap,
        el('div', { style: 'margin-top:.5rem' }, [noteTa]),
        el('div', { style: 'margin-top:.4rem' }, [addNote])
      ]),
      el('fieldset', { style: 'margin-top:.9rem' }, [el('legend', {}, 'Ιστορικό ενεργειών'), timeline])
    ]);

    const closeBtn = el('button', { className: 'btn', type: 'button' }, 'Κλείσιμο');
    modal.appendChild(el('div', { className: 'modal-actions' }, [closeBtn]));

    const backdrop = el('div', { className: 'modal-backdrop' }, [modal]);
    const close = () => { backdrop.remove(); refreshAll(); };
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);

    saveStatus.addEventListener('click', async () => {
      saveStatus.disabled = true;
      try {
        const out = await api(`/api/reports/admin/${r.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: statusSel.value })
        });
        toast(out.unchanged ? 'Η κατάσταση ήταν ήδη αυτή.' : `Κατάσταση → ${STATUS_LABELS[out.status]}`);
        backdrop.remove();
        openReport(r.id);
      } catch (e) { toast(e.message); saveStatus.disabled = false; }
    });

    addNote.addEventListener('click', async () => {
      const note = noteTa.value.trim();
      if (!note) { toast('Γράψε τη σημείωση.'); return; }
      addNote.disabled = true;
      try {
        await api(`/api/reports/admin/${r.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note })
        });
        noteTa.value = '';
        const fresh = await api('/api/reports/admin/' + r.id);
        renderNotes(fresh.notes);
        toast('Η σημείωση προστέθηκε.');
      } catch (e) { toast(e.message); }
      addNote.disabled = false;
    });
  }

  // ---------- Φόρτωση ενοτήτων ----------
  async function loadStats() {
    const d = await api('/api/reports/admin/stats');
    $('stTotal').textContent = d.stats.total;
    $('stNew').textContent = d.stats.NEW;
    $('stReview').textContent = d.stats.IN_REVIEW;
    $('stResolved').textContent = d.stats.RESOLVED;
    $('stRejected').textContent = d.stats.REJECTED;
    const b = $('notifBadge');
    b.textContent = d.unreadNotifications;
    b.classList.toggle('zero', d.unreadNotifications === 0);
    const recent = await api('/api/reports/admin/list?status=NEW');
    renderTable($('recentWrap'), recent.reports.slice(0, 8), openReport);
  }

  function filterQuery() {
    const p = new URLSearchParams();
    const add = (k, v) => { if (v) p.set(k, v); };
    add('q', $('fQ').value.trim());
    add('status', $('fStatus').value);
    add('category', $('fCategory').value);
    add('userId', $('fUser').value);
    add('from', $('fFrom').value);
    add('to', $('fTo').value);
    return p.toString();
  }

  async function loadReports() {
    const d = await api('/api/reports/admin/list?' + filterQuery());
    renderTable($('reportsWrap'), d.reports, openReport);
    $('listCount').textContent = `${d.reports.length} αναφορές`;
  }

  async function loadHistory() {
    const [a, b] = await Promise.all([
      api('/api/reports/admin/list?status=RESOLVED'),
      api('/api/reports/admin/list?status=REJECTED')
    ]);
    const rows = [...a.reports, ...b.reports].sort((x, y) => y.id - x.id);
    renderTable($('historyWrap'), rows, openReport);
  }

  async function loadNotifications() {
    const d = await api('/api/reports/admin/notifications');
    const wrap = $('notifWrap');
    wrap.textContent = '';
    if (!d.notifications.length) {
      wrap.appendChild(el('div', { className: 'empty-state' }, 'Καμία ειδοποίηση.'));
    }
    for (const n of d.notifications) {
      const item = el('div', { className: 'notif-item ' + (n.is_read ? 'read' : 'unread') }, [
        el('span', { className: 'dot' }),
        el('span', {}, n.message),
        n.status ? statusBadge(n.status) : null,
        el('time', {}, fmtDT(n.created_at))
      ]);
      item.addEventListener('click', () => openReport(n.report_id));
      wrap.appendChild(item);
    }
    $('notifCount').textContent = `${d.unread} μη αναγνωσμένες`;
    const b = $('notifBadge');
    b.textContent = d.unread;
    b.classList.toggle('zero', d.unread === 0);
  }

  async function loadSettings() {
    const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
    const d = await api('/api/reports/admin/stats');
    const body = $('settingsBody');
    body.textContent = '';
    body.appendChild(el('div', {}, `Συνδεδεμένος ως: ${me.displayName || '—'}`));
    body.appendChild(el('div', {}, `Ρόλος: ${me.isAdmin ? 'ADMIN' : 'EMPLOYEE'}`));
    body.appendChild(el('div', {}, `Δικαίωμα επεξεργασίας agents: ${me.canEditAgents ? 'ναι' : 'όχι'}`));
    body.appendChild(el('div', {}, `Σύνολο αναφορών στο σύστημα: ${d.stats.total}`));
    body.appendChild(el('div', {}, `Μη αναγνωσμένες ειδοποιήσεις: ${d.unreadNotifications}`));
    body.appendChild(el('p', { className: 'muted', style: 'margin:.8rem 0 0' },
      'Τα δικαιώματα admin ορίζονται στη στήλη users.is_admin. Για αλλαγή: node scripts/set_admin.js <username> on|off'));
  }

  const LOADERS = {
    dashboard: loadStats,
    reports: loadReports,
    history: loadHistory,
    notifications: loadNotifications,
    settings: loadSettings
  };
  let currentTab = 'dashboard';

  async function show(tab) {
    currentTab = tab;
    for (const b of document.querySelectorAll('.admin-tabs button')) {
      b.classList.toggle('active', b.dataset.tab === tab);
    }
    for (const s of document.querySelectorAll('main > section')) {
      s.hidden = s.id !== 'tab-' + tab;
    }
    try { await LOADERS[tab](); } catch (e) { if (e.message !== 'forbidden') toast(e.message); }
  }

  async function refreshAll() {
    try {
      await loadStats();
      if (currentTab !== 'dashboard') await LOADERS[currentTab]();
    } catch { /* το api() έχει ήδη χειριστεί 401/403 */ }
  }

  // ---------- Αρχικοποίηση ----------
  (async function init() {
    for (const b of document.querySelectorAll('.admin-tabs button')) {
      b.addEventListener('click', () => show(b.dataset.tab));
    }
    for (const id of ['fQ', 'fStatus', 'fCategory', 'fUser', 'fFrom', 'fTo']) {
      const node = $(id);
      node.addEventListener(id === 'fQ' ? 'input' : 'change', () => {
        if (currentTab === 'reports') loadReports().catch((e) => toast(e.message));
      });
    }
    $('fClear').addEventListener('click', () => {
      for (const id of ['fQ', 'fStatus', 'fCategory', 'fUser', 'fFrom', 'fTo']) $(id).value = '';
      loadReports().catch((e) => toast(e.message));
    });
    $('markAllRead').addEventListener('click', async () => {
      try {
        const out = await api('/api/reports/admin/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true })
        });
        toast(`${out.marked} ειδοποιήσεις σημάνθηκαν.`);
        loadNotifications();
      } catch (e) { toast(e.message); }
    });
    $('logoutBtn').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      location.href = '/login.html';
    });

    // Κατηγορίες στο φίλτρο
    for (const [v, label] of Object.entries(CATEGORY_LABELS)) {
      $('fCategory').appendChild(el('option', { value: v }, label));
    }

    try {
      const me = await fetch('/api/me').then((r) => (r.ok ? r.json() : null));
      if (!me || !me.ok) { location.href = '/login.html'; return; }
      $('userName').textContent = me.displayName || '';
      if (!me.isAdmin) {
        document.querySelector('main').innerHTML =
          '<div class="empty-state">Δεν έχεις δικαίωμα πρόσβασης στο Admin Panel.</div>';
        return;
      }
      // Εργαζόμενοι στο φίλτρο
      const u = await api('/api/reports/admin/users');
      for (const x of u.users) {
        $('fUser').appendChild(el('option', { value: String(x.id) }, `${x.name} (${x.reportCount})`));
      }
      await show('dashboard');
    } catch (e) {
      if (e.message !== 'forbidden' && e.message !== 'unauthorized') toast(e.message);
    }
  })();
})();
