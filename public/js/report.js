// Κουμπί «Αναφορά Λάθους» + modal φόρμας (14/11/2026).
//
// Μπαίνει σε ΚΑΘΕ σελίδα της εφαρμογής με ένα μόνο <script>. Το κουμπί
// εισάγεται δυναμικά ΑΡΙΣΤΕΡΑ από το όνομα χρήστη, ώστε να μην αλλάξει
// καθόλου το υπάρχον markup του header. Το modal χτίζεται με DOM API
// (όχι innerHTML με δεδομένα χρήστη) — καμία έκθεση σε XSS.
(function () {
  'use strict';

  const CATEGORIES = [
    ['WRONG_SHIFT', 'Λάθος βάρδια'],
    ['WRONG_DAY_OFF', 'Λάθος ρεπό'],
    ['WRONG_HOURS', 'Λάθος ωράριο'],
    ['WRONG_ASSIGNMENT', 'Λάθος ανάθεση εργαζομένου'],
    ['VEGA_BANK', 'Πρόβλημα με Vega Bank'],
    ['CONSTRAINT_VIOLATION', 'Παραβίαση περιορισμού εργαζομένου'],
    ['OTHER', 'Άλλο']
  ];

  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of [].concat(children)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = el('div', { id: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  let backdrop = null;
  let submitting = false;   // φράγμα διπλής υποβολής (γρήγορα clicks)

  function closeModal() {
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }

  function openModal() {
    if (backdrop) return;   // ήδη ανοιχτό

    const catSel = el('select', { id: 'rpCategory', required: true });
    catSel.appendChild(el('option', { value: '' }, '— Διάλεξε κατηγορία —'));
    for (const [v, label] of CATEGORIES) catSel.appendChild(el('option', { value: v }, label));

    const dateIn = el('input', { type: 'date', id: 'rpDate', required: true });
    dateIn.value = new Date().toISOString().slice(0, 10);

    const descTa = el('textarea', {
      id: 'rpDesc', rows: 5, required: true,
      placeholder: 'Περιγράψε αναλυτικά το πρόβλημα (τουλάχιστον 10 χαρακτήρες)…'
    });
    const shiftIn = el('input', { type: 'text', id: 'rpShift', placeholder: 'π.χ. 23:00-07:00 Vega Bank' });
    const extraTa = el('textarea', { id: 'rpExtra', rows: 2, placeholder: 'Ό,τι άλλο βοηθά…' });

    const whoSpan = el('input', {
      type: 'text', id: 'rpWho', disabled: true, readOnly: true,
      value: (document.getElementById('userName') || {}).textContent || 'Ο λογαριασμός μου'
    });

    const errDiv = el('div', { className: 'error-msg', id: 'rpErr' });
    const sendBtn = el('button', { className: 'btn primary', id: 'rpSend', type: 'submit' }, 'Υποβολή αναφοράς');
    const cancelBtn = el('button', { className: 'btn', type: 'button' }, 'Ακύρωση');
    cancelBtn.addEventListener('click', closeModal);

    const field = (labelText, control, full) => {
      const l = el('label', { className: 'field' + (full ? ' full' : '') });
      l.appendChild(el('span', {}, labelText));
      l.appendChild(control);
      return l;
    };

    const grid = el('div', { className: 'form-grid' }, [
      field('Εργαζόμενος (αυτόματα)', whoSpan),
      field('Ημερομηνία προβλήματος *', dateIn),
      field('Κατηγορία προβλήματος *', catSel, true),
      field('Περιγραφή προβλήματος *', descTa, true),
      field('Σχετική βάρδια (προαιρετικό)', shiftIn),
      field('Επιπλέον πληροφορίες (προαιρετικό)', extraTa)
    ]);

    const form = el('form', { className: 'report-form', noValidate: true }, [
      grid,
      errDiv,
      el('div', { className: 'modal-actions' }, [cancelBtn, sendBtn])
    ]);

    const modal = el('div', { className: 'modal report-modal' }, [
      el('h2', {}, '⚠ Αναφορά Λάθους'),
      el('p', { className: 'muted' }, 'Η αναφορά πηγαίνει στον διαχειριστή. Το όνομά σου συμπληρώνεται αυτόματα.'),
      form
    ]);

    backdrop = el('div', { className: 'modal-backdrop' }, [modal]);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
    document.body.appendChild(backdrop);
    catSel.focus();

    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;            // διπλό click
      errDiv.textContent = '';

      if (!catSel.value) { errDiv.textContent = 'Διάλεξε κατηγορία προβλήματος.'; return; }
      if (!dateIn.value) { errDiv.textContent = 'Δώσε την ημερομηνία του προβλήματος.'; return; }
      if (descTa.value.trim().length < 10) { errDiv.textContent = 'Η περιγραφή θέλει τουλάχιστον 10 χαρακτήρες.'; return; }

      submitting = true;
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      sendBtn.textContent = 'Υποβολή…';
      try {
        const res = await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: catSel.value,
            issueDate: dateIn.value,
            description: descTa.value.trim(),
            relatedShift: shiftIn.value.trim(),
            extraInfo: extraTa.value.trim()
          })
        });
        const data = await res.json().catch(() => ({ ok: false, error: 'Άκυρη απάντηση' }));
        if (!res.ok || !data.ok) throw new Error(data.error || 'Η υποβολή απέτυχε');
        closeModal();
        toast(data.duplicate ? 'Η αναφορά είχε ήδη υποβληθεί.' : `✓ Η αναφορά #${data.id} υποβλήθηκε.`);
      } catch (err) {
        errDiv.textContent = err.message;
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
        sendBtn.textContent = 'Υποβολή αναφοράς';
      } finally {
        submitting = false;
      }
    });
  }

  // ---------- Εισαγωγή κουμπιού στο header, ΑΡΙΣΤΕΡΑ από το username ----------
  function mount(me) {
    const userBox = document.querySelector('.topbar .user');
    if (!userBox || document.getElementById('reportBtn')) return;

    const btn = el('button', {
      className: 'btn small report-btn',
      id: 'reportBtn',
      type: 'button',
      title: 'Αναφορά λάθους στο πρόγραμμα'
    });
    btn.appendChild(el('span', { className: 'report-ico', 'aria-hidden': 'true' }, '⚠'));
    btn.appendChild(el('span', { className: 'report-label' }, 'Αναφορά'));
    btn.addEventListener('click', openModal);

    const nameEl = document.getElementById('userName');
    userBox.insertBefore(btn, nameEl || userBox.firstChild);

    // Σύνδεσμος Admin Panel — ΜΟΝΟ για admin (ο server το επιβάλλει κι από μόνος του)
    if (me && me.isAdmin) {
      const nav = document.querySelector('.topbar nav');
      if (nav && !document.getElementById('adminLink')) {
        const a = el('a', { href: '/admin.html', id: 'adminLink', className: 'admin-link' }, 'Admin');
        nav.appendChild(a);
      }
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/me');
      const me = res.ok ? await res.json() : null;
      mount(me);
    } catch {
      mount(null);   // το κουμπί μπαίνει και χωρίς /api/me
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
