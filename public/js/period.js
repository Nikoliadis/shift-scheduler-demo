// Οθόνη Περιόδου: επιλογή μήνα/διαστήματος με στρογγυλοποίηση σε εβδομάδες
// Δευ-Κυρ, καταχώρηση αδειών/αιτημάτων ρεπό (και σε διάστημα ημερομηνιών),
// λίστα καταχωρήσεων με διαγραφή.
(() => {
  const DAY_GR = ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'];
  const TYPE_LABELS = { leave: 'Άδεια', repo_request: 'Αίτημα ρεπό', sick: 'Ασθένεια' };
  const TYPE_CLASS = { leave: 'type-leave', repo_request: 'type-repo', sick: 'type-sick' };

  const $ = (id) => document.getElementById(id);
  let previewData = null; // αποτέλεσμα τελευταίου υπολογισμού εβδομάδων

  async function api(url, options = {}) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Απαιτείται σύνδεση');
    }
    return r.json();
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // 'YYYY-MM-DD' → 'Δευ 29/6' ή με έτος
  function fmtGr(s, withYear = false) {
    const [y, m, d] = s.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return `${DAY_GR[dow]} ${d}/${m}` + (withYear ? `/${y}` : '');
  }

  // ---------- Περίοδος ----------
  function getStoredPeriod() {
    try {
      return JSON.parse(localStorage.getItem('selectedPeriod'));
    } catch {
      return null;
    }
  }

  function showActivePeriod() {
    const p = getStoredPeriod();
    const el = $('activePeriod');
    if (!p) {
      el.style.display = 'none';
      $('listRange').textContent = '(όλες)';
      return;
    }
    el.style.display = 'block';
    el.innerHTML = `<strong>Ενεργή περίοδος:</strong> ${fmtGr(p.weeks[0].start, true)} — ${fmtGr(p.weeks[p.weeks.length - 1].end, true)} (${p.weeks.length} εβδομάδες)` +
      (p.label ? ` · ${esc(p.label)}` : '');
    $('listRange').textContent = `(${fmtGr(p.weeks[0].start)} — ${fmtGr(p.weeks[p.weeks.length - 1].end, true)})`;
  }

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      const month = document.querySelector('input[name="mode"]:checked').value === 'month';
      $('monthField').style.display = month ? '' : 'none';
      $('fromField').style.display = month ? 'none' : '';
      $('toField').style.display = month ? 'none' : '';
      $('weeksPreview').innerHTML = '';
      $('confirmBtn').style.display = 'none';
      previewData = null;
    })
  );

  $('calcBtn').addEventListener('click', async () => {
    $('periodErr').textContent = '';
    $('weeksPreview').innerHTML = '';
    $('confirmBtn').style.display = 'none';
    previewData = null;

    const mode = document.querySelector('input[name="mode"]:checked').value;
    let qs;
    let label = '';
    if (mode === 'month') {
      const m = $('inMonth').value;
      if (!m) return ($('periodErr').textContent = 'Επίλεξε μήνα');
      qs = 'month=' + m;
      const [y, mm] = m.split('-').map(Number);
      const NOMINATIVE = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
        'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
      label = NOMINATIVE[mm - 1] + ' ' + y;
    } else {
      const f = $('inFrom').value;
      const t = $('inTo').value;
      if (!f || !t) return ($('periodErr').textContent = 'Συμπλήρωσε και τις δύο ημερομηνίες');
      qs = `from=${f}&to=${t}`;
      label = '';
    }

    const d = await api('/api/period/weeks?' + qs);
    if (!d.ok) return ($('periodErr').textContent = d.error);

    previewData = { from: d.from, to: d.to, weeks: d.weeks, label };
    const chips = d.weeks
      .map((w, i) => `<div class="week-chip">Εβδομάδα ${i + 1}<small>${fmtGr(w.start)} — ${fmtGr(w.end, true)}</small></div>`)
      .join('');
    $('weeksPreview').innerHTML =
      `<p class="muted" style="margin-bottom:0">Η περίοδος στρογγυλοποιείται σε <strong>${d.weeks.length} πλήρεις εβδομάδες Δευτέρα–Κυριακή</strong>:</p>` +
      `<div class="weeks-list">${chips}</div>`;
    $('confirmBtn').style.display = '';
  });

  $('confirmBtn').addEventListener('click', () => {
    if (!previewData) return;
    localStorage.setItem('selectedPeriod', JSON.stringify(previewData));
    toast('Η περίοδος ορίστηκε');
    showActivePeriod();
    loadTimeOff();
    loadWishes();
  });

  // ---------- Time off ----------
  async function loadAgentsSelect() {
    const d = await api('/api/agents');
    if (!d.ok) return;
    for (const id of ['toAgent', 'wAgent']) {
      const sel = $(id);
      if (!sel) continue;
      sel.innerHTML = '<option value="">— Επίλεξε agent —</option>';
      for (const a of d.agents) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.full_name;
        sel.appendChild(o);
      }
    }
  }

  async function loadTimeOff() {
    const p = getStoredPeriod();
    let qs = '';
    if (p) qs = `?from=${p.weeks[0].start}&to=${p.weeks[p.weeks.length - 1].end}`;
    const d = await api('/api/timeoff' + qs);
    if (!d.ok) return toast('Σφάλμα: ' + d.error);

    const tbody = document.querySelector('#timeoffTable tbody');
    tbody.innerHTML = '';
    $('emptyMsg').style.display = d.entries.length ? 'none' : '';
    for (const e of d.entries) {
      const tr = document.createElement('tr');
      const days = e.ids.length;
      tr.innerHTML = `
        <td><strong>${esc(e.agent_name)}</strong></td>
        <td><span class="badge ${TYPE_CLASS[e.type]}">${TYPE_LABELS[e.type]}</span></td>
        <td>${fmtGr(e.date_from, true)}</td>
        <td>${e.date_from === e.date_to ? '—' : fmtGr(e.date_to, true)}</td>
        <td>${days}</td>
        <td class="muted">${esc(e.notes || '')}</td>
        <td><button class="btn small danger" data-ids="${e.ids.join(',')}">Διαγραφή</button></td>`;
      tbody.appendChild(tr);
    }
  }

  document.querySelector('#timeoffTable tbody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-ids]');
    if (!btn) return;
    if (!confirm('Διαγραφή της καταχώρησης;')) return;
    const ids = btn.dataset.ids.split(',').map(Number);
    const d = await api('/api/timeoff', { method: 'DELETE', body: JSON.stringify({ ids }) });
    if (d.ok) {
      toast('Διαγράφηκε');
      loadTimeOff();
    } else {
      toast('Σφάλμα: ' + d.error);
    }
  });

  $('addTimeOffBtn').addEventListener('click', async () => {
    $('timeoffErr').textContent = '';
    const payload = {
      agent_id: Number($('toAgent').value) || null,
      type: $('toType').value,
      date_from: $('toFrom').value,
      date_to: $('toTo').value || undefined,
      notes: $('toNotes').value.trim() || null
    };
    if (!payload.agent_id) return ($('timeoffErr').textContent = 'Επίλεξε agent');
    if (!payload.date_from) return ($('timeoffErr').textContent = 'Επίλεξε ημερομηνία');

    const d = await api('/api/timeoff', { method: 'POST', body: JSON.stringify(payload) });
    if (d.ok) {
      toast(`Καταχωρήθηκε (${d.days} μέρα/ες)`);
      $('toFrom').value = '';
      $('toTo').value = '';
      $('toNotes').value = '';
      loadTimeOff();
    } else {
      $('timeoffErr').textContent = d.error;
    }
  });

  // ---------- Επιθυμητές ώρες εργασίας (15/11/2026) ----------
  // Soft αιτήματα. Η φόρμα λειτουργεί και ως επεξεργασία: όταν editWishId
  // είναι ορισμένο, η «Καταχώρηση» γίνεται «Αποθήκευση» και κάνει PUT.
  let editWishId = null;

  // Οι βάρδιες που ΥΠΑΡΧΟΥΝ στο σύστημα — δεν επινοούνται νέα ωράρια.
  // Έρχονται από τον server (shift_requirements + filler-βάρδιες του engine).
  async function loadWishShifts() {
    const d = await api('/api/wishes/shifts').catch(() => null);
    const sel = $('wShift');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Επίλεξε βάρδια —</option>';
    for (const sh of (d && d.ok ? d.shifts : [])) {
      const o = document.createElement('option');
      o.value = `${sh.start}|${sh.end}`;
      o.textContent = `${sh.start}–${sh.end}`;
      sel.appendChild(o);
    }
  }

  function resetWishForm() {
    editWishId = null;
    $('wDate').value = '';
    $('wShift').value = '';
    $('wNotes').value = '';
    $('wAgent').disabled = false;
    $('addWishBtn').textContent = 'Καταχώρηση';
    $('cancelWishBtn').style.display = 'none';
    $('wishErr').textContent = '';
  }

  // 'HH:MM:SS' ή 'HH:MM' → 'HH:MM'
  const hm = (t) => String(t || '').slice(0, 5);

  async function loadWishes() {
    const p = getStoredPeriod();
    let qs = '';
    if (p) qs = `?from=${p.weeks[0].start}&to=${p.weeks[p.weeks.length - 1].end}`;
    $('wishRange').textContent = p ? '' : '(όλα)';
    const d = await api('/api/wishes' + qs);
    if (!d.ok) return toast('Σφάλμα: ' + d.error);

    const tbody = document.querySelector('#wishTable tbody');
    tbody.innerHTML = '';
    $('wishEmptyMsg').style.display = d.entries.length ? 'none' : '';
    if (d.needsMigration) {
      $('wishEmptyMsg').textContent = 'Ο πίνακας επιθυμητών ωρών δεν έχει δημιουργηθεί ακόμα.';
      $('wishEmptyMsg').style.display = '';
      return;
    }
    for (const e of d.entries) {
      const tr = document.createElement('tr');
      // Σύγκρουση με άδεια/ρεπό: το αίτημα δεν θα μπορεί να ικανοποιηθεί
      const conflict = e.conflict_type
        ? ` <span class="badge type-${e.conflict_type === 'leave' ? 'leave' : e.conflict_type === 'sick' ? 'sick' : 'repo'}">${
            TYPE_LABELS[e.conflict_type] || e.conflict_type}</span>`
        : '';
      tr.innerHTML = `
        <td><strong>${esc(e.full_name)}</strong>${e.active ? '' : ' <span class="muted">(ανενεργός)</span>'}</td>
        <td>${fmtGr(e.date, true)}${conflict}</td>
        <td><strong>${esc(hm(e.start_time))}–${esc(hm(e.end_time))}</strong></td>
        <td class="muted">${esc(e.notes || '')}</td>
        <td>
          <button class="btn small" data-edit="${e.id}">Επεξεργασία</button>
          <button class="btn small danger" data-del="${e.id}">Διαγραφή</button>
        </td>`;
      tr.dataset.agent = e.agent_id;
      tr.dataset.date = e.date;
      tr.dataset.start = hm(e.start_time);
      tr.dataset.end = hm(e.end_time);
      tr.dataset.notes = e.notes || '';
      tbody.appendChild(tr);
    }
  }

  document.querySelector('#wishTable tbody').addEventListener('click', async (ev) => {
    const del = ev.target.closest('button[data-del]');
    if (del) {
      if (!confirm('Διαγραφή του αιτήματος;')) return;
      const d = await api('/api/wishes', { method: 'DELETE', body: JSON.stringify({ ids: [Number(del.dataset.del)] }) });
      if (d.ok) { toast('Διαγράφηκε'); resetWishForm(); loadWishes(); }
      else toast('Σφάλμα: ' + d.error);
      return;
    }
    const edit = ev.target.closest('button[data-edit]');
    if (!edit) return;
    const tr = edit.closest('tr');
    editWishId = Number(edit.dataset.edit);
    $('wAgent').value = tr.dataset.agent;
    $('wAgent').disabled = true; // ο εργαζόμενος δεν αλλάζει σε επεξεργασία
    $('wDate').value = tr.dataset.date;
    $('wShift').value = `${tr.dataset.start}|${tr.dataset.end}`;
    $('wNotes').value = tr.dataset.notes;
    $('addWishBtn').textContent = 'Αποθήκευση';
    $('cancelWishBtn').style.display = '';
    if ($('wDate').scrollIntoView) $('wDate').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  $('cancelWishBtn').addEventListener('click', resetWishForm);

  $('addWishBtn').addEventListener('click', async () => {
    $('wishErr').textContent = '';
    const agentId = Number($('wAgent').value) || null;
    const date = $('wDate').value;
    const [start_time, end_time] = ($('wShift').value || '').split('|');
    const notes = $('wNotes').value.trim() || null;

    if (!editWishId && !agentId) return ($('wishErr').textContent = 'Επίλεξε εργαζόμενο');
    if (!date) return ($('wishErr').textContent = 'Επίλεξε ημερομηνία');
    if (!start_time || !end_time) return ($('wishErr').textContent = 'Επίλεξε επιθυμητή βάρδια');

    const d = editWishId
      ? await api('/api/wishes/' + editWishId, { method: 'PUT', body: JSON.stringify({ date, start_time, end_time, notes }) })
      : await api('/api/wishes', { method: 'POST', body: JSON.stringify({ agent_id: agentId, date, start_time, end_time, notes }) });

    if (d.ok) {
      toast(editWishId ? 'Αποθηκεύτηκε' : 'Καταχωρήθηκε');
      if (d.warning) $('wishErr').textContent = d.warning;
      const keepWarning = d.warning;
      resetWishForm();
      if (keepWarning) $('wishErr').textContent = keepWarning;
      loadWishes();
    } else {
      $('wishErr').textContent = d.error;
    }
  });

  // ---------- Auth / εκκίνηση ----------
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  (async () => {
    const me = await api('/api/me').catch(() => null);
    if (me && me.ok) $('userName').textContent = me.displayName;
    showActivePeriod();
    await loadAgentsSelect();
    await loadWishShifts();
    await loadTimeOff();
    await loadWishes();
  })();
})();
