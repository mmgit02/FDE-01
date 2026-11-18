'use strict';
(function () {
  const API = '/api/gr';
  const $ = id => document.getElementById(id);
  const state = { lines: [], matches: [], csrf: null, tolerancePct: null, file: null };

  // ---------- helpers ----------
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.assign(e, props || {});
    for (const k of kids) e.append(k);
    return e;
  }
  function showMsg(text, info) {
    const m = $('msg');
    m.textContent = text || '';
    m.className = info ? 'info' : '';
    m.hidden = !text;
  }
  function goto(step) {
    for (let i = 1; i <= 4; i++) $('s' + i).hidden = i !== step;
    document.querySelectorAll('#steps li').forEach(li => {
      const n = Number(li.dataset.step);
      li.className = n === step ? 'active' : n < step ? 'done' : '';
    });
    showMsg('');
  }
  async function fetchCsrf() {
    const r = await fetch(API + '/config', { headers: { 'X-CSRF-Token': 'Fetch' }, credentials: 'same-origin' });
    if (!r.ok) throw new Error('Cannot reach the service (HTTP ' + r.status + ').');
    state.csrf = r.headers.get('X-CSRF-Token');
    return r.json();
  }
  async function call(name, body) {
    if (!state.csrf) await fetchCsrf();
    let r = await fetch(API + '/' + name, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' },
      body: JSON.stringify(body),
    });
    if (r.status === 403) { await fetchCsrf(); r = await fetch(API + '/' + name, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf || '' },
      body: JSON.stringify(body) }); }
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* not JSON, e.g. login page */ }
    if (!r.ok) throw new Error(data?.error?.message || ('Request failed (HTTP ' + r.status + ').'));
    if (data === null) throw new Error('Unexpected answer from the server - your session may have expired. Reload the page.');
    return data;
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    if (label) { btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = on ? label : btn.dataset.label; }
  }
  const fmt = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

  // ---------- step 1: upload ----------
  $('file').addEventListener('change', () => {
    state.file = $('file').files[0] || null;
    $('btnUpload').disabled = !state.file;
  });
  $('btnUpload').addEventListener('click', async () => {
    const f = state.file;
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return showMsg('The PDF is larger than 10 MB.');
    busy($('btnUpload'), true, 'Reading PDF...');
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(',')[1]);
        rd.onerror = () => rej(new Error('Could not read the file.'));
        rd.readAsDataURL(f);
      });
      const r = await call('extractFromPDF', { fileName: f.name, fileContent: b64 });
      state.lines = r.lines || [];
      if (!state.lines.length) state.lines.push(blankLine(r.poNumber));
      renderExtract(r.warnings || []);
      goto(2);
    } catch (e) { showMsg(e.message); } finally { busy($('btnUpload'), false, 'x'); }
  });

  // ---------- step 2: review/edit ----------
  const blankLine = po => ({ poNumber: po || '', poItem: '', material: '', description: '', quantity: 0, uom: '' });

  function renderExtract(warnings) {
    const w = $('warnings'); w.replaceChildren(...warnings.map(t => el('div', { textContent: t })));
    const tb = $('tblExtract').tBodies[0]; tb.replaceChildren();
    state.lines.forEach((l, i) => {
      const cell = (key, type, extra) => {
        const inp = el('input', { type: type || 'text', value: l[key] ?? '', ...extra });
        if (type === 'number') { inp.step = 'any'; inp.min = '0'; }
        inp.addEventListener('input', () => { l[key] = type === 'number' ? Number(inp.value) : inp.value; });
        return el('td', null, inp);
      };
      const del = el('button', { textContent: 'Delete', title: 'Remove row' });
      del.addEventListener('click', () => { state.lines.splice(i, 1); renderExtract([]); });
      tb.append(el('tr', null, cell('poNumber', 'text', { maxLength: 10 }), cell('poItem', 'text', { maxLength: 5 }),
        cell('material'), cell('description'), cell('quantity', 'number'),
        cell('uom', 'text', { maxLength: 3 }), el('td', null, del)));
    });
  }
  $('btnAddRow').addEventListener('click', () => {
    state.lines.push(blankLine(state.lines[state.lines.length - 1]?.poNumber)); renderExtract([]);
  });
  $('btnBack1').addEventListener('click', () => goto(1));

  // ---------- step 3: match ----------
  $('btnMatch').addEventListener('click', async () => {
    busy($('btnMatch'), true, 'Matching...');
    try {
      const r = await call('matchPurchaseOrders', { lines: state.lines });
      state.matches = r.lines; state.tolerancePct = r.tolerancePct;
      renderMatches(); goto(3);
    } catch (e) { showMsg(e.message); } finally { busy($('btnMatch'), false, 'x'); }
  });

  const PILL = { MATCHED: 'ok', WITHIN_TOLERANCE: 'ok', PARTIAL: 'warn' };
  function renderMatches() {
    $('tolInfo').textContent = 'Quantity tolerance: ' + state.tolerancePct + '%. Only lines that match can be selected.';
    const tb = $('tblMatch').tBodies[0]; tb.replaceChildren();
    state.matches.forEach(m => {
      const cb = el('input', { type: 'checkbox', disabled: !m.selectable });
      cb.addEventListener('change', () => { m.chosen = cb.checked; updateReview(); });
      tb.append(el('tr', null,
        el('td', null, cb),
        el('td', { textContent: m.poNumber + ' / ' + (m.poItem || '?') }),
        el('td', { textContent: m.material || m.s4Material }),
        el('td', { textContent: fmt(m.quantity) + ' ' + m.uom }),
        el('td', { textContent: m.s4Quantity === null ? '' : fmt(m.s4Quantity) + ' ' + m.s4Uom }),
        el('td', { textContent: m.deviationPct === null ? '' : m.deviationPct + '%' }),
        el('td', null, el('span', { className: 'pill ' + (PILL[m.status] || 'bad'), textContent: m.status.replace(/_/g, ' ').toLowerCase() })),
        el('td', { textContent: m.message })));
    });
    $('selAll').checked = false; updateReview();
  }
  function updateReview() { $('btnReview').disabled = !state.matches.some(m => m.chosen); }
  $('selAll').addEventListener('change', () => {
    const on = $('selAll').checked;
    state.matches.forEach(m => { m.chosen = on && m.selectable; });
    document.querySelectorAll('#tblMatch tbody input').forEach((cb, i) => { cb.checked = !!state.matches[i].chosen; });
    updateReview();
  });
  $('btnBack2').addEventListener('click', () => goto(2));

  // ---------- step 4: confirm + post ----------
  $('btnReview').addEventListener('click', () => {
    const tb = $('tblConfirm').tBodies[0]; tb.replaceChildren();
    state.matches.filter(m => m.chosen).forEach(m => tb.append(el('tr', null,
      el('td', { textContent: m.poNumber + ' / ' + m.poItem }), el('td', { textContent: m.s4Material || m.material }),
      el('td', { textContent: fmt(m.quantity) }), el('td', { textContent: m.uom }))));
    $('postDate').value = new Date().toISOString().slice(0, 10);
    $('result').hidden = true; $('btnPost').disabled = false;
    goto(4);
  });
  $('btnBack3').addEventListener('click', () => goto(3));
  $('btnPost').addEventListener('click', async () => {
    const chosen = state.matches.filter(m => m.chosen);
    const dryRun = $('dryRun').checked;
    if (!dryRun && !confirm('Post goods receipt (101) for ' + chosen.length + ' item(s) in S/4HANA?')) return;
    busy($('btnPost'), true, dryRun ? 'Validating...' : 'Posting...');
    try {
      const r = await call('postGoodsReceipt', {
        lines: chosen.map(m => ({ poNumber: m.poNumber, poItem: m.poItem, material: m.material || m.s4Material,
          description: m.description, quantity: m.quantity, uom: m.uom })),
        postingDate: $('postDate').value, dryRun,
      });
      const box = $('result');
      box.className = r.dryRun ? 'dry' : '';
      box.replaceChildren(el('b', { textContent: r.message }));
      if (!r.dryRun) {
        box.append(el('div', { textContent: 'Material document ' + r.materialDocument + ', fiscal year ' + r.fiscalYear }));
        $('btnPost').disabled = true; // prevent a second posting of the same selection
      } else { busy($('btnPost'), false, 'x'); }
      box.hidden = false;
    } catch (e) { showMsg(e.message); busy($('btnPost'), false, 'x'); }
  });

  // ---------- start ----------
  fetchCsrf().then(c => { $('who').textContent = c.user ? c.user + ' - destination ' + c.destination : ''; })
    .catch(e => showMsg(e.message));
})();
