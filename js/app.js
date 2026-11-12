// ===== State =====
let step = 0, file = null, agent = null, po = null;

const PO = {
  poNumber: '4500001234',
  vendor: 'ABC Supplies GmbH (100042)',
  companyCode: '1000',
  plant: '1001',
  poDate: '2024-10-15',
  currency: 'USD',
  totalValue: '48,750.00',
  itemCount: 4,
  items: [
    { item:'10', mat:'MAT-001234', desc:'Steel Pipe 40mm DN',          uom:'PC', poQ:500,  oQ:500, grQ:500  },
    { item:'20', mat:'MAT-005678', desc:'Copper Fitting T-Joint',       uom:'PC', poQ:1200, oQ:800, grQ:800  },
    { item:'30', mat:'RAW-009901', desc:'Stainless Steel Sheet 2mm',    uom:'KG', poQ:350,  oQ:350, grQ:350  },
    { item:'40', mat:'PKG-003300', desc:'Protective Foam Padding',       uom:'M2', poQ:200,  oQ:100, grQ:100  },
  ]
};

// ===== Navigation =====
function goTo(s) {
  document.querySelectorAll('.view').forEach((v,i) => v.classList.toggle('on', i===s));
  document.querySelectorAll('.step').forEach((el,i) => {
    el.classList.remove('active','done');
    if(i < s) el.classList.add('done');
    if(i === s) el.classList.add('active');
    el.querySelector('.step-dot').textContent = i < s ? '✓' : i+1;
  });
  ['sl0','sl1','sl2'].forEach((id,i) => {
    document.getElementById(id).classList.toggle('done', i < s);
  });
  step = s;
  window.scrollTo({top:0, behavior:'smooth'});
}

// ===== Upload =====
const dz = document.getElementById('dz');
const pdfIn = document.getElementById('pdfIn');

dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over') });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if(f && f.type === 'application/pdf') handleFile(f);
  else showToast('⚠️ Please drop a PDF file');
});
pdfIn.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]) });
document.getElementById('rmFile').addEventListener('click', clearFile);

function handleFile(f) {
  file = f;
  const sz = f.size < 1048576 ? (f.size/1024).toFixed(1)+' KB' : (f.size/1048576).toFixed(1)+' MB';
  document.getElementById('fName').textContent = f.name;
  document.getElementById('fMeta').textContent = sz + ' · PDF Document';
  document.getElementById('filePill').style.display = 'flex';
  dz.style.display = 'none';
  showLoad('Extracting PO Information', 'Analyzing document structure...');
  setTimeout(() => {
    hideLoad();
    po = PO;
    document.getElementById('p-po').textContent    = po.poNumber;
    document.getElementById('p-vend').textContent  = po.vendor;
    document.getElementById('p-cc').textContent    = po.companyCode;
    document.getElementById('p-plant').textContent = po.plant;
    document.getElementById('p-dt').textContent    = fmtDate(po.poDate);
    document.getElementById('p-cur').textContent   = po.currency;
    document.getElementById('p-val').textContent   = po.currency + ' ' + po.totalValue;
    document.getElementById('p-items').textContent = po.itemCount + ' line items';
    document.getElementById('poPrev').style.display = '';
    document.getElementById('toAgents').disabled = false;
    showToast('✅ PO data extracted — 4 line items found');
  }, 1900);
}

function clearFile() {
  file = null; po = null; pdfIn.value = '';
  document.getElementById('filePill').style.display = 'none';
  document.getElementById('poPrev').style.display = 'none';
  dz.style.display = '';
  document.getElementById('toAgents').disabled = true;
}

document.getElementById('toAgents').addEventListener('click', () => goTo(1));

// ===== Agent Selection =====
document.querySelectorAll('.agent-card').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.agent-card').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-pressed','false') });
    c.classList.add('sel'); c.setAttribute('aria-pressed','true');
    agent = c.dataset.a;
    document.getElementById('toConfig').disabled = false;
  });
  c.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click()} });
});

document.getElementById('toConfig').addEventListener('click', () => {
  setupCfg(); goTo(2);
});

// ===== Setup Config =====
function setupCfg() {
  ['gr','val','read','info'].forEach(a => document.getElementById('cfg-'+a).style.display = 'none');
  document.getElementById('cfg-'+agent).style.display = '';

  if(agent === 'gr' && po) {
    document.getElementById('c-po').textContent    = po.poNumber;
    document.getElementById('c-vend').textContent  = po.vendor;
    document.getElementById('c-plant').textContent = po.plant;
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('fPostDate').value = today;
    document.getElementById('fDocDate').value  = today;
    document.getElementById('fHdrTxt').value   = 'GR for PO ' + po.poNumber;

    const tb = document.getElementById('liBody'); tb.innerHTML = '';
    po.items.forEach(it => {
      const pct = Math.round((1 - it.oQ/it.poQ)*100);
      const cls = pct===0?'tag-o':pct>=100?'tag-d':'tag-p';
      const lbl = pct===0?'Open':pct>=100?'Delivered':'Partial';
      tb.innerHTML += `
        <tr>
          <td>${it.item}</td>
          <td style="font-weight:600;font-variant-numeric:tabular-nums">${it.mat}</td>
          <td>${it.desc}</td>
          <td>${it.uom}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${it.poQ.toLocaleString()}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${it.oQ.toLocaleString()}</td>
          <td><input class="qty-inp" type="number" value="${it.grQ}" min="0" max="${it.oQ}" data-i="${it.item}" aria-label="GR qty item ${it.item}"></td>
          <td><span class="tag ${cls}">${lbl}</span></td>
        </tr>`;
    });
  }

  const pf = {val:'fValPO',read:'fReadPO',info:'fInfoPO'}[agent];
  if(pf && po) document.getElementById(pf).value = po.poNumber;
}

// ===== Execute =====
function execAgent() {
  if(agent==='gr') postGR(); else execGeneric();
}

function postGR() {
  if(!document.getElementById('fPostDate').value) { showToast('⚠️ Posting date is required'); return; }
  const items = [];
  document.querySelectorAll('.qty-inp').forEach(inp => {
    const q = parseFloat(inp.value);
    if(q > 0) { const it = po.items.find(x=>x.item===inp.dataset.i); if(it) items.push({...it, grQ:q}); }
  });
  if(!items.length) { showToast('⚠️ Enter at least one quantity to receive'); return; }

  showLoad('Posting Goods Receipt', 'Calling API_GOODSMVT_SRV in SAP backend...');
  setTimeout(() => {
    hideLoad();
    const docNo = '50' + (Math.random()*90000000+10000000|0);
    const yr    = new Date().getFullYear();
    document.getElementById('matDoc').textContent = docNo;

    document.getElementById('grDets').innerHTML = `
      <div class="kv"><label>Material Document</label><div class="v">${docNo}</div></div>
      <div class="kv"><label>Fiscal Year</label><div class="v">${yr}</div></div>
      <div class="kv"><label>Purchase Order</label><div class="v">${po.poNumber}</div></div>
      <div class="kv"><label>Vendor</label><div class="v">${po.vendor}</div></div>
      <div class="kv"><label>Posting Date</label><div class="v">${fmtDate(document.getElementById('fPostDate').value)}</div></div>
      <div class="kv"><label>Movement Type</label><div class="v">101 – GR for PO</div></div>
      <div class="kv"><label>Plant</label><div class="v">${po.plant}</div></div>
      <div class="kv"><label>Storage Location</label><div class="v">${document.getElementById('fSLoc').value||'0001'}</div></div>
    `;

    const tb = document.getElementById('resTbody'); tb.innerHTML = '';
    items.forEach(it => {
      tb.innerHTML += `
        <tr>
          <td>${it.item}</td>
          <td style="font-weight:600">${it.mat}</td>
          <td>${it.desc}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${it.grQ.toLocaleString()}</td>
          <td>${it.uom}</td>
          <td>${document.getElementById('fSLoc').value||'0001'}</td>
        </tr>`;
    });

    document.getElementById('res-gr').style.display = '';
    document.getElementById('res-generic').style.display = 'none';
    goTo(3);
    showToast('✅ GR posted: Document ' + docNo);
  }, 2800);
}

function execGeneric() {
  const cfgs = {
    val: {
      icon:'✅', title:'PO Validation Report',
      sub: `Validation complete for PO ${po?.poNumber||'4500001234'} — no blocking issues`,
      load:['Validating Purchase Order','Checking PO status and quantities in SAP...'],
      body:`<strong>PO Number:</strong> ${po?.poNumber||'4500001234'} &nbsp;|&nbsp; <strong>Type:</strong> NB (Standard PO)<br><br>
<strong>Validation Checks:</strong><br>
<br>&nbsp;✅&nbsp; PO is active — no deletion/blocking flag set<br>
&nbsp;✅&nbsp; Vendor ${po?.vendor||'ABC Supplies GmbH'} is active, no payment block<br>
&nbsp;✅&nbsp; Open delivery quantities exist on all 4 line items<br>
&nbsp;✅&nbsp; Material master records complete with valid valuations<br>
&nbsp;✅&nbsp; Account assignment validated (cost center / G/L account)<br>
&nbsp;✅&nbsp; Over/under delivery tolerance checks passed<br>
&nbsp;✅&nbsp; Invoice verification: GR-based IV active<br>
<br><strong>Recommendation:</strong> PO is ready for Goods Receipt. Proceed with the GR Posting Agent.`
    },
    read: {
      icon:'🔍', title:'Purchase Order Display',
      sub:`PO ${po?.poNumber||'4500001234'} — Full document read from SAP`,
      load:['Reading Purchase Order','Fetching PO data from SAP API...'],
      body:`<strong>Header Data:</strong><br>
&nbsp;&nbsp;PO: ${po?.poNumber||'4500001234'} &emsp; Type: NB &emsp; Company: ${po?.companyCode||'1000'}<br>
&nbsp;&nbsp;Vendor: ${po?.vendor||'ABC Supplies GmbH (100042)'}<br>
&nbsp;&nbsp;Plant: ${po?.plant||'1001'} &emsp; PO Date: ${fmtDate(po?.poDate||'2024-10-15')}<br>
&nbsp;&nbsp;Payment Terms: Net 30 days &emsp; Incoterms: CIF – Hamburg<br>
&nbsp;&nbsp;Currency: ${po?.currency||'USD'} &emsp; Net Value: ${po?.currency||'USD'} ${po?.totalValue||'48,750.00'}<br>
<br><strong>Line Items:</strong><br>
&nbsp;&nbsp;10 &nbsp;MAT-001234 &nbsp;Steel Pipe 40mm DN &nbsp;500 PC &nbsp;Open: 500 PC<br>
&nbsp;&nbsp;20 &nbsp;MAT-005678 &nbsp;Copper Fitting T-Joint &nbsp;1,200 PC &nbsp;Open: 800 PC<br>
&nbsp;&nbsp;30 &nbsp;RAW-009901 &nbsp;Stainless Steel Sheet 2mm &nbsp;350 KG &nbsp;Open: 350 KG<br>
&nbsp;&nbsp;40 &nbsp;PKG-003300 &nbsp;Protective Foam Padding &nbsp;200 M2 &nbsp;Open: 100 M2<br>
<br><strong>Status:</strong> Partially Delivered — 1 item fully received, 3 items partially open`
    },
    info: {
      icon:'💡', title:'Additional PO Information',
      sub:`Supplementary data aggregated for PO ${po?.poNumber||'4500001234'}`,
      load:['Fetching Additional Information','Aggregating vendor, material, and logistics data...'],
      body:`<strong>Vendor Master (100042):</strong><br>
&nbsp;&nbsp;Name: ABC Supplies GmbH &emsp; Country: DE (Germany)<br>
&nbsp;&nbsp;Payment: Net 30 days / 2% 10 days &emsp; Reconciliation: 160000<br>
&nbsp;&nbsp;Incoterms: CIF – Hamburg &emsp; Currency: USD<br>
<br><strong>GR / Delivery History (last 90 days):</strong><br>
&nbsp;&nbsp;2024-09-10 &nbsp;Doc 5000011200 &nbsp;300 PC MAT-001234 (Partial delivery)<br>
&nbsp;&nbsp;2024-10-01 &nbsp;Doc 5000011340 &nbsp;400 PC MAT-005678 (Partial delivery)<br>
<br><strong>Pricing Conditions (PO ${po?.poNumber||'4500001234'}):</strong><br>
&nbsp;&nbsp;PB00 Gross Price: USD 42.50/PC (MAT-001234) · USD 18.75/PC (MAT-005678)<br>
&nbsp;&nbsp;SKTO Cash Discount: 2% — 10 days<br>
<br><strong>GR/IR Clearing:</strong> 3 uncleared items pending invoice matching in FI`
    }
  };
  const c = cfgs[agent];
  showLoad(c.load[0], c.load[1]);
  setTimeout(() => {
    hideLoad();
    document.getElementById('gResIcon').textContent = c.icon;
    document.getElementById('gResTitle').textContent = c.title;
    document.getElementById('gResSub').textContent   = c.sub;
    document.getElementById('gResBody').innerHTML    = c.body;
    document.getElementById('res-gr').style.display = 'none';
    document.getElementById('res-generic').style.display = '';
    goTo(3);
    showToast('✅ Agent completed');
  }, 2200);
}

// ===== Utilities =====
function resetAll() {
  clearFile(); agent = null;
  document.querySelectorAll('.agent-card').forEach(c => { c.classList.remove('sel'); c.setAttribute('aria-pressed','false') });
  document.getElementById('toConfig').disabled = true;
  goTo(0);
}

function fmtDate(s) {
  if(!s) return '—';
  try { return new Date(s+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'2-digit'}) }
  catch{ return s }
}

function showLoad(t, s) {
  document.getElementById('loadTtl').textContent = t;
  document.getElementById('loadSub').textContent = s;
  document.getElementById('loadBg').style.display = 'flex';
}
function hideLoad() { document.getElementById('loadBg').style.display = 'none' }

function showToast(msg) {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(()=>t.remove(),220) }, 3000);
}
