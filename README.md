# GR Automation (SAP BTP, CAP)

Upload a delivery note PDF, match it with purchase orders in S/4HANA, select the PO items and post the
goods receipt (movement type 101).

1. **Upload** the PDF. PO number, PO item, material, quantity and UoM are extracted (`srv/lib/pdf-extract.js`).
2. **Review** the extracted lines. PDF reading is heuristic, so every value can be corrected.
3. **Match** against `API_PURCHASEORDER_PROCESS_SRV` via the BTP destination `DED_HTTP_200`.
   The quantity tolerance (`QTY_TOLERANCE_PCT`, default 10) is applied to the PO item quantity:
   `matched`, `within tolerance`, `partial` (below PO quantity) are selectable; `over tolerance`,
   unit/material mismatch, closed or unknown items are not.
4. **Post** the selected lines with `API_MATERIAL_DOCUMENT_SRV` (movement type 101). The service matches again
   right before posting and never trusts the browser. "Validate only" runs all checks without posting.

Nothing is stored locally. There is no mock fallback: if S/4HANA cannot be reached the user sees the error.

Known limits: the PO API does not return open quantity, so the tolerance is checked against the PO item
quantity (S/4HANA itself still rejects over-delivery when posting). Scanned PDFs without a text layer are not read (no OCR).

## Layout

```
srv/              CAP service (REST, /api/gr) - extraction, matching, S/4 access
app/              approuter config (XSUAA login, xs-app.json) + UI in app/resources
test/             unit tests (npm test)
start.js          starts CAP (127.0.0.1:4004) and the approuter (public $PORT) in one CF app
manifest.yml      app GR_Automation_Demo
xs-security.json  XSUAA descriptor
.github/workflows/deploy.yml   push to main -> tests -> cf8 push
```

## Deploy to BTP (org_pocus / POC)

One-time service instances:

```
cf8 create-service xsuaa application gr-automation-xsuaa -c xs-security.json
cf8 create-service destination lite gr-automation-destination
cf8 create-service connectivity lite gr-automation-connectivity
```

Then `cf8 push -f manifest.yml`. Users need a BTP identity (any authenticated user may use the app; add scope
checks via the `GRUser` role if you want to restrict it). The destination `DED_HTTP_200` must be visible to the
destination service instance (subaccount level).

---

# Legacy: GR Processing Assistant wireframe (GitHub Pages)

The files `index.html`, `css/`, `js/` in the repository root are the earlier simulated wireframe. They are not
part of the BTP deployment.

> **Status: simulated demo.** No PDF is parsed and no SAP system is called.
> Every upload returns the same sample PO (`4500001234`), and the "SAP" calls are timers.

## Flow

1. **Upload PO** – drop a PDF (mock extraction)
2. **Select agent** – GR Posting, PO Validation, PO Reader, Additional Info
3. **Configure & review** – GR header fields and per-item quantities
4. **Results** – material document confirmation or report

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Deploy on GitHub Pages

1. Push this repository to GitHub (default branch `main`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) publishes the site on every push to `main`.

The app will be available at `https://<user-or-org>.github.io/<repo-name>/`.

## Project structure

```
index.html                    page markup
css/styles.css                styles (light and dark theme)
js/app.js                     wizard logic and simulated agents
.github/workflows/pages.yml   GitHub Pages deployment
```

## Making it real (roadmap)

- [ ] Real PDF extraction (pdf.js in the browser, or an AI/OCR service behind a backend)
- [ ] Middleware layer (e.g. SAP CPI / API Management / BTP) so the browser never holds SAP credentials
- [ ] Confirm the released S/4HANA API for GR posting (likely `API_MATERIAL_DOCUMENT_SRV`) in the SAP Business Accelerator Hub; the demo text references `API_GOODSMVT_SRV`
- [ ] Human approval step before posting, plus an audit log
- [ ] Real validation based on SAP responses (tolerances, blocks, closed items)

## Security notes

- Never commit SAP credentials, tokens or `.env` files (`.gitignore` excludes `.env*`).
- Do not commit real purchase orders, vendor data or client documents.
