'use strict';

const API = '/api/gr';
let sessionId = null, matchedItems = [];

// ─── Navigation ───────────────────────────────────────────────────────────────
function goTo(s) {
  document.querySelectorAll('.view').forEach((v, i) => v.classList.toggle('on', i === s));
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < s) el.classList.add('done');
    if (i === s) el.classList.add('active');
    el.querySelector('.step-dot').textContent = i < s ? '✓' : i + 1;
  });
  ['sl0','sl1','sl2'].forEach((id, i) => {
    document.getElementById(id).classList.toggle('done', i < s);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Loading overlay ──────────────────────────────────────────────────────────
function showLoad(title, sub) {
  document.getElementById('loadTtl').textContent = title;
  document.getElementById('loadSub').textContent = sub;
  document.getElementById('loadBg').style.display = 'flex';
}
function hideLoad() { document.getElementById('loadBg').style.display = 'none'; }

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg) {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, 3200);
}

// ─── Step 1: Upload PDF ───────────────────────────────────────────────────────
const dz    = document.getElementById('dz');
const pdfIn = document.getElementById('pdfIn');

dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') handleFile(f);
  else toast('⚠️ Please drop a PDF file');
});
pdfIn.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
document.getElementById('rmFile').addEventListener('click', clearFile);

function handleFile(f) {
  const sz = f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB';
  document.getElementById('fName').textContent = f.name;
  document.getElementById('fMeta').textContent = sz + ' · PDF Document';
  document.getElementById('filePill').style.display = 'flex';
  dz.style.display = 'none';

  showLoad('Extracting PO Information', 'Parsing document structure…');

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    try {
      const res = await fetch(`${API}/uploadPDF`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: f.name, fileContent: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Upload failed');

      sessionId = data.sessionId;
      document.getElementById('p-po').textContent  = data.poNumber || '—';
      document.getElementById('p-cnt').textContent = data.itemCount + ' line items';
      document.getElementById('p-sid').textContent = sessionId;
      document.getElementById('extractedPreview').style.display = '';
      document.getElementById('btnMatch').disabled = false;
      toast('✅ ' + data.itemCount + ' PO items extracted');
    } catch (err) {
      toast('❌ ' + err.message);
    } finally {
      hideLoad();
    }
  };
  reader.readAsDataURL(f);
}

function clearFile() {
  document.getElementById('filePill').style.display = 'none';
  document.getElementById('extractedPreview').style.display = 'none';
  dz.style.display = '';
  document.getElementById('btnMatch').disabled = true;
  pdfIn.value = '';
  sessionId = null;
}

// ─── Step 2: Match with S/4HANA ───────────────────────────────────────────────
document.getElementById('btnMatch').addEventListener('click', async () => {
  if (!sessionId) return;
  showLoad('Matching with S/4HANA', 'Calling API_PURCHASEORDER_PROCESS_SRV via destination DED_HTTP_200…');
  try {
    const res = await fetch(`${API}/matchWithS4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Match failed');
    matchedItems = Array.isArray(data) ? data : (data.value || []);
    renderMatchTable(matchedItems);
    renderSelTable(matchedItems);
    goTo(1);
    toast('✅ Matched ' + matchedItems.length + ' items');
  } catch (err) {
    toast('❌ ' + err.message);
  } finally {
    hideLoad();
  }
});

function statusClass(s) {
  return { MATCHED:'tag-match', TOLERANCE:'tag-tol', MISMATCH:'tag-miss', NOT_FOUND:'tag-nf', PENDING:'tag-pend' }[s] || 'tag-pend';
}

function renderMatchTable(items) {
  const tb = document.getElementById('matchBody');
  tb.innerHTML = items.map(it => `
    <tr>
      <td>${it.poItem}</td>
      <td style="font-family:monospace;font-weight:600">${it.material}</td>
      <td>${it.description || '—'}</td>
      <td>${it.uom}</td>
      <td style="text-align:right">${(+it.extractedQty).toLocaleString()}</td>
      <td style="text-align:right">${it.openQty != null ? (+it.openQty).toLocaleString() : '—'}</td>
      <td><span class="tag ${statusClass(it.matchStatus)}">${it.matchStatus}</span></td>
    </tr>`).join('');
}

// ─── Step 3: Select & Post GR ─────────────────────────────────────────────────
function renderSelTable(items) {
  document.getElementById('postingDate').value = new Date().toISOString().slice(0, 10);
  const tb = document.getElementById('selBody');
  tb.innerHTML = items.map(it => `
    <tr>
      <td><input type="checkbox" class="item-chk" data-id="${it.id}" checked></td>
      <td>${it.poItem}</td>
      <td style="font-family:monospace;font-weight:600">${it.material}</td>
      <td>${it.description || '—'}</td>
      <td>${it.uom}</td>
      <td><input class="qty-inp" type="number" value="${(+it.grQty || +it.extractedQty).toFixed(3)}" min="0.001" step="0.001" data-id="${it.id}"></td>
      <td><span class="tag ${statusClass(it.matchStatus)}">${it.matchStatus}</span></td>
    </tr>`).join('');
}

document.getElementById('selectAll').addEventListener('change', e => {
  document.querySelectorAll('.item-chk').forEach(c => c.checked = e.target.checked);
});

async function postGR() {
  const postingDate = document.getElementById('postingDate').value;
  if (!postingDate) { toast('⚠️ Posting date is required'); return; }

  const items = [];
  document.querySelectorAll('.item-chk:checked').forEach(chk => {
    const id  = chk.dataset.id;
    const qty = parseFloat(document.querySelector(`.qty-inp[data-id="${id}"]`).value);
    if (qty > 0) items.push({ id, grQty: qty });
  });
  if (!items.length) { toast('⚠️ Select at least one item'); return; }

  showLoad('Posting Goods Receipt', 'Calling API_GOODSMVT_SRV in S/4HANA…');
  try {
    const res = await fetch(`${API}/createGoodsReceipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, postingDate, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'GR creation failed');

    document.getElementById('matDocNum').textContent = `${data.matDocument} / ${data.fiscalYear}`;
    document.getElementById('grSummary').innerHTML = `
      <div class="kv"><label>Material Document</label><div class="v">${data.matDocument}</div></div>
      <div class="kv"><label>Fiscal Year</label><div class="v">${data.fiscalYear}</div></div>
      <div class="kv"><label>Items Posted</label><div class="v">${items.length}</div></div>
      <div class="kv"><label>Posting Date</label><div class="v">${postingDate}</div></div>`;
    goTo(3);
    toast('✅ ' + data.message);
  } catch (err) {
    toast('❌ ' + err.message);
  } finally {
    hideLoad();
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetAll() {
  clearFile(); matchedItems = []; sessionId = null; goTo(0);
}
