# GR Processing Assistant

A browser-based wireframe for processing **goods receipts (GR) against SAP purchase orders**.
It is plain HTML, CSS and JavaScript with no build step and no dependencies.

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
