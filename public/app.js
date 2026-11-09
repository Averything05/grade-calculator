(() => {
  'use strict';

  const { summarize, semesterSummary, formatGrade, fmt } = window.GradeCalc;

  const $ = (sel, el = document) => el.querySelector(sel);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.documentElement;
  const subjectsEl = $('#subjects');
  const emptyEl = $('#empty');
  const errorEl = $('#error');
  const scaleEl = $('#scale');
  const authEl = $('#auth');
  const appEl = $('#app');
  const authForm = $('#auth-form');
  const authSubmit = $('#auth-submit');
  const tabLogin = $('#tab-login');
  const tabRegister = $('#tab-register');
  const accountBtn = $('#account-btn');
  const whoamiEl = $('#whoami');
  const dialog = $('#account-dialog');
  const semesterEl = $('#semester');
  const semesterStatsEl = $('#semester-stats');
  const semesterNoteEl = $('#semester-note');

  let subjects = [];
  let user = null;
  let scale = 'percent';
  try { scale = localStorage.getItem('scale') || 'percent'; } catch { /* storage unavailable */ }
  scaleEl.value = scale;
  if (scaleEl.value !== scale) { scale = 'percent'; scaleEl.value = scale; }

  // ---------- small helpers ----------

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const valueAttr = (v) => (v === null || v === undefined ? '' : esc(v));
  const clampPct = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  const localDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  const errMsg = (err) =>
    err instanceof TypeError ? 'Could not reach the server. Is it running?' : err.message;

  let errorTimer;
  function showError(msg, kind) {
    errorEl.textContent = msg || '';
    errorEl.classList.toggle('ok', kind === 'ok');
    clearTimeout(errorTimer);
    if (msg) errorTimer = setTimeout(() => { errorEl.textContent = ''; }, 6000);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/login') && url !== '/api/me') {
      showAuth(); // session expired, or logged out in another tab
      throw new Error('Your session expired. Please log in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  const findSubject = (id) => subjects.find((s) => s.id === Number(id));
  const findCard = (id) => subjectsEl.querySelector(`[data-subject="${id}"]`);

  // ---------- theme (light / dark) ----------

  const themeBtn = $('#theme-toggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const THEME_COLORS = { light: '#F8FAFC', dark: '#0B0F19' };
  let themeTimer;

  const currentTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  function syncThemeUi() {
    const t = currentTheme();
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    if (themeMeta) themeMeta.content = THEME_COLORS[t];
  }

  function setTheme(theme, save) {
    root.classList.add('theme-anim'); // short cross-fade between the two palettes
    root.dataset.theme = theme;
    syncThemeUi();
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove('theme-anim'), 450);
    if (save) { try { localStorage.setItem('theme', theme); } catch { /* ignore */ } }
  }

  themeBtn.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));

  // Follow the device setting until the student picks a theme themselves.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* ignore */ }
    if (saved !== 'light' && saved !== 'dark') setTheme(e.matches ? 'dark' : 'light', false);
  });
  syncThemeUi();

  // ---------- background spotlight (follows the cursor on desktop) ----------

  (() => {
    const bg = $('#bg');
    if (!bg || !matchMedia('(hover: hover) and (pointer: fine)').matches || reducedMotion()) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    addEventListener('pointermove', (e) => {
      x = e.clientX;
      y = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        bg.style.setProperty('--mx', `${(x / innerWidth) * 100}%`);
        bg.style.setProperty('--my', `${(y / innerHeight) * 100}%`);
      });
    }, { passive: true });
  })();

  // ---------- numbers that count up ----------

  function formatValue(kind, v) {
    switch (kind) {
      case 'grade': return formatGrade(v, scale);
      case 'pct': return `${fmt(v)}%`;
      case 'gpa': return v.toFixed(2);
      default: return fmt(v);
    }
  }

  function statHTML(label, key, kind, value, cls = '') {
    const has = value !== null && value !== undefined && Number.isFinite(value);
    const body = has
      ? `<div class="stat-value" data-count="${key}" data-kind="${kind}" data-val="${value}">${esc(formatValue(kind, value))}</div>`
      : '<div class="stat-value">—</div>';
    return `<div class="stat ${cls}"><div class="stat-label">${label}</div>${body}</div>`;
  }

  /** Rolls each [data-count] number from its previous value (or 0 the first time) to its new one. */
  function animateStats(container) {
    const prev = container._prev;
    const first = !prev;
    const next = {};
    const token = (container._token = (container._token || 0) + 1);
    const startAt = performance.now() + (first ? container._delay || 0 : 0);

    container.querySelectorAll('[data-count]').forEach((el) => {
      const key = el.dataset.count;
      const kind = el.dataset.kind;
      const to = Number(el.dataset.val);
      next[key] = to;
      const from = first ? 0 : prev[key];
      if (reducedMotion() || from === undefined || from === to) return; // text is already final
      const duration = first ? 900 : 380;
      el.textContent = formatValue(kind, from);
      const step = (now) => {
        if (container._token !== token) return;
        const t = Math.max(0, Math.min(1, (now - startAt) / duration));
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = formatValue(kind, t >= 1 ? to : from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    container._prev = Object.keys(next).length ? next : undefined;
  }

  /** Jump every number to its final value (used before printing so nothing is mid-count). */
  function settleStats() {
    document.querySelectorAll('.stats, .summary-stats').forEach((c) => { c._token = (c._token || 0) + 1; });
    document.querySelectorAll('[data-count]').forEach((el) => {
      el.textContent = formatValue(el.dataset.kind, Number(el.dataset.val));
    });
  }

  // ---------- per-subject summary ----------

  function summaryParts(s) {
    if (!s.components.length) {
      return { stats: '', verdict: '<p class="muted">Add components below (quizzes, exams, projects…) to see your grade.</p>' };
    }
    const target = Number.isFinite(s.target) ? s.target : 0;
    const r = summarize(s.components, target);
    const t = fmt(target);

    if (r.status === 'empty') {
      return { stats: '', verdict: '<p class="verdict warn">Give at least one component a weight above 0 to see results.</p>' };
    }

    const note =
      Math.abs(r.totalWeight - 100) > 0.001
        ? `<p class="note">Weights add up to ${fmt(r.totalWeight)}%, not 100%. Results are scaled to your total.</p>`
        : '';

    const stats = `
      <div class="stats">
        ${statHTML('Current grade', 'current', 'grade', r.current, 'accent')}
        ${statHTML('Best possible', 'best', 'grade', r.bestPossible)}
        <div class="stat"><div class="stat-label">Graded so far</div><div class="stat-value">${fmt(r.gradedWeight)} / ${fmt(r.totalWeight)}%</div></div>
      </div>
      <div class="meter" role="img" aria-label="${fmt(r.secured)}% locked in, up to ${fmt(r.bestPossible)}% possible, target ${t}%">
        <span class="meter-possible" style="width:${clampPct(r.bestPossible)}%"></span>
        <span class="meter-locked" style="width:${clampPct(r.secured)}%"></span>
        <span class="meter-tick" style="left:${clampPct(target)}%"></span>
      </div>
      <p class="legend">
        <span><i class="dot locked"></i>Locked in ${fmt(r.secured)}%</span>
        <span><i class="dot possible"></i>Up to ${fmt(r.bestPossible)}%</span>
        <span><i class="dot tick"></i>Target ${t}%</span>
      </p>`;

    const f = (p) => formatGrade(p, scale);
    const left = r.ungraded.map((c) => esc(c.name)).join(', ');
    let verdict;
    switch (r.status) {
      case 'complete': {
        const met = r.finalGrade + 1e-9 >= target;
        verdict = `<p class="verdict ${met ? 'ok' : 'bad'}">Final grade: <strong>${f(r.finalGrade)}</strong>. ${
          met ? 'You hit' : 'You finished below'} your target of ${t}%.</p>`;
        break;
      }
      case 'secured':
        verdict = `<p class="verdict ok">Target secured. You've already locked in enough for ${t}%, even with a zero on the remaining ${fmt(r.remainingWeight)}%.</p>`;
        break;
      case 'unreachable':
        verdict = `<p class="verdict bad">A target of ${t}% is out of reach. Even perfect scores on what's left top out at ${f(r.bestPossible)}.</p>`;
        break;
      default:
        verdict = `<p class="verdict ${r.required >= 90 ? 'warn' : 'ok'}">To reach ${t}%, you need an average of <strong>${fmt(r.required)}%</strong> on the remaining ${fmt(r.remainingWeight)}% (${left}).</p>`;
    }
    return { stats, verdict: note + verdict };
  }

  /** first = the card just appeared, so play the entrance (count-up + meter grow). */
  function renderSummary(s, card, first = false, index = 0) {
    const box = $('.summary', card);
    const statsBox = $('.summary-stats', box);
    const { stats, verdict } = summaryParts(s);
    if (first) statsBox._delay = 220 + index * 80;
    statsBox.innerHTML = stats;
    $('.summary-verdict', box).innerHTML = verdict;
    animateStats(statsBox);
    if (first) {
      box.classList.add('animate');
      clearTimeout(box._animTimer);
      box._animTimer = setTimeout(() => box.classList.remove('animate'), 1800);
    }
  }

  // ---------- semester overview ----------

  function renderSemester() {
    if (!subjects.length) {
      semesterEl.hidden = true;
      semesterStatsEl._prev = undefined;
      return;
    }
    semesterEl.hidden = false;
    const r = semesterSummary(subjects);

    if (r.counted) {
      semesterStatsEl.innerHTML = [
        statHTML('Units counted', 'units', 'num', r.units),
        statHTML('Average', 'avg', 'pct', r.percent, 'accent'),
        statHTML('GPA (4.0 scale)', 'us', 'gpa', r.gpaUS),
        statHTML('Grade (1.0–5.0)', 'ph', 'gpa', r.gpaPH),
      ].join('');
    } else {
      semesterStatsEl.innerHTML = '<p class="muted">Enter a score in any subject to see your semester GPA.</p>';
    }
    animateStats(semesterStatsEl);

    const n = r.skipped.length;
    semesterNoteEl.classList.toggle('neutral', n === 0);
    semesterNoteEl.textContent =
      n > 0
        ? `${n} subject${n > 1 ? 's' : ''} not counted yet (no scores entered, or units missing).`
        : 'Based on the grades entered so far, weighted by each subject’s units.';
  }

  // ---------- rendering cards ----------

  function rowHTML(c) {
    return `
      <tr data-component="${c.id}">
        <td class="c-name" data-label="Component"><input data-field="name" value="${valueAttr(c.name)}" maxlength="100" aria-label="Component name"></td>
        <td data-label="Weight %"><input data-field="weight" type="number" inputmode="decimal" min="0" max="100" step="any" value="${valueAttr(c.weight)}" aria-label="Weight percent"></td>
        <td data-label="Score"><input data-field="score" type="number" inputmode="decimal" min="0" step="any" value="${valueAttr(c.score)}" placeholder="—" aria-label="Score"></td>
        <td data-label="Out of"><input data-field="maxScore" type="number" inputmode="decimal" min="0.01" step="any" value="${valueAttr(c.maxScore)}" aria-label="Out of"></td>
        <td class="c-del"><button type="button" class="icon-btn small danger-hover" data-action="delete-component" aria-label="Delete ${esc(c.name)}">${ICON_TRASH}</button></td>
      </tr>`;
  }

  function cardHTML(s) {
    const rows = s.components.length
      ? s.components.map(rowHTML).join('')
      : '<tr class="empty-row"><td colspan="5">No components yet. Add your first one below.</td></tr>';
    return `
      <article class="card" data-subject="${s.id}">
        <header class="card-head">
          <input class="subject-name" value="${valueAttr(s.name)}" maxlength="100" aria-label="Subject name">
          <label class="field units"><span>Units</span>
            <input class="subject-units" type="number" inputmode="decimal" min="0.1" max="30" step="any" value="${valueAttr(s.units)}">
          </label>
          <label class="field target"><span>Target %</span>
            <input class="subject-target" type="number" inputmode="decimal" min="0" max="100" step="any" value="${valueAttr(s.target)}">
          </label>
          <button type="button" class="icon-btn small danger-hover" data-action="delete-subject" aria-label="Delete subject ${esc(s.name)}">${ICON_TRASH}</button>
        </header>
        <table class="comp-table">
          <thead><tr><th>Component</th><th>Weight %</th><th>Score</th><th>Out of</th><th><span class="sr-only"></span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <form class="add-component" autocomplete="off">
          <label class="field name"><span>New component</span>
            <input name="name" placeholder="e.g. Midterm exam" maxlength="100" required>
          </label>
          <label class="field"><span>Weight %</span>
            <input name="weight" type="number" inputmode="decimal" min="0" max="100" step="any" required>
          </label>
          <label class="field"><span>Score</span>
            <input name="score" type="number" inputmode="decimal" min="0" step="any" placeholder="optional">
          </label>
          <label class="field"><span>Out of</span>
            <input name="maxScore" type="number" inputmode="decimal" min="0.01" step="any" value="100">
          </label>
          <button type="submit" class="btn primary">Add component</button>
        </form>
        <div class="summary">
          <div class="summary-stats"></div>
          <div class="summary-verdict" aria-live="polite"></div>
        </div>
      </article>`;
  }

  function cardEl(s, { enter = false, index = 0 } = {}) {
    const t = document.createElement('template');
    t.innerHTML = cardHTML(s).trim();
    const el = t.content.firstElementChild;
    if (enter) {
      el.classList.add('enter');
      el.style.setProperty('--i', index);
    }
    return el;
  }

  function updateEmpty() { emptyEl.hidden = subjects.length > 0; }

  function renderAll() {
    const cards = subjects.map((s, i) => {
      const el = cardEl(s, { enter: true, index: i });
      renderSummary(s, el, true, i);
      return el;
    });
    subjectsEl.replaceChildren(...cards);
    updateEmpty();
    renderSemester();
  }

  function rerenderCard(s, { enter = false, index = 0 } = {}) {
    const old = findCard(s.id);
    const el = cardEl(s, { enter, index });
    if (old) {
      $('.summary-stats', el)._prev = $('.summary-stats', old)._prev; // keep counting from the old numbers
      old.replaceWith(el);
    } else {
      subjectsEl.append(el);
    }
    renderSummary(s, el, enter, index);
    updateEmpty();
    return el;
  }

  function refreshSummaries() {
    subjects.forEach((s) => {
      const card = findCard(s.id);
      if (card) renderSummary(s, card, false);
    });
    renderSemester();
  }

  // ---------- data ----------

  async function load() {
    try {
      subjects = await api('GET', '/api/subjects');
      renderAll();
    } catch (err) {
      showError(errMsg(err));
    }
  }

  // Copy what's typed in an input into local state so results update live.
  function syncFromDom(el) {
    const card = el.closest('[data-subject]');
    if (!card) return null;
    const s = findSubject(card.dataset.subject);
    if (!s) return null;

    const row = el.closest('[data-component]');
    if (row) {
      const c = s.components.find((x) => x.id === Number(row.dataset.component));
      const field = el.dataset.field;
      if (!c || !field) return null;
      c[field] = field === 'name' ? el.value : num(el.value);
      return { s, c, card };
    }
    if (el.classList.contains('subject-name')) { s.name = el.value; return { s, card }; }
    if (el.classList.contains('subject-target')) { s.target = num(el.value); return { s, card }; }
    if (el.classList.contains('subject-units')) { s.units = num(el.value); return { s, card }; }
    return null;
  }

  // ---------- subject and component events ----------

  subjectsEl.addEventListener('input', (e) => {
    const r = syncFromDom(e.target);
    if (!r) return;
    renderSummary(r.s, r.card, false);
    renderSemester();
  });

  subjectsEl.addEventListener('change', async (e) => {
    const r = syncFromDom(e.target);
    if (!r) return;
    try {
      if (r.c) {
        await api('PUT', `/api/components/${r.c.id}`, {
          name: r.c.name, weight: r.c.weight, score: r.c.score, maxScore: r.c.maxScore,
        });
      } else {
        await api('PUT', `/api/subjects/${r.s.id}`, { name: r.s.name, target: r.s.target, units: r.s.units });
      }
    } catch (err) {
      showError(errMsg(err));
      await load(); // put the screen back in sync with what's actually saved
    }
  });

  subjectsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-subject]');
    const s = findSubject(card.dataset.subject);
    if (!s) return;

    try {
      if (btn.dataset.action === 'delete-subject') {
        if (!confirm(`Delete "${s.name}" and all its components?`)) return;
        await api('DELETE', `/api/subjects/${s.id}`);
        subjects = subjects.filter((x) => x !== s);
        card.remove();
        updateEmpty();
        renderSemester();
      } else if (btn.dataset.action === 'delete-component') {
        const id = Number(btn.closest('[data-component]').dataset.component);
        await api('DELETE', `/api/components/${id}`);
        s.components = s.components.filter((c) => c.id !== id);
        rerenderCard(s);
        renderSemester();
      }
    } catch (err) {
      showError(errMsg(err));
    }
  });

  subjectsEl.addEventListener('submit', async (e) => {
    const form = e.target.closest('form.add-component');
    if (!form) return;
    e.preventDefault();
    const s = findSubject(form.closest('[data-subject]').dataset.subject);
    const data = new FormData(form);
    try {
      const c = await api('POST', `/api/subjects/${s.id}/components`, {
        name: data.get('name'),
        weight: num(data.get('weight')),
        score: num(data.get('score')),
        maxScore: num(data.get('maxScore')) ?? 100,
      });
      s.components.push(c);
      const el = rerenderCard(s);
      renderSemester();
      $('.add-component input[name="name"]', el).focus();
    } catch (err) {
      showError(errMsg(err));
    }
  });

  $('#subject-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    try {
      const s = await api('POST', '/api/subjects', {
        name: data.get('name'),
        units: num(data.get('units')),
        target: num(data.get('target')),
      });
      subjects.push(s);
      const el = rerenderCard(s, { enter: true, index: 0 });
      renderSemester();
      form.reset();
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      $('.add-component input[name="name"]', el).focus({ preventScroll: true });
    } catch (err) {
      showError(errMsg(err));
    }
  });

  scaleEl.addEventListener('change', () => {
    scale = scaleEl.value;
    try { localStorage.setItem('scale', scale); } catch { /* ignore */ }
    refreshSummaries();
  });

  // ---------- export: CSV and print ----------

  const round2 = (n) => Math.round(n * 100) / 100;

  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    let s = typeof v === 'number' ? String(round2(v)) : String(v);
    // Stop spreadsheet apps from running a name like "=SUM(A1)" as a formula.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function statusText(r, target) {
    switch (r.status) {
      case 'complete': return `Final grade ${fmt(r.finalGrade)}% (${r.finalGrade + 1e-9 >= target ? 'target met' : 'below target'})`;
      case 'secured': return 'Target secured';
      case 'unreachable': return 'Target out of reach';
      case 'needed': return `Need ${fmt(r.required)}% average on the remaining ${fmt(r.remainingWeight)}%`;
      default: return '';
    }
  }

  function buildCsv() {
    const lines = [];
    const row = (...cells) => lines.push(cells.map(csvCell).join(','));

    row('Subject', 'Units', 'Target (%)', 'Component', 'Weight (%)', 'Score', 'Out of', 'Score (%)');
    for (const s of subjects) {
      if (!s.components.length) { row(s.name, s.units, s.target); continue; }
      for (const c of s.components) {
        const pct = c.score !== null && c.maxScore > 0 ? (c.score / c.maxScore) * 100 : null;
        row(s.name, s.units, s.target, c.name, c.weight, c.score, c.maxScore, pct);
      }
    }

    lines.push('');
    row('Subject summary');
    row('Subject', 'Units', 'Current grade (%)', 'GPA (4.0)', 'Grade (1.0-5.0)', 'Target (%)', 'Status');
    for (const s of subjects) {
      const r = summarize(s.components, s.target);
      const g = r.current === null ? [null, null] : [window.GradeCalc.toUS(r.current).gpa, window.GradeCalc.toPH(r.current)];
      row(s.name, s.units, r.current, g[0], g[1], s.target, statusText(r, s.target));
    }

    const sem = semesterSummary(subjects);
    if (sem.counted) {
      lines.push('');
      row('Semester', 'Units counted', 'Average (%)', 'GPA (4.0)', 'Grade (1.0-5.0)');
      row('', sem.units, sem.percent, sem.gpaUS, sem.gpaPH);
    }
    return lines.join('\r\n');
  }

  $('#export-csv').addEventListener('click', () => {
    if (!subjects.length) { showError('Add a subject first, then export.'); return; }
    const blob = new Blob(['﻿', buildCsv()], { type: 'text/csv;charset=utf-8' }); // BOM keeps Excel happy
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `grades-${localDate()}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#print-btn').addEventListener('click', () => {
    if (!subjects.length) { showError('Add a subject first, then print.'); return; }
    window.print();
  });

  addEventListener('beforeprint', () => {
    settleStats();
    $('#print-meta').textContent = `Grade report${user ? ` for ${user.username}` : ''} · ${localDate()}`;
  });

  // ---------- account: dialog, change password, delete ----------

  const passwordForm = $('#password-form');
  const passwordMsg = $('#password-msg');
  const deleteForm = $('#delete-form');
  const deleteMsg = $('#delete-msg');

  function setMsg(el, text, kind) {
    el.textContent = text || '';
    el.className = `form-msg${kind ? ` ${kind}` : ''}`;
  }

  accountBtn.addEventListener('click', () => {
    $('#dlg-user').textContent = user ? user.username : '';
    passwordForm.reset();
    deleteForm.reset();
    setMsg(passwordMsg, '');
    setMsg(deleteMsg, '');
    dialog.showModal();
  });
  $('#account-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // click on the dimmed backdrop

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(passwordForm);
    if (data.get('newPassword') !== data.get('confirmPassword')) {
      setMsg(passwordMsg, 'The new passwords do not match.', 'bad');
      return;
    }
    const submit = $('button[type="submit"]', passwordForm);
    submit.disabled = true;
    try {
      await api('POST', '/api/password', {
        currentPassword: data.get('currentPassword'),
        newPassword: data.get('newPassword'),
      });
      passwordForm.reset();
      setMsg(passwordMsg, 'Password updated. Your other devices were signed out.', 'ok');
    } catch (err) {
      setMsg(passwordMsg, errMsg(err), 'bad');
    } finally {
      submit.disabled = false;
    }
  });

  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Permanently delete your account and all your grades? This cannot be undone.')) return;
    const submit = $('button[type="submit"]', deleteForm);
    submit.disabled = true;
    try {
      await api('DELETE', '/api/account', { password: new FormData(deleteForm).get('password') });
      showAuth();
      showError('Your account was deleted.', 'ok');
    } catch (err) {
      setMsg(deleteMsg, errMsg(err), 'bad');
    } finally {
      submit.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('POST', '/api/logout'); } catch { /* already logged out */ }
    showError('');
    showAuth();
    authForm.elements.username.focus();
  });

  // ---------- log in / sign up ----------

  let authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    const isLogin = mode === 'login';
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabRegister.setAttribute('aria-selected', String(!isLogin));
    authSubmit.textContent = isLogin ? 'Log in' : 'Create account';
    authForm.elements.password.autocomplete = isLogin ? 'current-password' : 'new-password';
    showError('');
  }

  function showAuth() {
    if (dialog.open) dialog.close();
    user = null;
    subjects = [];
    subjectsEl.replaceChildren();
    semesterEl.hidden = true;
    appEl.hidden = true;
    accountBtn.hidden = true;
    authEl.hidden = false;
  }

  function showApp(u) {
    user = u;
    whoamiEl.textContent = u.username;
    authEl.hidden = true;
    appEl.hidden = false;
    accountBtn.hidden = false;
    return load();
  }

  tabLogin.addEventListener('click', () => setAuthMode('login'));
  tabRegister.addEventListener('click', () => setAuthMode('register'));

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(authForm);
    authSubmit.disabled = true;
    try {
      const u = await api('POST', `/api/${authMode}`, {
        username: data.get('username'),
        password: data.get('password'),
      });
      authForm.reset();
      showError('');
      await showApp(u);
    } catch (err) {
      showError(errMsg(err));
    } finally {
      authSubmit.disabled = false;
    }
  });

  async function init() {
    try {
      await showApp(await api('GET', '/api/me'));
    } catch {
      showAuth();
    }
  }

  init();
})();
