/* ─────────────────────────────────────────────────────────────
   GR Automation Demo — SAP Goods Receipt Wizard
   React 18 + CDN, SAP Fiori styling, PDF.js extraction
   ───────────────────────────────────────────────────────────── */

const { useState, useEffect, useRef, useCallback } = React;

// ── Helpers ─────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Mock CAP API (simulates backend calls) ───────────────────────
const mockAPI = {
  async readPO(poData) {
    await sleep(900);
    return {
      poNumber: poData.poNumber || "4500012345",
      vendor: poData.vendor || "SAP SE",
      vendorId: "1000045",
      orderDate: "2026-10-15",
      deliveryDate: "2026-11-20",
      currency: "USD",
      totalValue: 48750.00,
      status: "Open",
      items: poData.items || [
        { lineItem: "10", material: "MAT-00123", description: "SAP License – Enterprise", qty: 5, unit: "EA", price: 5500.00, plant: "1000" },
        { lineItem: "20", material: "MAT-00456", description: "Integration Module", qty: 3, unit: "EA", price: 4750.00, plant: "1000" },
        { lineItem: "30", material: "MAT-00789", description: "Support Pack – 1yr", qty: 10, unit: "EA", price: 1875.00, plant: "1000" },
      ]
    };
  },
  async validatePO(poNumber) {
    await sleep(1200);
    return {
      poNumber,
      valid: true,
      checks: [
        { label: "PO exists in SAP",           passed: true,  detail: "Found in MM module" },
        { label: "Open quantity available",     passed: true,  detail: "All items have open qty" },
        { label: "Goods receipt allowed",       passed: true,  detail: "GR indicator set" },
        { label: "Delivery date window",        passed: true,  detail: "Within tolerance ±5 days" },
        { label: "Vendor account active",       passed: true,  detail: "Vendor 1000045 active" },
        { label: "Plant / storage loc valid",   passed: true,  detail: "Plant 1000 — Stor. 0001" },
        { label: "Currency match",              passed: true,  detail: "USD matches PO currency" },
        { label: "Duplicate GR check",         passed: true,  detail: "No duplicate documents" },
      ]
    };
  },
  async fetchVendorInfo(vendorId) {
    await sleep(1000);
    return {
      vendorId,
      name: "SAP SE",
      country: "Germany",
      paymentTerms: "NET30",
      currency: "USD",
      rating: "A+",
      deliveryHistory: [
        { poNumber: "4500012100", date: "2026-09-10", onTime: true,  items: 4 },
        { poNumber: "4500011890", date: "2026-08-22", onTime: true,  items: 7 },
        { poNumber: "4500011456", date: "2026-07-14", onTime: false, items: 2 },
      ],
      pricingHistory: [
        { material: "MAT-00123", avgPrice: 5450.00, lastPrice: 5500.00, trend: "up" },
        { material: "MAT-00456", avgPrice: 4800.00, lastPrice: 4750.00, trend: "down" },
      ]
    };
  },
  async postGR(poData) {
    await sleep(1800);
    const grNumber = "5000" + Math.floor(Math.random() * 90000 + 10000);
    return {
      success: true,
      grDocument: grNumber,
      poNumber: poData.poNumber,
      postingDate: new Date().toISOString().slice(0, 10),
      items: poData.items.map(i => ({ ...i, postedQty: i.qty, movementType: "101" })),
      message: `Goods Receipt ${grNumber} posted successfully via MIGO movement type 101.`
    };
  }
};

// ── PDF Extractor using PDF.js ───────────────────────────────────
async function extractPOFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(s => s.str).join(" ") + "\n";
  }

  // Try to extract PO number
  const poMatch = fullText.match(/P\.?O\.?\s*(?:Number|No\.?|#)?\s*[:\-]?\s*(\d{8,12})/i)
                || fullText.match(/Purchase Order\s*[:\-]?\s*(\d{8,12})/i)
                || fullText.match(/(\d{10})/);
  const poNumber = poMatch ? poMatch[1] : "4500012345";

  // Try to extract vendor
  const vendorMatch = fullText.match(/Vendor\s*[:\-]?\s*([A-Za-z][\w\s&,.]+?)(?:\n|Ltd|Inc|Corp|GmbH|SE)/i);
  const vendor = vendorMatch ? vendorMatch[1].trim() : null;

  return { poNumber, vendor, rawText: fullText.slice(0, 500) };
}

// ── NLP Command Parser ───────────────────────────────────────────
const COMMANDS = [
  { keys: ["post gr", "post goods", "post receipt", "book gr", "book receipt"], action: "POST_GR", label: "Post Goods Receipt", step: 2, agent: 0 },
  { keys: ["validate po", "validate order", "check po", "verify po"],           action: "VALIDATE", label: "Validate Purchase Order", step: 2, agent: 1 },
  { keys: ["read po", "show po", "display po", "view po", "read order"],        action: "READ_PO",  label: "Display PO Details", step: 2, agent: 2 },
  { keys: ["vendor info", "vendor details", "fetch vendor", "pricing info"],    action: "VENDOR",   label: "Fetch Vendor & Pricing Info", step: 2, agent: 3 },
  { keys: ["upload pdf", "upload file", "load pdf"],                            action: "UPLOAD",   label: "Upload PDF", step: 0 },
  { keys: ["next", "continue", "proceed"],                                      action: "NEXT",     label: "Go to next step" },
  { keys: ["back", "previous", "go back"],                                      action: "BACK",     label: "Go to previous step" },
];
function parseCommand(text) {
  const lower = text.toLowerCase();
  for (const cmd of COMMANDS) {
    if (cmd.keys.some(k => lower.includes(k))) return cmd;
  }
  return null;
}

// ── Toast Component ──────────────────────────────────────────────
function Toasts({ toasts, dismiss }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => dismiss(t.id)} style={{cursor:"pointer"}}>
          <span className="toast-icon">{t.type==="success"?"✅":t.type==="error"?"❌":t.type==="warning"?"⚠️":"ℹ️"}</span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.msg && <div className="toast-msg">{t.msg}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Step 0: Upload PDF ───────────────────────────────────────────
function UploadStep({ onExtracted, toast }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [fileName, setFileName] = useState(null);
  const [preview, setPreview]   = useState(null);
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file || file.type !== "application/pdf") {
      toast("error", "Invalid file", "Please upload a PDF file.");
      return;
    }
    setFileName(file.name);
    setLoading(true);
    try {
      const extracted = await extractPOFromPDF(file);
      setPreview(extracted);
      toast("success", "PDF parsed", `Extracted PO ${extracted.poNumber}`);
    } catch (e) {
      toast("warning", "Parse note", "Could not fully parse PDF — using demo data.");
      setPreview({ poNumber: "4500012345", vendor: null, rawText: "Demo mode." });
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Upload Purchase Order PDF</h1>
        <p>Upload a PDF containing your Purchase Order. The app will extract PO details automatically.</p>
      </div>

      <div className="card">
        <div className="card-title">📄 PDF Upload</div>
        <div
          className={`upload-zone ${dragging ? "drag-over" : ""}`}
          onClick={() => inputRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <div className="icon">📂</div>
          <p><strong>Click to browse</strong> or drag & drop a PDF here</p>
          <p style={{marginTop:4}}>Supported: PDF files containing PO data</p>
          {fileName && <p style={{marginTop:8,color:"#0a6ed1",fontWeight:600}}>Selected: {fileName}</p>}
        </div>
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" style={{display:"none"}}
          onChange={e => handleFile(e.target.files[0])} />

        {loading && (
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12,color:"#0a6ed1"}}>
            <div className="spinner"></div> Extracting PO data from PDF…
          </div>
        )}

        {preview && (
          <div className="result-panel" style={{marginTop:12}}>
            <strong>Extracted PO Number:</strong> {preview.poNumber}<br/>
            {preview.vendor && <><strong>Vendor:</strong> {preview.vendor}<br/></>}
            <strong>Raw text preview:</strong>
            <div style={{fontFamily:"monospace",fontSize:"0.78rem",color:"#666",marginTop:4,maxHeight:80,overflow:"hidden",whiteSpace:"pre-wrap"}}>{preview.rawText}</div>
          </div>
        )}
      </div>

      <div className="btn-row">
        {preview ? (
          <button className="btn btn-primary" onClick={() => onExtracted(preview)}>
            Continue →
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => onExtracted({ poNumber: "4500012345", vendor: null })}>
            Skip — use demo PO
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Select Agent ─────────────────────────────────────────
const AGENTS = [
  { icon: "✅", name: "Post Goods Receipt", desc: "Posts GR against PO in SAP via movement type 101 (MIGO)." },
  { icon: "🔍", name: "Validate PO",        desc: "Runs pre-checks: open qty, delivery date, vendor status, duplicates." },
  { icon: "📋", name: "Read PO Details",    desc: "Fetches and displays all line items, quantities, and pricing from PO." },
  { icon: "📊", name: "Fetch Vendor Info",  desc: "Retrieves vendor profile, delivery history, and pricing trends." },
];

function AgentStep({ selected, onSelect }) {
  return (
    <div>
      <div className="page-header">
        <h1>Select AI Agent</h1>
        <p>Choose the action you want to perform against the Purchase Order.</p>
      </div>
      <div className="agent-grid">
        {AGENTS.map((a, i) => (
          <div key={i} className={`agent-card ${selected === i ? "selected" : ""}`} onClick={() => onSelect(i)}>
            <div className="agent-icon">{a.icon}</div>
            <div className="agent-name">{a.name}</div>
            <div className="agent-desc">{a.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Execute Agent ────────────────────────────────────────
function ExecuteStep({ poData, agentIdx, toast }) {
  const [status, setStatus] = useState("idle"); // idle|running|done|error
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);
  const agent = AGENTS[agentIdx];

  async function run() {
    setStatus("running");
    setProgress(20);
    try {
      let res;
      if (agentIdx === 0) {
        setProgress(50);
        res = await mockAPI.postGR(poData);
        setProgress(90);
      } else if (agentIdx === 1) {
        setProgress(50);
        res = await mockAPI.validatePO(poData.poNumber);
        setProgress(90);
      } else if (agentIdx === 2) {
        setProgress(50);
        res = await mockAPI.readPO(poData);
        setProgress(90);
      } else {
        setProgress(50);
        res = await mockAPI.fetchVendorInfo(poData.vendorId || "1000045");
        setProgress(90);
      }
      setProgress(100);
      setResult(res);
      setStatus("done");
      toast("success", `${agent.name} complete`, "SAP operation succeeded.");
    } catch (e) {
      setStatus("error");
      toast("error", "Agent error", String(e));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{agent.icon} {agent.name}</h1>
        <p>PO: <strong>{poData.poNumber}</strong> — Vendor: <strong>{poData.vendor || "SAP SE"}</strong></p>
      </div>

      {status === "idle" && (
        <div className="card">
          <div className="card-title">Ready to Execute</div>
          <p style={{color:"#6a6d70",marginBottom:"1rem"}}>The <strong>{agent.name}</strong> agent will process PO <strong>{poData.poNumber}</strong>. Click Run to start.</p>
          <button className="btn btn-primary" onClick={run}>{agent.icon} Run Agent</button>
        </div>
      )}

      {status === "running" && (
        <div className="card">
          <div className="card-title"><div className="spinner" style={{width:16,height:16,marginRight:6}}></div> Running…</div>
          <div className="progress-bar-wrap"><div className="progress-bar" style={{width:`${progress}%`}}></div></div>
          <p style={{color:"#6a6d70",fontSize:"0.82rem",marginTop:6}}>Communicating with SAP backend via CAP API…</p>
        </div>
      )}

      {status === "done" && result && (
        <>
          {agentIdx === 0 && <GRResult result={result} />}
          {agentIdx === 1 && <ValidationResult result={result} />}
          {agentIdx === 2 && <PODetailResult result={result} />}
          {agentIdx === 3 && <VendorResult result={result} />}
        </>
      )}

      {status === "error" && (
        <div className="result-panel error">❌ Agent execution failed. Check connection and try again.</div>
      )}
    </div>
  );
}

function GRResult({ result }) {
  return (
    <div className="card">
      <div className="card-title">✅ Goods Receipt Posted</div>
      <div className="kpi-row">
        <div className="kpi-tile"><div className="kpi-label">GR Document</div><div className="kpi-value" style={{fontSize:"1.2rem"}}>{result.grDocument}</div></div>
        <div className="kpi-tile"><div className="kpi-label">PO Number</div><div className="kpi-value" style={{fontSize:"1.2rem"}}>{result.poNumber}</div></div>
        <div className="kpi-tile"><div className="kpi-label">Posting Date</div><div className="kpi-value" style={{fontSize:"1.2rem"}}>{result.postingDate}</div></div>
      </div>
      <div className="result-panel">{result.message}</div>
      <table className="po-table" style={{marginTop:"1rem"}}>
        <thead><tr><th>Line</th><th>Material</th><th>Description</th><th>Qty</th><th>Mvt Type</th></tr></thead>
        <tbody>
          {result.items.map(i => (
            <tr key={i.lineItem}>
              <td>{i.lineItem}</td><td>{i.material}</td><td>{i.description}</td>
              <td>{i.postedQty} {i.unit}</td><td><span className="badge badge-success">{i.movementType}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValidationResult({ result }) {
  const allPassed = result.checks.every(c => c.passed);
  return (
    <div className="card">
      <div className="card-title">🔍 PO Validation — {result.poNumber}
        <span className={`badge ${allPassed ? "badge-success" : "badge-warning"}`} style={{marginLeft:8}}>
          {allPassed ? "All Checks Passed" : "Issues Found"}
        </span>
      </div>
      <ul className="validation-list">
        {result.checks.map((c, i) => (
          <li key={i}>
            <span className="v-icon">{c.passed ? "✅" : "❌"}</span>
            <div><strong>{c.label}</strong><br/><span style={{color:"#6a6d70",fontSize:"0.78rem"}}>{c.detail}</span></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PODetailResult({ result }) {
  return (
    <div>
      <div className="card">
        <div className="card-title">📋 Purchase Order — {result.poNumber}</div>
        <div className="info-grid">
          <div className="info-label">Vendor</div><div className="info-value">{result.vendor} ({result.vendorId})</div>
          <div className="info-label">Order Date</div><div className="info-value">{result.orderDate}</div>
          <div className="info-label">Delivery Date</div><div className="info-value">{result.deliveryDate}</div>
          <div className="info-label">Currency</div><div className="info-value">{result.currency}</div>
          <div className="info-label">Total Value</div><div className="info-value" style={{color:"#0a6ed1",fontWeight:700}}>${result.totalValue.toLocaleString()}</div>
          <div className="info-label">Status</div><div className="info-value"><span className="badge badge-success">{result.status}</span></div>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Line Items</div>
        <table className="po-table">
          <thead><tr><th>Line</th><th>Material</th><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Plant</th></tr></thead>
          <tbody>
            {result.items.map(i => (
              <tr key={i.lineItem}>
                <td>{i.lineItem}</td><td>{i.material}</td><td>{i.description}</td>
                <td>{i.qty}</td><td>{i.unit}</td>
                <td>${i.price.toLocaleString()}</td><td>{i.plant}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorResult({ result }) {
  return (
    <div>
      <div className="card">
        <div className="card-title">📊 Vendor Profile — {result.name}</div>
        <div className="info-grid">
          <div className="info-label">Vendor ID</div><div className="info-value">{result.vendorId}</div>
          <div className="info-label">Country</div><div className="info-value">{result.country}</div>
          <div className="info-label">Payment Terms</div><div className="info-value">{result.paymentTerms}</div>
          <div className="info-label">Currency</div><div className="info-value">{result.currency}</div>
          <div className="info-label">Rating</div><div className="info-value"><span className="badge badge-success">{result.rating}</span></div>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Delivery History</div>
        <table className="po-table">
          <thead><tr><th>PO Number</th><th>Date</th><th>On Time</th><th>Items</th></tr></thead>
          <tbody>
            {result.deliveryHistory.map((h, i) => (
              <tr key={i}>
                <td>{h.poNumber}</td><td>{h.date}</td>
                <td><span className={`badge ${h.onTime ? "badge-success" : "badge-warning"}`}>{h.onTime ? "✓ Yes" : "✗ No"}</span></td>
                <td>{h.items}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-title">Pricing History</div>
        <table className="po-table">
          <thead><tr><th>Material</th><th>Avg Price</th><th>Last Price</th><th>Trend</th></tr></thead>
          <tbody>
            {result.pricingHistory.map((p, i) => (
              <tr key={i}>
                <td>{p.material}</td>
                <td>${p.avgPrice.toLocaleString()}</td>
                <td>${p.lastPrice.toLocaleString()}</td>
                <td><span className={`badge ${p.trend==="up"?"badge-warning":"badge-success"}`}>{p.trend === "up" ? "↑ Up" : "↓ Down"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Step 3: Summary ──────────────────────────────────────────────
function SummaryStep({ poData, agentIdx, onRestart }) {
  return (
    <div>
      <div className="page-header">
        <h1>🎉 Process Complete</h1>
        <p>The agent workflow has finished successfully.</p>
      </div>
      <div className="card">
        <div className="card-title">Summary</div>
        <div className="info-grid">
          <div className="info-label">PO Number</div><div className="info-value">{poData.poNumber}</div>
          <div className="info-label">Agent Used</div><div className="info-value">{AGENTS[agentIdx].icon} {AGENTS[agentIdx].name}</div>
          <div className="info-label">Status</div><div className="info-value"><span className="badge badge-success">Completed</span></div>
          <div className="info-label">Timestamp</div><div className="info-value">{new Date().toLocaleString()}</div>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onRestart}>↺ Start New Process</button>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
function App() {
  const [step, setStep]           = useState(0);
  const [poData, setPOData]       = useState(null);
  const [agentIdx, setAgentIdx]   = useState(null);
  const [toasts, setToasts]       = useState([]);
  const [cmdText, setCmdText]     = useState("");
  const [cmdPreview, setCmdPreview] = useState(null);
  const [cmdCountdown, setCmdCountdown] = useState(0);
  const [listening, setListening] = useState(false);
  const countdownRef = useRef(null);
  const recognitionRef = useRef(null);

  function toast(type, title, msg) {
    const id = uid();
    setToasts(t => [...t, { id, type, title, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }
  function dismissToast(id) { setToasts(t => t.filter(x => x.id !== id)); }

  // ── Voice recognition ──
  function startVoice() {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast("warning", "Voice not supported", "Use Chrome or Edge for voice input.");
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = "en-US";
    r.onresult = e => {
      const text = e.results[0][0].transcript;
      setCmdText(text);
      processCommand(text);
    };
    r.onend = () => setListening(false);
    r.start();
    setListening(true);
    recognitionRef.current = r;
  }

  // ── Command execution (with 2s preview + cancel) ──
  function processCommand(text) {
    const cmd = parseCommand(text);
    if (!cmd) {
      toast("info", "Command not recognized", `Try "Post GR", "Validate PO", "Read PO", or "Fetch Vendor Info".`);
      return;
    }
    let countdown = 2;
    setCmdPreview({ cmd, countdown });
    setCmdCountdown(countdown);

    countdownRef.current = setInterval(() => {
      countdown--;
      setCmdCountdown(countdown);
      setCmdPreview(p => p ? { ...p, countdown } : null);
      if (countdown <= 0) {
        clearInterval(countdownRef.current);
        setCmdPreview(null);
        executeCommand(cmd);
      }
    }, 1000);
  }

  function cancelCommand() {
    clearInterval(countdownRef.current);
    setCmdPreview(null);
    toast("info", "Cancelled", "Command cancelled.");
  }

  function executeCommand(cmd) {
    if (cmd.action === "NEXT") { setStep(s => Math.min(s + 1, 3)); return; }
    if (cmd.action === "BACK") { setStep(s => Math.max(s - 1, 0)); return; }
    if (cmd.action === "UPLOAD") { setStep(0); return; }
    if (cmd.step === 2 && cmd.agent !== undefined) {
      setAgentIdx(cmd.agent);
      if (poData) setStep(2);
      else { setStep(1); toast("info", "Select PO first", "Upload a PDF first, then run the agent."); }
      return;
    }
  }

  function handleCmdKey(e) {
    if (e.key === "Enter") { processCommand(cmdText); }
  }

  // ── Wizard state ──
  const steps = ["Upload PDF", "Select Agent", "Execute", "Summary"];
  const canProceed = step === 1 ? agentIdx !== null : true;

  function next() {
    if (step === 1 && agentIdx === null) { toast("warning", "No agent selected", "Please select an agent first."); return; }
    setStep(s => Math.min(s + 1, 3));
  }
  function back() { setStep(s => Math.max(s - 1, 0)); }
  function restart() { setStep(0); setPOData(null); setAgentIdx(null); }

  return (
    <>
      {/* ── Shell Header ── */}
      <header className="shell-header">
        <div className="shell-logo">SAP <span>Fiori</span></div>
        <div className="shell-title">GR Automation Demo</div>

        {/* Smart Command Bar */}
        <div className="cmd-bar-wrap">
          <input
            className="cmd-bar"
            placeholder='Try "Post GR" or "Validate PO"…'
            value={cmdText}
            onChange={e => setCmdText(e.target.value)}
            onKeyDown={handleCmdKey}
          />
          <button className={`cmd-mic ${listening ? "listening" : ""}`} onClick={startVoice} title="Voice command">
            🎤
          </button>
          {cmdPreview && (
            <div className="cmd-preview">
              <strong>→ {cmdPreview.cmd.label}</strong>
              <span className="cmd-countdown">Auto in {cmdPreview.countdown}s</span>
              <br/>
              <button className="btn btn-ghost" style={{marginTop:6,padding:"4px 12px",fontSize:"0.78rem"}} onClick={cancelCommand}>Cancel</button>
            </div>
          )}
        </div>

        <div className="shell-user">
          <div className="avatar">SS</div>
          <span>sshintre</span>
        </div>
      </header>

      {/* ── Layout ── */}
      <div className="app-layout">
        {/* Sidebar */}
        <nav className="sidebar">
          {[
            { icon: "🏠", label: "Home" },
            { icon: "📄", label: "GR Posting" },
            { icon: "🔍", label: "PO Management" },
            { icon: "📊", label: "Reports" },
            { icon: "⚙️", label: "Settings" },
          ].map((item, i) => (
            <div key={i} className={`sidebar-item ${i === 1 ? "active" : ""}`}>
              <span className="sidebar-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        {/* Main */}
        <main className="main-content">
          {/* Wizard Steps */}
          <div className="wizard-steps">
            {steps.map((s, i) => (
              <div key={i} className={`wizard-step ${i < step ? "done" : ""} ${i === step ? "active" : ""}`}>
                <div className="step-num">{i < step ? "✓" : i + 1}</div>
                <span className="step-label">{s}</span>
              </div>
            ))}
          </div>

          {/* Step Content */}
          {step === 0 && (
            <UploadStep
              onExtracted={data => { setPOData(data); setStep(1); }}
              toast={toast}
            />
          )}
          {step === 1 && (
            <>
              <AgentStep selected={agentIdx} onSelect={setAgentIdx} />
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={back}>← Back</button>
                <button className="btn btn-primary" onClick={next} disabled={agentIdx === null}>Next →</button>
              </div>
            </>
          )}
          {step === 2 && poData && agentIdx !== null && (
            <>
              <ExecuteStep poData={poData} agentIdx={agentIdx} toast={toast} />
              <div className="btn-row">
                <button className="btn btn-ghost" onClick={back}>← Back</button>
                <button className="btn btn-primary" onClick={next}>Finish →</button>
              </div>
            </>
          )}
          {step === 3 && (
            <SummaryStep poData={poData} agentIdx={agentIdx} onRestart={restart} />
          )}
        </main>
      </div>

      <Toasts toasts={toasts} dismiss={dismissToast} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
