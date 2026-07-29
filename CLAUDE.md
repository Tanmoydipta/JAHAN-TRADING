# Jahan Trading System — Project Reference

Flask + vanilla JS ERP system for a trading/inventory business. Config-driven schema (tables, forms, roles all defined in `config.json`, not hardcoded), packaged as a standalone Windows exe via PyInstaller for client delivery.

## Architecture

- **Backend**: `app.py` — Flask app, thin REST layer. All business logic lives in `database.py`.
- **Data layer**: `database.py` — supports **both SQLite and MySQL** through the same code path, switching on `config.json → database_config.mode` (`"sqlite"` or `"mysql"`). Uses `pymysql` for MySQL. Table schemas are generated dynamically at `init_db()` time from `config.json → tables` (column defs auto-translate: `TEXT`→`VARCHAR(255)`, `REAL`→`DOUBLE`, `INTEGER PRIMARY KEY AUTOINCREMENT`→`INT AUTO_INCREMENT PRIMARY KEY` for MySQL).
- **Frontend**: `static/index.html`, `static/app.js` (~750 lines), `static/style.css` (~660 lines) — single-page app, no framework/build step. Config-driven forms: `entry_points` and `report_points` sections of `config.json` define which fields render for each form/report, so adding a new form is a config edit, not a code edit.
- **Config**: `config.json` is the single source of truth for: system settings, DB connection, user roles/permissions, table schemas, and all UI entry/report forms.
- **Multi-tenant-ish**: every table has a `client_id` column; a single DB instance can host multiple "clients" (`default_client_id` in config, currently `"CLI-001"`).

## Database schema (tables, defined in config.json → `tables`)

- `users` — id, username (unique), password_hash (sha256), full_name, role, client_id, is_active
- `products` — id, client_id, product_type, size, unit_price
- `inventory` — id, client_id, product_type, size, quantity, cost_price
- `customers` — id, client_id, customer_name, customer_type, contact_number
- `transporters` — id, client_id, entry_date, transporter_name, truck_no, movement_type, reference_no, quantity, **from_location**, **to_location**, rent, advance, due
- `purchases` — id, client_id, input_invoice_no, purchase_date, supplier_name, mobile_number, product_type, size, unit_price, quantity, total, transporter_name, truck_no, loading_location, **unloading_location**, advance, due
- `sales` — id, client_id, chalan_no, sale_date, buyer_name, contact_number, product_type, size, received_quantity, cost_price, sale_unit_price, sale_total_price, po_order, transporter_name, truck_no, **loading_location**, unloading_location, advance, due

Seed data (`seed_admin_and_demo()`): admin user (`admin`/`admin123`, role=`admin`, client_id=`CLI-001`), 5 demo products (Steel Rod 12mm/16mm, Hydraulic Valve, Brass Fitting, Bearing Set).

## Roles (config.json → `roles`)

`admin` (full access, can_manage_users, can_view_all_clients), `sales_clerk`, `inventory_manager`, `accountant` — each with its own `allowed_entry_points` / `allowed_report_points` lists that the frontend uses to show/hide UI.

## API endpoints (app.py)

- `GET /` — serves `static/index.html`
- `GET /api/config` — returns config **minus secrets**: `database_config` is stripped down to just `{"mode": ...}` before being sent to the browser (never leaks host/user/password to the client-side JS — this was a deliberate security fix, don't regress it)
- `POST /api/login` — `{username, password}` → user + role_permissions
- `GET/POST /api/users` — list / create users
- `GET /api/dashboard?client_id=` — summary metrics
- `GET /api/next_chalan?client_id=` — next sales chalan number
- `GET /api/products?client_id=`, `/api/inventory?client_id=`, `/api/customers?client_id=&type=`
- `POST /api/entry/<entry_id>` — generic save for any entry_point form (`entry_id` matches an id in config `entry_points`)
- `GET /api/report/<report_id>?client_id=&from=&to=&customer=&txn_type=` — generic report runner; `txn_type` (Sales/Purchase/Transport/All) filters customer_dues_report by transaction category
- `GET /api/invoice/<invoice_id>?client_id=` — invoice/chalan data for printing
- `POST /api/letterhead` — updates `config.json → letterhead` and invalidates the in-memory config cache

Config is cached in-memory with mtime-based invalidation (`load_config()` / `invalidate_config_cache()` in `database.py`).

- `GET /api/invoice_refs?client_id=&type=sales|purchases` — returns reference numbers with `quantity`, `from_location`, `to_location` for auto-fill in the transporter entry form

## Report system (config.json → `report_points`)

Each report definition supports these optional flags:
- `supports_period: true` — shows the date range filter in the toolbar
- `supports_customer_filter: true` — shows the customer name filter
- `supports_txn_type_filter: true` — shows a Sales/Purchase/Transport/All dropdown (currently on `customer_dues_report` only)

### Transport cost in reports

Sales, purchases, and profit reports include transport cost via **correlated subqueries** (not JOINs) to avoid alias complications with the named-param date filter. Pattern:
```sql
COALESCE((SELECT SUM(rent) FROM transporters
          WHERE reference_no = <invoice_col>
          AND client_id = :client_id
          AND movement_type = 'Sales|Purchase'), 0) as transport_cost
```
This works in both SQLite and MySQL.

### customer_dues_report txn_type dispatch

When `txn_type` ≠ `All`, `execute_report()` in `database.py` builds a per-type SQL query at runtime (not from config):
- `Sales` → aggregates from `sales` table, grouped by `buyer_name`
- `Purchase` → aggregates from `purchases` table, grouped by `supplier_name`
- `Transport` → aggregates from `transporters` table, grouped by `transporter_name`

### Transporter entry auto-fill

The `new_transporter` form has two **readonly** fields: `from_location` and `to_location`. When the user picks an invoice reference (`invoice_ref_select`), `app.js` reads `from_location`/`to_location` from the `<option>` element's `dataset` (populated by `/api/invoice_refs`) and fills those fields automatically.

### Print / PDF output

`printReportTable()` in `app.js` opens a **new browser window** (`window.open('', '_blank', 'width=1200,height=850')`) and builds a clean white HTML document with:
- Company letterhead from `systemConfig.letterhead`
- Report title + active filters as subtitle
- `border-collapse: collapse` table with zebra striping and right-aligned numeric columns
- Summary footer (total records + aggregate value)
- `@page { size: A4 landscape; }` print CSS
- `setTimeout(() => win.print(), 600)` for DOM readiness

The main window's `style.css` print block only shows `#invoiceModal.active` — all other `.modal-overlay` elements are hidden during print to prevent the dark-themed app from leaking into the printout.

## Cloud database (Aiven MySQL)

`config.json → database_config` currently points at a **live Aiven MySQL instance** (`mode: "mysql"`, database `defaultdb`, MySQL 8.4.8). Connection requires SSL:

- `ca.pem` — Aiven's self-signed CA cert, must sit next to `config.json` (referenced via `ssl_ca_path`)
- **Important fix already applied**: connecting via PyMySQL's `ssl={'ca': path}` shortcut fails against Aiven with `CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain`. The working approach (already in `database.py → get_db_connection()`) builds an explicit `ssl.SSLContext` via `ssl.create_default_context(cafile=resolved_ca)` with `check_hostname=False` and `verify_mode=ssl.CERT_REQUIRED`. Don't revert to the dict shortcut.

**⚠️ SENSITIVE**: `config.json` currently contains the **vendor's own live Aiven password in plaintext**. Before shipping to any real client, run `generate_customer_config.py` to produce a customer-specific config pointed at *their* database — do not distribute this repo's `config.json` as-is. Never commit/paste/share this file's `database_config` block.

## Packaging for client delivery (build.py)

Goal: client runs the exe with **zero Python/module installation**.

- `python build.py` runs PyInstaller with `--onedir` (not `--onefile` — onedir gives near-instant startup vs onefile's slow temp-extraction-per-launch; the tradeoff is you must distribute the whole output folder, not just the `.exe`)
- Uses `sys.executable -m PyInstaller` (not a bare `pyinstaller` on PATH) — guarantees the interpreter that actually has Flask/PyMySQL installed is the one used to build
- Bundles `static/`, `config.json`, and `ca.pem` (if present) via `--add-data`
- Output: `dist/JahanTradingSystem/JahanTradingSystem.exe` + `dist/JahanTradingSystem/_internal/` (contains bundled Python runtime `python314.dll` + all deps + the data files above — **this confirms the client needs no separate Python install**)
- To hand the client "one file": zip the entire `dist/JahanTradingSystem/` folder (e.g. `Compress-Archive`). Client unzips, runs the exe inside — same onedir speed, single download.
- Verify a rebuild actually targets Aiven (not stale/local SQLite) by checking `dist/JahanTradingSystem/_internal/config.json` for `mode: mysql` / the Aiven host, and/or hitting the running exe's `/api/products` or `/api/dashboard` to see real seeded data come back.

## Resale toolkit

- `generate_customer_config.py` — interactive CLI that prompts for a customer's company info + their own cloud DB credentials and writes a customer-specific `config.json`. Use this before onboarding any real paying client.
- `RESALE_DEPLOYMENT_GUIDE.md`, `RESALE_QUICK_REFERENCE.txt` — written guides for the resale/white-label workflow.

## Known state / open items

- No connection pooling for MySQL (each request opens/closes a connection via `get_db_connection()`).
- No license-key / anti-piracy mechanism on the exe.
- UI has not been exhaustively manually browser-tested across all entry/report forms — spot-checked login + products/dashboard API only.
- `jahan_trading.db` in the project root is a local SQLite leftover from earlier local-mode testing; irrelevant while `mode: mysql` is active.
- Flask dev server (`app.run(debug=False)`) is used directly — fine for a single-client desktop-style exe, not hardened for concurrent/public use.
- `app.py` auto-opens the user's default browser 1.2s after the server starts (`threading.Timer` → `webbrowser.open_new`).

## Schema migration pattern

New columns are added to live DBs automatically via `_migrate_missing_columns()` in `database.py` — it runs `ALTER TABLE ... ADD COLUMN` for any column in `config.json → tables` that is missing from the live schema. No manual DB migration is ever needed; just add the column to config and restart. Columns added in the last major session: `unloading_location` (purchases), `loading_location` (sales), `from_location`/`to_location` (transporters).

## Full session history

See `CHAT_SUMMARY.txt` in this folder for the detailed narrative (SSL debugging, security fixes, build troubleshooting) if deeper historical context is ever needed — this file is meant to replace the need to re-read it or the source files from scratch.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
