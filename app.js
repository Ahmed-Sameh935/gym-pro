(() => {
  'use strict';

  const KEY = 'gympro.data.v1';
  const TYPES = { single: 'Single arm', hand: 'Per hand', total: 'Total', bar: 'Weight + bar' };
  const STEPS = [1, 2.5, 5, 10];
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');

  /* ---------------- data ---------------- */

  function isValid(d) {
    return d && Array.isArray(d.muscles) && Array.isArray(d.exercises) && Array.isArray(d.records);
  }

  function loadDb() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (isValid(saved)) return saved;
    } catch (e) { /* fall through to the starting data */ }
    return JSON.parse(JSON.stringify(window.GYM_SEED));
  }

  let db = loadDb();
  db.settings = db.settings || { unit: 'kg' };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      toast('Could not save. The phone storage is full.');
      return false;
    }
  }

  const unit = () => db.settings.unit || 'kg';
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const muscleById = (id) => db.muscles.find((m) => m.id === id);
  const exercisesOf = (mid) => db.exercises.filter((e) => e.m === mid);
  const recordsOf = (eid) => db.records.filter((r) => r.ex === eid);

  /* ---------------- formatting ---------------- */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => String(round2(n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Accepts "22.5", "22,5" and Arabic-Indic digits typed from an Arabic keyboard.
  function parseNum(text) {
    const latin = String(text ?? '')
      .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660)
      .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06F0)
      .replace(/[٫,]/g, '.')
      .trim();
    if (latin === '') return null;
    const n = Number(latin);
    return Number.isFinite(n) ? n : null;
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const daysAgo = (s) => Math.round((toDate(todayStr()) - toDate(s)) / 86400000);

  function dateLabel(s) {
    const n = daysAgo(s);
    if (n === 0) return 'Today';
    if (n === 1) return 'Yesterday';
    const d = toDate(s);
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-GB', opts);
  }
  const whenLabel = (r) => (r.d ? dateLabel(r.d) : r.src === 'old' ? 'Older sheet' : 'From your sheet');

  function weightText(r) {
    if (r.mode === 'bw') return 'Body weight';
    if (r.mode === 'full') return 'Full stack';
    if (r.w == null) return '';
    return r.mode === 'plates' ? plural(fmt(r.w), 'plate') : `${fmt(r.w)} ${unit()}`;
  }
  function summary(r) {
    const w = weightText(r);
    if (w && r.reps != null) return `${w} × ${r.reps}`;
    return w || (r.reps != null ? plural(r.reps, 'rep') : '');
  }
  function numsHTML(r) {
    let w = '';
    if (r.mode === 'bw' || r.mode === 'full') w = `<span class="num">${weightText(r)}</span>`;
    else if (r.w != null) w = `<span class="num">${fmt(r.w)}</span><small>${r.mode === 'plates' ? 'plates' : unit()}</small>`;
    const reps = r.reps != null ? `<span class="num">${r.reps}</span>` : '';
    return w && reps ? `${w}<span class="x">×</span>${reps}` : w || (reps ? `${reps}<small>reps</small>` : '');
  }
  function metaHTML(r, withDate) {
    const bits = [];
    if (r.type) bits.push(`<span class="tag">${TYPES[r.type]}</span>`);
    if (r.sets != null) bits.push(`<span>${plural(r.sets, 'set')}</span>`);
    if (withDate) bits.push(`<span>${esc(whenLabel(r))}</span>`);
    if (r.note) bits.push(`<span>${esc(r.note)}</span>`);
    return bits.join('');
  }

  // +1 heavier / more reps, -1 lighter / fewer reps, 0 same or not comparable.
  function trend(cur, prev) {
    if (!cur || !prev || cur.mode !== prev.mode) return 0;
    if (cur.w != null && prev.w != null && cur.w !== prev.w) return cur.w > prev.w ? 1 : -1;
    if (cur.reps != null && prev.reps != null && cur.reps !== prev.reps) return cur.reps > prev.reps ? 1 : -1;
    return 0;
  }

  /* ---------------- small UI helpers ---------------- */

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const backIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const binIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>';

  // Bottom sheet with a few fields. Resolves to the values, 'delete', or null when cancelled.
  function openSheet({ title, fields, okLabel = 'Save', deleteLabel }) {
    return new Promise((resolve) => {
      const dlg = $('#sheet');
      const form = $('#sheet-form');
      const del = $('#sheet-delete');
      $('#sheet-title').textContent = title;
      $('#sheet-ok').textContent = okLabel;
      del.hidden = !deleteLabel;
      del.textContent = deleteLabel || '';
      $('#sheet-fields').innerHTML = fields.map((f) => {
        const label = `<label for="f-${f.name}">${esc(f.label)}</label>`;
        if (f.type === 'select') {
          const options = f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
          return `${label}<select class="field" id="f-${f.name}" name="${f.name}">${options}</select>`;
        }
        return `${label}<input class="field" id="f-${f.name}" name="${f.name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" required maxlength="60" autocomplete="off">`;
      }).join('');

      let result = null;
      const onSubmit = (e) => { e.preventDefault(); result = Object.fromEntries(new FormData(form)); dlg.close(); };
      const onCancel = () => dlg.close();
      const onDelete = () => { result = 'delete'; dlg.close(); };
      const onClose = () => {
        form.removeEventListener('submit', onSubmit);
        $('#sheet-cancel').removeEventListener('click', onCancel);
        del.removeEventListener('click', onDelete);
        dlg.removeEventListener('close', onClose);
        resolve(result);
      };
      form.addEventListener('submit', onSubmit);
      $('#sheet-cancel').addEventListener('click', onCancel);
      del.addEventListener('click', onDelete);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  async function giveFile(name, text, type) {
    const blob = new Blob([text], { type });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
      try {
        const file = new File([blob], name, { type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------------- views ---------------- */

  // Each view fills #view and returns the handlers for events inside it.
  let handlers = {};

  function viewHome() {
    const tiles = db.muscles.map((m) => {
      const exs = exercisesOf(m.id);
      const ids = new Set(exs.map((e) => e.id));
      const lastDay = db.records.reduce((best, r) => (r.d && ids.has(r.ex) && r.d > best ? r.d : best), '');
      const trained = lastDay ? `, ${dateLabel(lastDay).toLowerCase()}` : '';
      const pic = m.img
        ? `<img src="${esc(m.img)}" alt="" width="320" height="320">`
        : `<span class="ph" aria-hidden="true">${esc(m.name.slice(0, 1).toUpperCase())}</span>`;
      return `<li><a class="muscle" href="#/m/${esc(m.id)}">${pic}
        <span class="muscle-name">${esc(m.name)}</span>
        <span class="muscle-meta">${plural(exs.length, 'exercise')}${trained}</span></a></li>`;
    }).join('');

    view.innerHTML = `
      <header class="home-head">
        <h1>Gym Pro</h1>
        <p class="sub">Pick the muscle you're training today.</p>
      </header>
      <ul class="muscles">${tiles}
        <li><button class="muscle add" data-act="add-muscle">Add a muscle</button></li>
      </ul>`;

    return {
      async click(act) {
        if (act !== 'add-muscle') return;
        const v = await openSheet({ title: 'New muscle', okLabel: 'Add muscle', fields: [{ name: 'name', label: 'Name', placeholder: 'Glutes' }] });
        if (!v || !v.name.trim()) return;
        const m = { id: uid('m'), name: v.name.trim(), img: null };
        db.muscles.push(m);
        save();
        location.hash = `#/m/${m.id}`;
      },
    };
  }

  function viewMuscle(id) {
    const m = muscleById(id);
    if (!m) return viewMissing();
    const exs = exercisesOf(id);

    const rows = exs.map((ex) => {
      const recs = recordsOf(ex.id);
      const last = recs[recs.length - 1];
      const t = trend(last, recs[recs.length - 2]);
      const arrow = t > 0 ? '<span class="trend-up" aria-label="Went up">▲</span>' : t < 0 ? '<span class="trend-down" aria-label="Went down">▼</span>' : '';
      const nums = last ? numsHTML(last) : '';
      return `<li><a class="ex" href="#/e/${esc(ex.id)}">
        <span class="ex-main">
          <span class="ex-name">${esc(ex.name)}</span>
          <span class="ex-meta">${last ? metaHTML(last, true) : '<span>Nothing logged yet</span>'}</span>
        </span>
        ${nums ? `<span class="ex-num">${arrow} ${nums}</span>` : ''}
      </a></li>`;
    }).join('');

    view.innerHTML = `
      <div class="bar">
        <a href="#/">${backIcon}Muscles</a>
        <button data-act="edit-muscle">Edit</button>
      </div>
      <h1>${esc(m.name)}</h1>
      ${exs.length ? `<ul class="exlist">${rows}</ul>` : '<p class="empty">No exercises here yet. Add the first one you do for this muscle.</p>'}
      <button class="btn wide below" data-act="add-exercise">Add an exercise</button>`;

    return {
      async click(act) {
        if (act === 'add-exercise') {
          const v = await openSheet({ title: `New ${m.name.toLowerCase()} exercise`, okLabel: 'Add exercise', fields: [{ name: 'name', label: 'Name', placeholder: 'Cable fly' }] });
          if (!v || !v.name.trim()) return;
          const ex = { id: uid('e'), m: id, name: v.name.trim() };
          db.exercises.push(ex);
          save();
          location.hash = `#/e/${ex.id}`;
        }
        if (act === 'edit-muscle') {
          const v = await openSheet({ title: 'Edit muscle', fields: [{ name: 'name', label: 'Name', value: m.name }], deleteLabel: 'Delete this muscle' });
          if (v === 'delete') {
            const ids = new Set(exs.map((e) => e.id));
            const nRecs = db.records.filter((r) => ids.has(r.ex)).length;
            if (!confirm(`Delete ${m.name} with its ${plural(exs.length, 'exercise')} and ${plural(nRecs, 'record')}? This can't be undone.`)) return;
            db.records = db.records.filter((r) => !ids.has(r.ex));
            db.exercises = db.exercises.filter((e) => e.m !== id);
            db.muscles = db.muscles.filter((x) => x.id !== id);
            save();
            location.hash = '#/';
          } else if (v && v.name.trim()) {
            m.name = v.name.trim();
            save();
            render(false);
          }
        }
      },
    };
  }

  function chartHTML(recs) {
    const pts = recs.filter((r) => r.mode === 'w' && r.w != null).slice(-20);
    if (pts.length < 2) return '<p class="hint">The line shows up once this exercise has two records with a weight.</p>';
    const W = 320, H = 132, L = 34, R = 12, T = 14, B = 12;
    const vals = pts.map((r) => r.w);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const line = pts.map((r, i) => `${x(i).toFixed(1)},${y(r.w).toFixed(1)}`).join(' ');
    const dots = pts.map((r, i) => {
      const lastOne = i === pts.length - 1;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(r.w).toFixed(1)}" r="${lastOne ? 5 : 3.5}" fill="${lastOne ? 'var(--red)' : 'var(--paper)'}" stroke="${lastOne ? 'var(--red)' : 'var(--iron)'}" stroke-width="2"/>`;
    }).join('');
    const realLo = Math.min(...vals), realHi = Math.max(...vals);
    const guides = (realLo === realHi ? [realHi] : [realHi, realLo]).map((v) =>
      `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 4"/>
       <text class="axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('');
    return `<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over your last ${pts.length} records, from ${fmt(vals[0])} to ${fmt(vals[vals.length - 1])} ${unit()}">
        ${guides}
        <polyline points="${line}" fill="none" stroke="var(--iron)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="chart-ends"><span>${esc(whenLabel(pts[0]))}</span><span>${esc(whenLabel(pts[pts.length - 1]))}</span></div>
    </div>`;
  }

  function viewExercise(id) {
    const ex = db.exercises.find((e) => e.id === id);
    if (!ex) return viewMissing();
    const m = muscleById(ex.m);
    const recs = recordsOf(id);
    const last = recs[recs.length - 1];
    const today = todayStr();
    const editing = !!last && last.d === today; // a second save on the same day updates that day's record
    const prev = editing ? recs[recs.length - 2] : last;

    const f = {
      mode: last ? last.mode : 'w',
      w: last ? last.w : null,
      reps: last && last.reps != null ? last.reps : 10,
      sets: last && last.sets != null ? last.sets : 2,
      type: last ? last.type || '' : '',
      note: editing ? last.note || '' : '',
      step: STEPS.includes(ex.step) ? ex.step : 2.5,
    };

    let lastLine = 'No record yet. Set the numbers and save your first one.';
    if (editing) lastLine = `Logged today: <b>${esc(summary(last))}</b>. Saving again updates today's record.`;
    else if (last) lastLine = `Last time <b>${esc(summary(last))}</b>${last.type ? `, ${TYPES[last.type].toLowerCase()}` : ''}. ${esc(whenLabel(last))}.`;

    const pills = (name, options, value) => options.map(([v, label]) =>
      `<label><input type="radio" name="${name}" value="${v}"${String(v) === String(value) ? ' checked' : ''}><span>${label}</span></label>`).join('');

    const best = recs.filter((r) => r.mode === 'w' && r.w != null).reduce((b, r) => (!b || r.w > b.w || (r.w === b.w && (r.reps || 0) > (b.reps || 0)) ? r : b), null);

    const recRows = recs.slice().reverse().map((r) => `<li>
        <div class="rec-main">
          <div class="rec-nums">${numsHTML(r) || '<small>No numbers</small>'}</div>
          <div class="rec-meta">${metaHTML(r, true)}</div>
        </div>
        <button class="icon-btn" data-act="del-rec" data-id="${esc(r.id)}" aria-label="Delete the record from ${esc(whenLabel(r))}">${binIcon}</button>
      </li>`).join('');

    view.innerHTML = `
      <div class="bar">
        <a href="#/m/${esc(m ? m.id : '')}">${backIcon}${esc(m ? m.name : 'Muscles')}</a>
        <button data-act="edit-ex">Edit</button>
      </div>
      <h1>${esc(ex.name)}</h1>
      <p class="last">${lastLine}</p>

      <form id="log" novalidate>
        <div class="dial">
          <button type="button" class="step" data-act="w-dec" aria-label="Less weight">−</button>
          <div class="plate" id="plate"></div>
          <button type="button" class="step" data-act="w-inc" aria-label="More weight">+</button>
        </div>

        <fieldset id="step-row">
          <legend class="rowlabel">Each tap changes it by</legend>
          <div class="pills small">${pills('step', STEPS.map((s) => [s, fmt(s)]), f.step)}</div>
        </fieldset>

        <fieldset>
          <legend class="rowlabel">Measured in</legend>
          <div class="pills small">${pills('mode', [['w', unit()], ['plates', 'Plates'], ['bw', 'Body weight'], ['full', 'Full stack']], f.mode)}</div>
        </fieldset>

        <div class="pair">
          <div>
            <label class="rowlabel" for="reps">Reps</label>
            <div class="mini">
              <button type="button" data-act="reps-dec" aria-label="Fewer reps">−</button>
              <input id="reps" inputmode="numeric" value="${f.reps}" autocomplete="off">
              <button type="button" data-act="reps-inc" aria-label="More reps">+</button>
            </div>
          </div>
          <div>
            <label class="rowlabel" for="sets">Sets</label>
            <div class="mini">
              <button type="button" data-act="sets-dec" aria-label="Fewer sets">−</button>
              <input id="sets" inputmode="numeric" value="${f.sets}" autocomplete="off">
              <button type="button" data-act="sets-inc" aria-label="More sets">+</button>
            </div>
          </div>
        </div>

        <fieldset>
          <legend class="rowlabel">This weight is</legend>
          <div class="pills">${pills('type', [['single', 'Single arm'], ['hand', 'Per hand'], ['total', 'Total'], ['bar', 'Weight + bar'], ['', 'Not set']], f.type)}</div>
        </fieldset>

        <label class="rowlabel" for="note">Note</label>
        <input class="field" id="note" value="${esc(f.note)}" placeholder="Seat on 4, slow on the way down" maxlength="80" autocomplete="off">

        <div class="savebar"><button class="btn primary wide">${editing ? "Update today's record" : 'Save record'}</button></div>
      </form>

      <section class="block">
        <div class="block-head"><h2>Progress</h2>${best ? `<span>Best ${esc(summary(best))}</span>` : ''}</div>
        ${chartHTML(recs)}
      </section>

      ${recs.length ? `<section class="block">
        <div class="block-head"><h2>Records</h2><span>${recs.length} saved</span></div>
        <ul class="recs">${recRows}</ul>
      </section>` : ''}`;

    const plate = $('#plate');
    const numeric = () => f.mode === 'w' || f.mode === 'plates';

    function syncPlate() {
      const inp = $('#w');
      if (inp) inp.style.fontSize = inp.value.length > 4 ? '56px' : '';
      const heavier = f.mode === 'w' && prev && prev.mode === 'w' && prev.w != null && f.w != null && f.w > prev.w;
      plate.classList.toggle('heavier', !!heavier);
    }
    function drawPlate() {
      plate.innerHTML = numeric()
        ? `<input id="w" inputmode="decimal" aria-label="Weight" value="${f.w != null ? fmt(f.w) : ''}" placeholder="0" autocomplete="off">
           <span class="unit">${f.mode === 'plates' ? 'plates' : unit()}</span>`
        : `<span class="word">${f.mode === 'bw' ? 'Body weight' : 'Full stack'}</span>`;
      view.querySelectorAll('.step').forEach((b) => { b.disabled = !numeric(); });
      $('#step-row').hidden = f.mode !== 'w';
      syncPlate();
    }
    drawPlate();

    function bump(field, dir) {
      const inp = $('#' + field);
      const n = Math.max(0, Math.min(999, Math.round((parseNum(inp.value) ?? 0) + dir)));
      f[field] = n;
      inp.value = n;
    }

    return {
      async click(act, el) {
        if (act === 'w-dec' || act === 'w-inc') {
          const inp = $('#w');
          if (!inp) return;
          const stepSize = f.mode === 'plates' ? 1 : f.step;
          f.w = Math.max(0, round2((parseNum(inp.value) ?? 0) + (act === 'w-inc' ? stepSize : -stepSize)));
          inp.value = fmt(f.w);
          syncPlate();
        }
        if (act === 'reps-dec') bump('reps', -1);
        if (act === 'reps-inc') bump('reps', 1);
        if (act === 'sets-dec') bump('sets', -1);
        if (act === 'sets-inc') bump('sets', 1);

        if (act === 'del-rec') {
          const r = db.records.find((x) => x.id === el.dataset.id);
          if (!r || !confirm(`Delete this record (${summary(r) || 'no numbers'}, ${whenLabel(r).toLowerCase()})?`)) return;
          db.records = db.records.filter((x) => x.id !== r.id);
          save();
          render(false);
          toast('Record deleted');
        }

        if (act === 'edit-ex') {
          const v = await openSheet({
            title: 'Edit exercise',
            fields: [
              { name: 'name', label: 'Name', value: ex.name },
              { name: 'm', label: 'Muscle', type: 'select', value: ex.m, options: db.muscles.map((x) => ({ value: x.id, label: x.name })) },
            ],
            deleteLabel: 'Delete this exercise',
          });
          if (v === 'delete') {
            if (!confirm(`Delete ${ex.name} and its ${plural(recs.length, 'record')}? This can't be undone.`)) return;
            db.records = db.records.filter((r) => r.ex !== id);
            db.exercises = db.exercises.filter((e) => e.id !== id);
            save();
            location.hash = `#/m/${ex.m}`;
          } else if (v && v.name.trim()) {
            ex.name = v.name.trim();
            ex.m = v.m;
            save();
            render(false);
          }
        }
      },

      input(el) {
        if (el.id === 'w') { f.w = parseNum(el.value); syncPlate(); }
      },

      change(el) {
        if (el.name === 'step') f.step = Number(el.value);
        if (el.name === 'type') f.type = el.value;
        if (el.name === 'mode') {
          f.mode = el.value;
          if (f.mode === 'plates' && f.w != null) f.w = Math.round(f.w);
          drawPlate();
        }
      },

      submit() {
        let w = null;
        if (numeric()) {
          w = parseNum($('#w').value);
          if (w == null || w <= 0) {
            toast('Enter the weight first');
            $('#w').focus();
            return;
          }
        }
        const whole = (field, fallback) => {
          const n = parseNum($('#' + field).value);
          return n == null ? fallback : Math.max(0, Math.min(999, Math.round(n)));
        };
        const rec = {
          id: editing ? last.id : uid('r'),
          ex: id,
          d: today,
          mode: f.mode,
          w,
          reps: whole('reps', null),
          sets: whole('sets', null),
          type: f.type,
          note: $('#note').value.trim(),
        };
        if (editing) db.records[db.records.indexOf(last)] = rec;
        else db.records.push(rec);
        ex.step = f.step;
        if (!save()) return;
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

        const t = trend(rec, prev);
        let msg = prev ? 'Saved. Same as last time' : 'First record saved';
        if (t && rec.w != null && prev.w != null && rec.w !== prev.w) {
          const diff = fmt(Math.abs(rec.w - prev.w));
          const what = rec.mode === 'plates' ? plural(diff, 'plate') : `${diff} ${unit()}`;
          msg = `Saved. ${t > 0 ? 'Up' : 'Down'} ${what} from last time`;
        } else if (t) {
          const diff = Math.abs(rec.reps - prev.reps);
          msg = `Saved. ${plural(diff, t > 0 ? 'more rep' : 'fewer rep')} than last time`;
        }
        render(false);
        const p = $('#plate');
        if (p) p.classList.add('thunk');
        toast(msg);
      },
    };
  }

  function viewHistory() {
    const dated = db.records.filter((r) => r.d);
    const days = [...new Set(dated.map((r) => r.d))].sort().reverse();
    const exById = new Map(db.exercises.map((e) => [e.id, e]));

    const blocks = days.map((d) => {
      const recs = dated.filter((r) => r.d === d && exById.has(r.ex));
      const muscles = [...new Set(recs.map((r) => (muscleById(exById.get(r.ex).m) || {}).name).filter(Boolean))];
      const rows = recs.map((r) => {
        const ex = exById.get(r.ex);
        return `<li><a class="ex" href="#/e/${esc(ex.id)}">
          <span class="ex-main"><span class="ex-name">${esc(ex.name)}</span><span class="ex-meta">${metaHTML(r, false)}</span></span>
          <span class="ex-num">${numsHTML(r)}</span></a></li>`;
      }).join('');
      return `<section class="day"><h2>${esc(dateLabel(d))}<span>${esc(muscles.join(', '))}</span></h2><ul class="exlist" style="margin-top:0">${rows}</ul></section>`;
    }).join('');

    view.innerHTML = `
      <h1>History</h1>
      <p class="sub">What you logged, day by day.</p>
      ${blocks || '<p class="empty">Nothing logged in the app yet. Open an exercise, set the numbers and save. Each training day then shows up here.</p>'}`;
    return {};
  }

  let installPrompt = null;

  function viewSettings() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const nDated = db.records.filter((r) => r.d).length;

    view.innerHTML = `
      <h1>Backup</h1>
      <p class="sub">${plural(db.exercises.length, 'exercise')}, ${plural(db.records.length, 'record')}, ${nDated} of them logged in the app.</p>

      <section class="card">
        <h2>Your records live on this phone</h2>
        <p>Nothing is uploaded anywhere. Save a backup file now and then, so a lost or new phone doesn't cost you your history.</p>
        <button class="btn primary wide" data-act="backup">Save a backup file</button>
        <button class="btn wide" data-act="restore">Restore from a backup file</button>
        <input type="file" id="restore-file" accept=".json,application/json" hidden>
      </section>

      <section class="card">
        <h2>Open it in Excel</h2>
        <p>Every record as a table: muscle, exercise, date, weight, reps, sets and weight type.</p>
        <button class="btn wide" data-act="csv">Export for Excel</button>
      </section>

      <section class="card">
        <h2>Weights are in</h2>
        <div class="pills">
          <label><input type="radio" name="unit" value="kg"${unit() === 'kg' ? ' checked' : ''}><span>kg</span></label>
          <label><input type="radio" name="unit" value="lb"${unit() === 'lb' ? ' checked' : ''}><span>lb</span></label>
        </div>
      </section>

      ${standalone ? '' : `<section class="card">
        <h2>Put it on your home screen</h2>
        ${installPrompt ? '<p>It opens full screen and works without internet.</p><button class="btn wide" data-act="install">Install on this phone</button>' : `<ol>
          <li>Android, in Chrome: open the menu (three dots), then tap Add to Home screen.</li>
          <li>iPhone, in Safari: tap Share, then Add to Home Screen.</li>
        </ol>`}
      </section>`}`;

    return {
      async click(act) {
        if (act === 'backup') {
          await giveFile(`gym-pro-backup-${todayStr()}.json`, JSON.stringify(db, null, 1), 'application/json');
        }
        if (act === 'restore') $('#restore-file').click();
        if (act === 'csv') {
          const exById = new Map(db.exercises.map((e) => [e.id, e]));
          const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
          const lines = [['Muscle', 'Exercise', 'Date', 'Weight', 'Unit', 'Reps', 'Sets', 'Weight type', 'Note']];
          db.records.forEach((r) => {
            const ex = exById.get(r.ex);
            if (!ex) return;
            const weight = r.mode === 'bw' ? 'Body weight' : r.mode === 'full' ? 'Full stack' : r.w;
            const u = r.mode === 'w' ? unit() : r.mode === 'plates' ? 'plates' : '';
            lines.push([(muscleById(ex.m) || {}).name, ex.name, r.d || whenLabel(r), weight, u, r.reps, r.sets, TYPES[r.type] || '', r.note]);
          });
          await giveFile(`gym-pro-${todayStr()}.csv`, '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n'), 'text/csv');
        }
        if (act === 'install' && installPrompt) {
          installPrompt.prompt();
          installPrompt = null;
        }
      },
      async change(el) {
        if (el.name === 'unit') {
          db.settings.unit = el.value;
          save();
          toast(`Weights now show in ${el.value}`);
        }
        if (el.id === 'restore-file' && el.files[0]) {
          const file = el.files[0];
          let data = null;
          try { data = JSON.parse(await file.text()); } catch (e) { /* handled below */ }
          el.value = '';
          if (!isValid(data)) {
            toast("That file isn't a Gym Pro backup");
            return;
          }
          if (!confirm(`Replace everything on this phone with ${file.name}? It holds ${plural(data.exercises.length, 'exercise')} and ${plural(data.records.length, 'record')}.`)) return;
          db = data;
          db.settings = db.settings || { unit: 'kg' };
          save();
          render(false);
          toast('Backup restored');
        }
      },
    };
  }

  function viewMissing() {
    view.innerHTML = '<h1>Not here</h1><p class="sub">That page was deleted or never existed.</p><a class="btn below" href="#/">Back to muscles</a>';
    return {};
  }

  /* ---------------- routing + events ---------------- */

  function render(resetScroll = true) {
    const [, section, id] = (location.hash.slice(1) || '/').split('/');
    const routes = { '': viewHome, m: () => viewMuscle(id), e: () => viewExercise(id), history: viewHistory, settings: viewSettings };
    handlers = (routes[section] || viewMissing)() || {};
    const tab = section === 'history' || section === 'settings' ? section : 'home';
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (resetScroll) window.scrollTo(0, 0);
  }

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && handlers.click) handlers.click(el.dataset.act, el, e);
  });
  view.addEventListener('input', (e) => handlers.input && handlers.input(e.target));
  view.addEventListener('change', (e) => handlers.change && handlers.change(e.target));
  view.addEventListener('submit', (e) => {
    e.preventDefault();
    if (handlers.submit) handlers.submit(e.target);
  });
  window.addEventListener('hashchange', () => render());

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise((done) => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
        }
        // On the very first visit the fonts loaded before the service worker took over.
        // Fetch them once more through it, so the next launch has them without internet.
        const css = await (await fetch($('#fonts').href)).text();
        css.split('/* ').filter((block) => block.startsWith('latin */')).forEach((block) => {
          const url = block.match(/https:\/\/fonts\.gstatic\.com[^)]+/);
          if (url) fetch(url[0]).catch(() => {});
        });
      } catch (e) { /* offline support is a bonus; the app works without it */ }
    });
  }

  render();
})();
