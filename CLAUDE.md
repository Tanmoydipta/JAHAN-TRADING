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
- `products` — id, client_id, product_type, size, unit_price, **origin** (nullable, auto-migrated)
- `inventory` — id, client_id, product_type, size, quantity, cost_price
- `customers` — id, client_id, customer_name, customer_type, contact_number, **address**
- `transporters` — id, client_id, entry_date, transporter_name, truck_no, movement_type, reference_no, quantity, **from_location**, **to_location**, **unit_rate_per_ton**, rent, advance, due, **address**
- `purchases` — id, client_id, input_invoice_no, purchase_date, supplier_name, mobile_number, product_type, size, unit_price, quantity, total, transporter_name, truck_no, loading_location, **unloading_location**, advance, due, **record_source** (`'New'`/`'Previous'`, default `'New'`), **address**
- `sales` — id, client_id, chalan_no, sale_date, buyer_name, contact_number, product_type, size, received_quantity, cost_price, sale_unit_price, sale_total_price, po_order, transporter_name, truck_no, **loading_location**, unloading_location, advance, due, **record_source** (`'New'`/`'Previous'`, default `'New'`), **address**, **unloading_cost_per_unit**, **unloading_cost**
- `quotations` — id, client_id, quotation_no, quotation_date, customer_name, product_type, size, origin, unit_price, quantity, total, status (`pending`/`approved`), created_by, authorized_by, authorized_at, **address**, **project_location**
- `challan_uploads` — id, client_id, chalan_no, file_name, drive_file_id, drive_view_url, uploaded_by, uploaded_at (one row per chalan_no — see Google Drive section)
- `payments` — id, client_id, payment_date, txn_type (`Sales`/`Purchase`/`Transport`), customer_name, total_amount, notes, created_by, created_at
- `payment_allocations` — id, client_id, payment_id, table_name (`sales`/`purchases`/`transporters`), reference_no, allocated_amount (see Customer Payment / Receipt section)
- `customer_credits` — id, client_id, txn_type (`Sales`/`Purchase`), customer_name, amount (positive = credit created, negative = credit consumed), reference_no, notes, created_by, created_at (see Overpayment credit section)

Seed data (`seed_admin_and_demo()`): admin user (`admin`/`admin123`, role=`admin`, client_id=`CLI-001`), 5 demo products (Steel Rod 12mm/16mm, Hydraulic Valve, Brass Fitting, Bearing Set).

## Roles (config.json → `roles`)

`admin` (full access, can_manage_users, can_view_all_clients), `sales_clerk`, `inventory_manager`, `accountant` — each with its own `allowed_entry_points` / `allowed_report_points` lists that the frontend uses to show/hide UI.

## API endpoints (app.py)

- `GET /` — serves `static/index.html`
- `GET /api/config` — returns config **minus secrets**: `database_config` is stripped down to just `{"mode": ...}` before being sent to the browser (never leaks host/user/password to the client-side JS — this was a deliberate security fix, don't regress it)
- `POST /api/login` — `{username, password}` → user + role_permissions
- `GET/POST /api/users` — list / create users
- `PUT /api/users/<id>` — admin-only edit username/password
- `DELETE /api/users/<id>` — admin-only delete user
- `GET /api/dashboard?client_id=` — summary metrics
- `GET /api/next_chalan?client_id=` — next sales chalan number
- `GET /api/products?client_id=`, `/api/inventory?client_id=`, `/api/customers?client_id=&type=`
- `POST /api/entry/<entry_id>` — generic save for any entry_point form (`entry_id` matches an id in config `entry_points`)
- `POST /api/entry/<entry_id>/multi` — multi-item save for sales/purchase (shared fields + array of line items)
- `PUT /api/record/<table>/<id>` — admin-only generic update (whitelisted tables: products, customers)
- `DELETE /api/record/<table>/<id>` — generic delete (permissions: can_delete role flag)
- `POST /api/record/<table>/<id>/adjust` — adjust due date / advance on transaction (admin-only)
- `GET /api/report/<report_id>?client_id=&from=&to=&customer=&txn_type=` — generic report runner; `txn_type` (Sales/Purchase/Transport/All) filters customer_dues_report by transaction category
- `GET /api/invoice/<invoice_id>?client_id=` — invoice/chalan data for printing
- `POST /api/letterhead` — updates `config.json → letterhead` and invalidates the in-memory config cache

Config is cached in-memory with mtime-based invalidation (`load_config()` / `invalidate_config_cache()` in `database.py`).

- `GET /api/invoice_refs?client_id=&type=sales|purchases` — returns reference numbers with `quantity`, `from_location`, `to_location` for auto-fill in the transporter entry form
- `GET /api/quotation_refs?client_id=` — approved quotations available to link into a Sales Entry
- `GET /api/quotation/<quotation_no>?client_id=` — quotation header + line items, used both for the print pad and Sales Entry auto-fill
- `POST /api/quotation/<quotation_no>/approve` — admin-only, flips every row sharing that quotation_no to `status='approved'`
- `POST /api/sales/<chalan_no>/challan` — multipart file upload; pushes the file to Google Drive (OAuth, as the business owner's own account) and records the link in `challan_uploads`
- `POST /api/letterhead/pad_image` — multipart file upload; pushes the pad image to Google Drive and stores its file_id in `letterhead_settings.pad_image`
- `GET /api/letterhead/pad_image_proxy?id=<file_id>` — public (no auth), streams the pad image bytes from Drive through our own origin (see Google Drive section for why this proxy exists)

## Report system (config.json → `report_points`)

Each report definition supports these optional flags:
- `supports_period: true` — shows the date range filter in the toolbar
- `supports_customer_filter: true` — shows the customer name filter (a **dropdown**, not free text — see below)
- `supports_po_filter: true` — shows a PO Order dropdown, cascaded off the customer filter and date range (currently `sales_report` only — see below)
- `supports_txn_type_filter: true` — shows a Sales/Purchase/Transport/All dropdown (currently on `customer_dues_report` only)

Reports include built-in action buttons depending on configuration:
- **Delete** button: available if report is in `DELETABLE_REPORT_TABLES` (sales, purchases, transporters, inventory, products, customers, quotations) and user has `can_delete` permission
- **Edit** button: available if report is in `EDITABLE_REPORT_TABLES` (products_report, customer_report) and user is admin
- **Adjust** button: available if report is in `ADJUSTABLE_REPORT_TABLES` (sales, purchases, transporters) and user is admin — allows tweaking payment_due_date and advance deltas
- **Invoice** button: available on sales_report only — opens the invoice modal for printing/viewing
- **Challan** button: available on sales_report only — uploads a file to Google Drive for that chalan_no (see Google Drive section); the "Challan File" column shows a **View File** link once uploaded
- **Print** button: available on quotation_report only — reopens the quotation print pad
- **Approve** button: available on quotation_report only when `row.status === 'pending'` and user is admin — calls the approve endpoint for that quotation_no

A new **Customer Directory** report (`customer_report`) lists all customers with name, type, and contact number, with Edit and Delete actions available to admins.

### Customer + PO Order dropdown filters (sales_report, customer_transactions_report)

The toolbar's "Customer" filter (`reportCustomerFilter` in `index.html`) is a **dropdown**, not a free-text box — it used to be a plain `<input>`, but the backend's `{customer_filter}` clause (`execute_report()` in `database.py`) always did an *exact* match (`= :customer`), so a partial-text box was actually broken UX (nothing matched unless you typed the full name exactly). The dropdown's options come from `GET /api/report/<report_id>/customer_options` (`list_report_customer_options()`), which pulls **distinct names straight from the transaction tables themselves** (sales/purchases/transporters), not the `customers` catalog — this way Previous-mode/free-text names and non-"Sales"-type parties (suppliers, transporters) are all selectable, and every option is guaranteed to match something. `sales_report` uses `buyer_name` only; `customer_transactions_report` (and any future union-style report) pools `buyer_name` + `supplier_name` + `transporter_name` since its rows can be any of the three. `populateReportCustomerFilter()` in `app.js` refetches this list whenever a report with `supports_customer_filter` is opened.

`sales_report` additionally has a **PO Order** dropdown (`reportPoFilter`, `poFilterWrap`), populated by `GET /api/report/<report_id>/po_options` (`list_report_po_options()`) from distinct `sales.po_order` values. It's **cascading**: changing the Customer dropdown or either date field calls `populateReportPoFilter()` again, which re-fetches PO options scoped to the currently-selected customer/date-range (`customer`/`from`/`to` query params) — so the PO list only ever shows orders that actually exist for that slice. The backend's `{po_filter}` clause in `execute_report()` mirrors `{customer_filter}`'s exact-match pattern, gated by `supports_po_filter` + `po_order = :po_order`. This filter is sales-only (`purchases`/`transporters` have no `po_order` column) so it isn't offered on `customer_transactions_report`.

`sales_report` and `customer_transactions_report` both gained **PO Order** and **Truck #** columns (`po_order`, `truck_no`) — pulled straight off `sales`, and for `customer_transactions_report`'s Purchase/Transport UNION branches, `po_order` is selected as `NULL` (only `sales` has that column) while `truck_no` is real (all three tables have it). No special frontend code was needed for either column — the report table, PDF export, and print view are all fully generic off `data.columns`/`data.keys`/`data.data` (`loadReportData()` / `buildReportPrintDocument()` in `app.js`), so adding a column to a report's config `query`/`columns` is sufficient on its own.

### Record mode (New/Previous) report filter

`customer_dues_report` and `customer_transactions_report` have `supports_record_mode: true` and a "Records" New/Previous dropdown in the toolbar (`reportRecordModeFilter` in `index.html`, wired in `loadReportData()`). This filters their sales/purchases sub-selects by the `record_source` column — see the "New vs Previous entry mode" section below. Transporters have no `record_source` column at all, so a "Previous" view excludes that table's rows entirely (`_record_mode_clause()` in `database.py` returns `AND 1=0` for it in that case) rather than erroring.

### Transport cost in reports

Sales, purchases, and profit reports include transport cost via **correlated subqueries** (not JOINs) to avoid alias complications with the named-param date filter. Pattern:
```sql
COALESCE((SELECT SUM(rent) FROM transporters
          WHERE reference_no = <invoice_col>
          AND client_id = :client_id
          AND movement_type = 'Sales|Purchase'), 0) as transport_cost
```
This works in both SQLite and MySQL.

### customer_dues_report: three-way due split (Sales Receivable / Purchase Payable / Transport Payable)

`customer_dues_report`'s "Total Due" column was split into three, since a due balance owed *to* a customer (Sales Receivable) is a fundamentally different number from a due balance the business owes *out* (Purchase/Transport Payable), and lumping them together obscured which was which. The default ("All") query tags each UNION branch with a `role` literal (`'sales'`/`'purchase'`/`'transport'`) and uses conditional aggregation (`SUM(CASE WHEN role = 'sales' THEN due ELSE 0 END) as sales_receivable`, etc.) to produce `sales_receivable`, `purchase_payable`, `transport_payable`, and an overall `total_due` — 7 columns total (`Customer`, `Total Amount`, `Total Advance`, `Sales Receivable`, `Purchase Payable`, `Transport Payable`, `Total Due`). `summary_column` stays `total_due` (the grand total across all three).

When `txn_type` ≠ `All`, `execute_report()` in `database.py` builds a per-type SQL query at runtime (not from config) — `Sales`/`Purchase`/`Transport` each aggregate from just that one table (grouped by `buyer_name`/`supplier_name`/`transporter_name` respectively). **These per-type queries must select the same 7-column shape as the "All" query** (with the two inapplicable buckets hardcoded to `0`), even though only one bucket is ever non-zero — the frontend renders headers from `report_def['columns']` (always the full 7) but data cells from the query's own `db_keys`, so a column-count mismatch between the two would silently misalign every row.

### Multi-item entries (Sales / Purchase)

Sales and Purchase entry forms now support multiple product line items in a single transaction (one chalan_no or input_invoice_no shared across all rows). Frontend (`app.js`):
- `MULTI_ITEM_FIELDS` maps `new_sale` → [product_type, size, cost_price, received_quantity, sale_unit_price, unloading_cost_per_unit] and `new_purchase` → [product_type, size, quantity, unit_price]
- User sets a "Number of Products" count; `renderLineItemRows()` renders N rows with row-level inputs + live subtotal per row
- `recalcLineItemTotals()` computes grand total + grand advance + grand due across all rows
- `collectLineItems()` gathers all line-item data; `handleFormSubmit()` detects multi-item mode and calls `/api/entry/<entry_id>/multi` instead of `/api/entry/<entry_id>`

Backend (`database.py → save_multi_item_entry()`):
- Accepts `shared` (buyer_name, sale_date, advance, etc.) and `line_items` (array of product specs)
- Generates one chalan_no/input_invoice_no and saves N rows to the `sales`/`purchases` table, all sharing that same ref
- First row gets full `advance`/`due` attribution; subsequent rows get 0/0 so report aggregates stay correct
- Inventory side-effects apply per row: `_inventory_add_purchase()` and `_inventory_reduce_sale()` run for each item

Invoice rendering (`get_invoice_data()` / `openInvoiceModal()`):
- Returns all rows sharing a chalan_no as `data.items` (single-product sales unaffected — items is just length 1)
- Invoice modal renders one table row per product and sums subtotal/advance/due/grand across them

### Unloading cost (Sales line items)

Each Sales line item has an **Unloading Cost per Unit** (`unloading_cost_per_unit`, optional, default 0) — a per-unit cost the client incurs unloading that product, distinct from `unloading_location` (a place name) and from transporter rent (a separate cost tracked on the `transporters` table). **Unloading Cost** (`unloading_cost` — the stored total) is always `received_quantity * unloading_cost_per_unit`, computed authoritatively server-side (same "never trust a client-submitted total" pattern as `sale_total_price`) in `save_entry()`, `save_multi_item_entry()`, and `update_multi_item_entry()` (Modify mode) — all three sales code paths compute it independently since each builds its own row data.
- Frontend (`app.js → buildLineItemRow()`): both `new_sale` rendering branches (manual/Previous/Modify combo, inventory-linked select) get an extra "Unload Cost/Unit" input (`li_unloading_cost_per_unit_${idx}`) after Sale Price, wired to `recalcLineItemTotals()` on input like the other line-item fields.
- `recalcLineItemTotals()` computes and displays a live per-row "Unloading Cost" total (`li_unload_cost_${idx}`) next to the existing "Line Subtotal" — this is a **display-only** live preview; it does not feed into the row's Subtotal/grand total/due (unloading cost isn't part of what the customer owes, it's an internal cost that only affects profit, same treatment as `cost_price`/COGS).
- `sales_report` shows both `Unload Cost/Unit` and `Unload Cost` (total) columns. `profit_report`'s `net_profit` now subtracts `unloading_cost` alongside COGS and transport cost: `sale_total_price - (qty * cost_price) - unloading_cost - transport_cost`.

### Overpayment credit (customer_credits ledger)

Sales/Purchase Entry now caps a saved invoice's own `advance` at that invoice's own total — it can never exceed 100% funded on the stored row — and routes any excess through a dedicated append-only ledger (`customer_credits`) instead of silently absorbing it. This was triggered by discovering real production purchases where `advance > total` (up to ~870,000 BDT overpaid on one invoice) with no record of where the excess went; `due` correctly floored at 0 but the overpayment itself was untracked and unusable toward a future bill.

- **Ledger, not a mutable balance**: each row is either a positive entry (credit created by an overpayment) or a negative entry (credit consumed against a later invoice) — mirrors the `payments`/`payment_allocations` audit-trail pattern rather than mutating a running total in place. Available balance for a party is always `SUM(amount)` (`get_available_credit()`).
- **Creating credit** (`database.py`): in both `save_entry()` and `save_multi_item_entry()`'s sales/purchases branches, after the invoice-level `advance`/`due` are computed, if the effective advance exceeds the invoice's grand total, the excess is recorded via `_record_credit_entry()` (txn_type `Sales`/`Purchase`, keyed to `buyer_name`/`supplier_name`) and the stored `advance` is capped down to the grand total. **Previous-mode entries are excluded** — same rationale as the inventory-skip: no live balance workflow applies to a historical backfill row.
- **Applying credit**: the client can submit `apply_credit` (a shared field, not per-line-item) alongside the normal `advance`. `_consume_customer_credit()` validates the requested amount against the party's *actual* available balance server-side (never trusts the client's number), records a negative ledger entry for whatever portion is actually consumable, and the returned amount is added into the effective advance before `due` is computed — so applying credit behaves exactly like additional cash received/paid toward that invoice. If the combined advance (manual + applied credit) still exceeds the new invoice's total, that excess rolls forward into a fresh credit entry through the same overpayment path.
- Frontend (`app.js`): an "Available Credit" box (`creditBoxWrap`, hidden when balance is 0) renders after the buyer/supplier field for `new_sale`/`new_purchase` in **New mode only** — `updateAvailableCredit()` fetches `GET /api/customer_credit?txn_type=&customer=` on customer selection (hooked into the same onchange as `fills_contact_field`/`fills_address_field`) and shows an editable "Apply" amount (`input_apply_credit`, `name="apply_credit"` so `FormData` picks it up automatically into the shared payload). `recalcLineItemTotals()` folds the applied amount into the live due preview and flags a resulting overpayment ("...saved as credit") the same way the backend will handle it.
- **Scope**: intentionally Sales/Purchase only (matching the request that introduced this) and New-mode only — Modify mode's `update_multi_item_entry()` does not touch credit creation/consumption. Transport also has real overpaid rows in production (found during the same DB check) but isn't wired into this ledger — flagged, not built, since it wasn't part of the request.
- No dedicated report yet for this ledger (unlike Payments) — balances currently surface only inline on the entry form. Straightforward to add a `customer_credits`-backed report_point later if needed.
- **One-time data fix**: the 6 pre-existing overpaid purchases discovered during the DB check that introduced this feature were retroactively corrected — each invoice's stored `advance` capped down to its own `total` (matching what new entries now do automatically) and the excess recorded as a `customer_credits` row (`notes = 'Retroactive credit from historical overpayment'`). Resulting balances: MS WELCOME ENTERPRISE. 870,237.20, MS MIM ENTERPRISE 660,631.00, MS SHAHADAT ENTERPRISE 166,300.00, MS JAHAN TRADING L.C 153,365.00 — all immediately usable via the Available Credit box on their next Purchase Entry. The 3 overpaid Transporter rows found in the same check were **not** touched (Transport is out of scope for this feature — see above).

### Customer Payment / Receipt

`new_payment` (table `payments`) is a **custom, non-config-driven entry form** — the due-bill picker is fetched dynamically per customer, so it's built entirely via DOM in `app.js → renderPaymentEntryForm()` (like the multi-item line rows) rather than through the generic field-loop in `renderEntryForm()`, which special-cases `entryId === "new_payment"` at its top and delegates instead.

Flow: pick **Transaction Type** (`Sales`/`Purchase`/`Transport`) → `populatePaymentCustomers()` fetches `GET /api/customers_with_dues?txn_type=` (`list_customers_with_dues()` in `database.py`) — only parties with `SUM(due) > 0` for that type appear → picking a customer calls `loadPaymentDueBills()` → `GET /api/customer_dues?txn_type=&customer=` (`list_customer_dues()`) returns their outstanding bills **grouped by reference number** (so a multi-item transaction shows as one bill with its true invoice-level total/advance/due, not one row per line item) → each bill row gets an editable "Amount to apply" input, live-summed into a running Total by `updatePaymentTotal()`. `handleFormSubmit()` special-cases `currentEntryId === "new_payment"` to collect `{payment_date, txn_type, customer_name, notes}` + an `allocations` array (only bills with amount > 0) and POST to `/api/payment` (or PUT `/api/payment/<id>` when `paymentEditId` is set — see Edit below).

Backend (`database.py`):
- `PAYMENT_TXN_TABLES` maps each txn_type to its underlying table/ref column/name column/total column/date column (`Sales`→`sales`/`chalan_no`/`buyer_name`/`sale_total_price`/`sale_date`, etc.) — the single source of truth every payment function keys off of.
- `_apply_payment_delta(cursor, mode, client_id, table_name, ref_col, total_col, reference_no, delta_amount)` — the core primitive. Adds (or, with a negative delta, subtracts) `delta_amount` to/from the **advance of whichever row currently carries the due** for that reference (the first row of a multi-item group, by id), then recomputes `due = max(0, grand_total - new_advance)` where `grand_total` is `SUM(total_col)` across **every** row sharing that reference — not just the first row's own total. This mirrors the existing "first row of a multi-item group holds the whole invoice's advance/due" invariant from `save_multi_item_entry()`. **Note**: the older Adjust feature (`adjust_entry()`) does *not* do this — it uses just the clicked row's own total, which is wrong for a multi-item transaction's first row; a pre-existing gap, not something this feature touches.
- `save_payment()` validates (`_validate_payment_input()`), computes `total_amount` server-side as `SUM(allocations)` (never trusts a client total), inserts the `payments` header + one `payment_allocations` row per bill, and calls `_apply_payment_delta(+amount)` for each.
- `update_payment()` (admin-only) validates the **new** data first, then `_reverse_payment()`s the old allocations (applies `_apply_payment_delta(-amount)` for each, then deletes the old payment + allocation rows) and inserts a fresh payment via the same `_insert_payment_and_allocations()` helper `save_payment()` uses — same reverse-old/insert-new pattern as `update_multi_item_entry()`, and it gets a **new** `payment_id` (nothing else points at a payment by id, so unlike chalan_no there's no need to preserve it).
- `delete_payment()` (admin-only) just calls `_reverse_payment()`.

Frontend Edit/Delete (`payment_report`, "Payment / Receipt Ledger"): admin-only `canEditPayment`/`canDeletePayment` flags in `loadReportData()` render dedicated buttons (not the generic `EDITABLE_REPORT_TABLES`/`DELETABLE_REPORT_TABLES` maps, since payments need the allocation-reversal logic above, not a plain field update or `delete_entry()`). **Edit** (`editPaymentFromReport()`) deliberately duplicates `switchEntryTab()`'s tab-switching instead of calling it, because `switchEntryTab()` resets `paymentEditId` to null and fires its own un-awaited `renderEntryForm()` — calling it directly would race that reset against the edit-mode load. `loadPaymentForEdit()` then fetches `GET /api/payment/<id>`, pre-fills the form, and re-injects any allocation whose bill no longer shows in the "due > 0" list (because this exact payment already zeroed it out) as a synthetic row. **Delete** (`deletePaymentFromReport()`) just calls `DELETE /api/payment/<id>` and reloads the report.

Every report that already reads `advance`/`due` off `sales`/`purchases`/`transporters` (Sales Report, Purchase Report, Customer-wise Advance & Due, Transporter Ledger) reflects a payment automatically — no report-specific wiring was needed, since a payment mutates the same columns those reports already query.

### Line-item mandatory field validation (Sales / Purchase / Quotation)

Product Type, Quantity, and Unit Price are enforced as mandatory on every line item row, both client- and server-side (previously the "*" on these labels was cosmetic only — a row could be saved with no product selected and quantity/price left at 0).
- Frontend (`app.js → buildLineItemRow()`): all 4 rendering branches (manual/Previous/Modify combo, inventory-linked select for `new_sale`, product select for `new_quotation`, product select for `new_purchase`) set `.required = true` and `.min = "0.01"` on the product/quantity/price inputs, so native HTML5 validation blocks submission before `handleFormSubmit()`'s `preventDefault()` ever runs.
- Backend (`database.py → _validate_line_items(table_name, line_items)`): mirrors the existing "fail fast before mutating" pattern of `_validate_linked_customers()`/`_validate_required_shared_fields()`. Checks non-blank `product_type` and a >0 quantity/price (`received_quantity`/`sale_unit_price` for sales, else `quantity`/`unit_price`). Called from `save_multi_item_entry()` (sales/purchases/quotations), `update_multi_item_entry()` (Modify mode), and `save_entry()` (wraps its single row as a one-item list so the same rule applies there too).
- **`size` is deliberately excluded** from both layers — `config.json` sets `required: false` on every line-item `size` field since it's auto-derived from the product pick; forcing it would create dead-end submissions for products with no size on file.

### Transporter entry auto-fill

`new_transporter`'s fields are ordered: Date → **Type of Movement** → **Chalan/Invoice reference** → auto-filled transport details → **Unit Rate per Ton** → Rent → Advance → Due → Payment Due Date.

- `movement_type` (Purchase/Sales) drives `reference_no` (`type: invoice_ref_select`, `depends_on: movement_type`). `GET /api/invoice_refs?type=sales|purchases` (`database.py → list_invoice_refs()`) now returns one row **per chalan_no/input_invoice_no** (`GROUP BY reference_no, buyer_name/supplier_name`, aggregated with `SUM()`/`MAX()`) rather than one row per line item — a multi-item sale/purchase spreads across several DB rows sharing one chalan, so grouping is what makes the dropdown's quantity/total reflect the whole transaction instead of just its first product line. Each row includes `customer_name`, `total_amount`, `quantity`, `transporter_name`, `truck_no`, `from_location`, `to_location`.
- The dropdown label is rendered as `{reference_no} — {customer_name} (BDT {total_amount})`, e.g. `PUR-848522 — SS TRADING (BDT 216163.10)`.
- Selecting a reference auto-fills, all **readonly**: `transporter_name`, `truck_no`, `quantity`, `from_location` ("Loading Location"), `to_location` ("Unloading Location") — read straight off the chosen `<option>`'s `dataset` (`app.js`'s `invoice_ref_select` `onchange` handler). `transporter_name`/`truck_no` come from the **sales/purchases row itself** (both tables already capture these at Sale/Purchase Entry time — see schema above), not from a separate lookup.
- `contact_number`/`address` are then filled by a **best-effort match** against the registered Transport-type customer catalog (`getCustomersByType("Transport")`, cached), keyed on the auto-filled `transporter_name` string — this is a live convenience lookup, not persisted from the invoice record, so it comes up blank if that transporter isn't (or is no longer) a registered customer under that exact name.
- `transporter_name` is no longer a `customer_select` on this form (it was, prior to this redesign) — it's a plain readonly text field, since the value must come from the invoice/chalan record, not a fresh pick.
- **Unit Rate per Ton** (`unit_rate_per_ton`, new column on `transporters`) is the only manually-entered number in this block. **Rent is always `unit_rate_per_ton * quantity`**, computed authoritatively server-side in `save_entry()`'s `transporters` branch (never trusts a client-submitted rent value, same pattern as sales/purchase totals) and mirrored live in the UI by `calculateTransporterTotal()` (`app.js`), which also drives the existing rent-minus-advance `due` suggestion. The `rent` field itself is now readonly.
- `transporter_report` gained a "Rate/Ton" column (`unit_rate_per_ton`) between "To" and "Rent".

### Customer address auto-fill

`customers` gained an `address` field (Customer Registration). Every `customer_select` field that references a customer (`buyer_name` in `new_sale`, `supplier_name` in `new_purchase`, `customer_name` in `new_quotation`) can declare `fills_address_field: "<field_name>"` in its config — mirroring the existing `fills_contact_field` mechanism. `renderEntryForm()` in `app.js` sets `option.dataset.address` when building the dropdown and fills the target field's value on change; both `fills_contact_field` and `fills_address_field` now share one `onchange` handler instead of two separate ones. (`transporter_name` in `new_transporter` used this mechanism before the transporter-entry redesign above; it now gets contact/address via the reference-lookup match described in that section instead.)

Like `contact_number`, the address is **denormalized onto the transaction row itself** (`sales.address`, `purchases.address`, `transporters.address`, `quotations.address`) at save time rather than joined from `customers` at read time — this keeps historical documents (invoices, old reports) showing the address as it was when the transaction happened, not the customer's current address if it's since changed. Linking a quotation into a Sales Entry (`applyQuotationToSale()`) carries the quotation's own stored `address` across (falling back to the matched customer option's current address if the quotation has none).

In **Previous** (historical backfill) mode, `forceEditable` was broadened from "just `chalan_no`" to **any** readonly field — since there's no live customer/inventory link in that mode to auto-populate `contact_number`/`mobile_number`/`address`/`cost_price` from, they all need to become plain editable inputs, not just the reference number.

Address was added to: Customer Directory, Sales Report, Purchase Report, Transporter Ledger, and Quotation Report (report columns), plus the invoice and quotation print pads (`padCustAddress`/`qpCustAddress`). It was **not** added to `customer_dues_report`/`customer_transactions_report` — those are aggregate UNION queries grouped by `customer_name` across three different tables, and joining address back in there would need fuzzy matching against free-text names (especially in Previous mode) for little practical benefit over just checking Customer Directory or the per-transaction reports directly.

### Product & Customer editing

Frontend (`app.js`) exposes Edit buttons on `products_report` and the new `customer_report` via `EDITABLE_REPORT_TABLES` map (spec: `{ table, entryPointId }`). Clicking Edit opens a dynamic modal (`editRecordModal`) pre-filled from the report row, with fields sourced from the matching entry_point's field list. `submitEditRecord()` POSTs to `PUT /api/record/<table>/<id>`.

Backend (`database.py → update_record()`):
- Admin-only (role check enforced). Whitelisted to `EDITABLE_TABLES = ('products', 'customers')` — transaction tables excluded since editing quantity/price after the fact would desync inventory and due/advance.
- Filters payload to only real table columns; excludes immutable `id` and `client_id`. Returns `{status: success, table, id}`.

### Quotations

`new_quotation` entry_point (table `quotations`) reuses the same multi-item line-item UI as Sales/Purchase (`MULTI_ITEM_FIELDS.new_quotation = ['product_type', 'size', 'origin', 'unit_price', 'quantity']`). Shared fields: quotation_no (auto-generated, readonly), quotation_date, customer_name (customer_select, `Sales` type filter).

Backend (`database.py`):
- `save_multi_item_entry()` was extended to accept `table_name == 'quotations'` alongside sales/purchases — it shares the same line-item-total computation as purchases (`quantity`/`unit_price`/`total`), just with no advance/due and no inventory side-effects.
- Quotations always save with `status = 'pending'` regardless of who creates them — an admin must explicitly approve via `quotation_report`'s **Approve** button (`approve_quotation()`), which flips every row sharing that quotation_no to `status = 'approved'`.
- `get_next_quotation_no()` — `QT-` prefix + zero-padded counter, based on the **MAX numeric suffix** among existing `quotation_no` values (not a count). **Fixed bug**: it used to be `COUNT(DISTINCT quotation_no) + 1`, which collides forever once any gap appears in the sequence (a deleted quotation, or any number skipped for any reason) — the count stops matching the highest number actually in use, so every new quotation recomputes the *same* already-taken number (observed in production: every new quotation kept saving as `QT-000005` once a gap opened up after `QT-000002` went missing). MAX is immune to gaps since it only looks at what's highest, not how many rows exist. Fixing this required manually renumbering the duplicate rows already sitting in the live DB (four rows sharing `QT-000005` got spread across `QT-000005`/`QT-000006`/`QT-000007`/`QT-000008` by `id`) — a one-time cleanup, not something the code does automatically.
- `get_quotation_data(quotation_no, client_id)` — returns header + all line items + `grand_total` + `project_location`, used both by the print pad (`openQuotationModal()` in `app.js`) and by Sales Entry's auto-fill.
- `list_quotation_refs(client_id)` — only **approved** quotations, for the Sales Entry dropdown.

`quotations` has a **Project Location** field (`project_location`, plain text, optional) — the physical job-site address for that quote, distinct from the customer's own `address`. Rendered in `new_quotation` right after Address, and shown as a column in `quotation_report`. It also feeds the print pad's Sub/intro lines (`qpSubLine`/`qpIntroPara` in `openQuotationModal()`) when present, e.g. "...for BASUNDARA's Project at Mirsarai Zone."

Printing: `new_quotation`'s save success handler calls `openQuotationModal(data.quotation_no)` automatically (mirrors `openInvoiceModal()` for sales). The quotation pad is a separate modal (`#quotationModal` in `index.html`) with its own element ids (`qp*` prefix) but shares the same `.business-pad-paper`/`.pad-*` CSS classes and the `applyPadBackground()` helper in `app.js`, so header/footer/signature alignment stays identical to the invoice pad.

### Linking a Quotation into Sales Entry

`new_sale`'s field list has an extra `quotation_no` field (`type: "quotation_ref_select"`), rendered as a dropdown populated from `/api/quotation_refs`. Leaving it on `-- No Quotation --` changes nothing (manual entry as before). Selecting one calls `applyQuotationToSale(quotationNo)` in `app.js`, which:
- fetches `/api/quotation/<no>`, sets `buyer_name` (injecting a transient `<option>` if that customer isn't already registered)
- fills `unloading_location` from the quotation's `project_location` (when set) — the quotation names the job site, which is where the goods actually get dropped off
- sets the "Number of Products" count to the quotation's item count and re-renders the line-item rows
- fills each row's product/size/quantity/price from the matching quotation item, injecting a transient inventory option if that product/size isn't currently in stock (`(from quotation — not currently in stock)`)

`quotation_no` is never persisted on the `sales` table (no such column) — it's submitted in the payload but silently dropped by the generic table-column filter in `save_multi_item_entry()`.

### New vs Previous entry mode (Sales & Purchase)

Both `new_sale` and `new_purchase` have a `record_source` field (`type: "select"`, options `["New", "Previous"]`, default `"New"`) rendered as the **first** field in the form. Unlike other fields it's handled specially in `renderEntryForm()`: selecting it sets the global `currentRecordMode` and does a full `renderEntryForm(entryId)` re-render, rather than just updating one input — because switching modes changes which field *types* are used across the whole form.

- **New** (default): behaves exactly as before — inventory/product/customer dropdowns, auto-generated chalan/invoice numbers, inventory updated on save.
- **Previous** (historical backfill): `chalan_no`/`input_invoice_no` becomes editable instead of readonly/auto-generated, and `invoice_ref_select`/`quotation_ref_select` fields become plain text (`effectiveFieldType()` in `app.js`) since there's no *live* transaction to reference during a backfill. Inventory is never touched, regardless of role.
- **Customer and product fields stay linked to their catalogs, not locked to them**: `buyer_name`/`supplier_name` and each line item's `product_type` render as an **editable combobox** (`makeComboInput()` in `app.js` — a plain `<input>` backed by a `<datalist>`) instead of either a strict `<select>` or plain unlinked text. Typing/picking an existing customer still auto-fills contact/address (same `fills_contact_field`/`fills_address_field` callback as New mode); typing a name that isn't in the list is just a normal manual entry, left as-is with nothing auto-filled or blocked. Same pattern for line-item products against `productsCache` (not `inventoryCache` — Previous mode must never depend on live stock), which additionally suggests `size` and `unit_price`/`sale_unit_price` (only filling price if it's still empty/0, never overwriting a value the user already typed).

`currentRecordMode` resets to `"New"` only when navigating to a *different* entry tab (`switchEntryTab()`) — toggling the dropdown itself re-renders the same form without resetting itself.

Backend (`save_multi_item_entry()` in `database.py`): when `shared.record_source` is `"Previous"` (case-insensitive), the row is saved with `record_source = 'Previous'`, `status = 'authorized'` immediately (no admin authorization queue — there's nothing left to gate), and **no inventory/product-catalog side-effects run at all**, regardless of role. `delete_entry()` mirrors this: it checks `record.record_source` before reversing any inventory adjustment, so deleting a Previous row never wrongly subtracts/adds inventory that was never touched in the first place.

### Print / Save (PDF) output

Every printable surface (invoice pad, quotation pad, report table) has **two separate buttons**: **Print** (opens the OS/browser print dialog, unchanged) and **Save** (generates an actual downloadable `.pdf` file client-side via `html2canvas` + `jsPDF`, both loaded from CDN in `index.html` — no server round-trip).

- `saveElementAsPDF(elementId, filenameBase)` — used by the invoice/quotation pads. Forces the `html2canvas` capture to an exact 612:792 (US Letter) pixel ratio via explicit `width`/`height`/`windowWidth`/`windowHeight` options, and the `jsPDF` page `format` to the literal `[612, 792]` point size — not derived from whatever size the captured canvas happens to come out at (see the page-size section below for why).
- `saveReportAsPDF()` — used by the report toolbar. Reuses `buildReportPrintDocument()` (extracted out of `printReportTable()` so both stay visually identical), renders it into a detached, off-screen `<iframe>` (kept style-isolated from the app's own dark theme), rasterizes it with `html2canvas`, then slices the resulting image across as many A4-landscape pages as the table needs (`jsPDF`'s standard `addImage` + track `heightLeft`/loop `addPage()` pagination recipe) before triggering the download.
- The `try`/`catch` around `saveElementAsPDF()`'s capture (falling back to "try Print instead") is a defensive leftover from when the pad image was going to be loaded directly from Drive — since it's now always same-origin (see the `pad_image_proxy` section below), this shouldn't actually trigger for that reason anymore, but is harmless to leave in place for any other capture failure.

`printReportTable()` opens a **new browser window** (unchanged from before) and writes `buildReportPrintDocument()`'s HTML into it, then calls `win.print()`. The main window's `style.css` print block shows `#invoiceModal.active` or `#quotationModal.active` — all other `.modal-overlay` elements are hidden during print to prevent the dark-themed app from leaking into the printout.

### PO-wise Invoice (report_points → `po_invoice_report`)

A third print pad, alongside the per-chalan Sales Invoice and the Quotation letter: one combined invoice across **every chalan a customer has against a single PO Order** — a PO fulfilled over several deliveries shows as one document instead of requiring the customer to reconcile several separate chalan invoices themselves.

- `po_invoice_report` is a **generator, not a data table** — flagged `is_po_invoice_generator: true` in config, which `renderReportView()` checks to swap out the usual report table/search/export/print/summary-bar for a single "Generate Invoice" button (`#poInvoiceGenerateWrap`), reusing the exact same Customer/PO cascading-dropdown infrastructure `sales_report` already has (`supports_customer_filter` + `supports_po_filter`, same `reportCustomerFilter`/`reportPoFilter` elements — the toolbar is shared across all reports, so no new filter UI was needed). `list_report_customer_options()` treats this report_id the same as `sales_report` (buyer-only, not the pooled buyer/supplier/transporter union `customer_transactions_report` uses) since `po_order` only exists on `sales`.
- `GET /api/po_invoice?customer=&po_order=` (`get_po_invoice_data()` in `database.py`) pulls every matching `sales` row ordered by date, and sums `sale_total_price`/`advance`/`due`/`received_quantity` straight across all of them — safe without special per-chalan grouping because `advance`/`due` are already only ever nonzero on the first row of each chalan's multi-item group (the same invariant `list_invoice_refs()`/`customer_dues_report` already lean on), so a plain `SUM()` naturally avoids double-counting.
- `generatePoInvoice()` (`app.js`) populates a **new, separate modal** (`#poInvoiceModal`, `poi*`-prefixed element ids) rather than reusing `#invoiceModal` — its item table needs extra columns (`DATE`, `CHALAN #`, `TRUCK NO`) that the single-chalan invoice doesn't carry, and its totals row adds `TOTAL QUANTITY`. It shares the same `.business-pad-paper`/`.pad-*` CSS classes and `applyPadBackground()` helper as the other two pads (same precedent as the quotation pad), so branding stays identical. Quantity is rendered `<strong>` in the item rows, matching the bold/dark treatment the Amount column already had.
- Like the quotation letter (and unlike the fixed-page single-chalan invoice), this pad is opened with `{ forceTextHeader: true }` and **grows to fit however many rows the PO has** rather than being locked to one physical page — a PO spanning many deliveries can run well past one page. `savePoInvoiceAsPDF()` mirrors `saveQuotationAsPDF()`'s multi-page slicing (not `saveElementAsPDF()`'s fixed-single-page approach) for the same reason.
- **Signature/footer must flow normally, not reuse the fixed-pad's absolute positioning**: the first version copied `#invoiceModal`'s `.pad-signature-row`/`.sig-authorised`/`.sig-received`/`.pad-footer` markup verbatim — those are `position: absolute; bottom: calc(var(--footer-h) + Npx)`, which only works because the invoice pad has a *known, fixed* total height (612:792 aspect-ratio locked). On a growing pad, "bottom" is measured from wherever the flow content happens to end, not from any physical page boundary, so the signature/footer drifted out of alignment with the actual last row — worse the more chalans a PO had (reported as "alignment needs correction on the last page end"). Fixed the same way the quotation pad already solves this (`#qpFooterNote { position: static; }`): new `.poi-signature-row`/`.poi-sig-authorised`/`.poi-sig-received`/`.poi-footer` classes in normal document flow (no `position: absolute`), so they always sit directly after the totals row regardless of row count. Verified: with `max-height`/`overflow` reset (the same override `savePoInvoiceAsPDF()` applies before capture), the footer's bottom edge now lands exactly at the pad's true content height with zero gap, for a 74-row test invoice.
- `dateFilterWrap` (`index.html`) was factored out of the shared `#periodFilter` toolbar block so this report can hide the (meaningless here) From/To date inputs while still showing `#periodFilter`'s nested Customer/PO dropdowns — `renderReportView()` toggles it directly off `is_po_invoice_generator`, independent of `supports_period`.

### Business pad alignment (invoice + quotation pads)

Both print pads share `applyPadBackground()` (`app.js`) so their header/footer/signature positioning stays identical:
- **No border**: `.invoice-modal-container` and `.business-pad-paper` are explicitly `border: none` (also reinforced with `!important` inside `@media print`) — there is no framing rectangle around the pad on-screen or in output.
- **Footer padding**: letterhead settings gained `footer_height_px` (default 110, alongside the existing `header_height_px`) — `paddingBottom` is set to this when `use_pad_image` is on, so invoice/quotation content (signature row, footer note) doesn't run into the pre-printed pad's bottom address bars. Configurable in Business Pad Setup.
- **Page size locked to US Letter**: the client's real pre-printed pad was confirmed (via `pypdf` reading their reference PDF's actual `MediaBox`) to be exactly 612×792pt / 8.5×11in — US Letter, not A4. `PAD_PAGE_WIDTH_PT`/`PAD_PAGE_HEIGHT_PT` constants in `app.js` hold this, and `applyPadBackground()` sets `padPaper.style.aspectRatio` to that fixed ratio for every pad — **not** derived from the uploaded photo's own pixel dimensions (an earlier attempt did that; a phone photo's own crop proportions aren't necessarily identical to the true paper size, which was part of what caused misalignment). A matching top-level `@page { size: 8.5in 11in; margin: 0; }` rule in `style.css` locks the browser's own Print dialog to the same size (previously it fell back to the OS/browser default, often A4 outside the US).
- **max-height/scrollbar trap**: `.invoice-modal-container` is normally capped to `max-height: 90vh` (with `overflow-y: auto` on the pad itself) so the modal fits a small screen. Left in place during print/export, that cap silently compresses the pad below its true aspect ratio, and the resulting scrollbar gets rasterized right into the captured image as a stray border-looking line. Both `@media print` and `saveElementAsPDF()` explicitly reset `max-height`/`overflow` before rendering (the latter saves/restores the inline styles it touches, so the on-screen modal is unaffected afterward).
- **`aspect-ratio` isn't reliably respected by html2canvas's internal clone**: confirmed by testing — the live on-screen DOM measured the pad at the correct height after the max-height override above, but the *captured canvas* still came out shorter, crowding the totals box down into the signature row (visible as "Grand Total" overlapping "Authorised Signature" in the exported PDF). `saveElementAsPDF()` now also sets an **explicit pixel height** (`el.style.height = captureHeightPx + 'px'`, saved/restored like the other overrides) right before calling `html2canvas()` — this removes the ambiguity entirely and is what actually fixed it. Print is unaffected (it never used html2canvas, `aspect-ratio` renders correctly there).
- **Fixed-height page has much less vertical slack than the old auto-growing one**: since `.business-pad-paper` is now a *fixed* 612:792 box instead of growing to fit content, the original spacing (large margins on `.pad-meta-row`/`.pad-table`/`.pad-totals-row`, wide gaps in the signature `bottom` offsets) ate into that fixed budget and caused the overlap above — spacing throughout was tightened accordingly, and the sig-box/`.pad-footer` `bottom` offsets were reduced. If a future invoice with many line items runs out of room again, tighten `.pad-table td`/`th` padding further before touching the signature positions.
- **`.pad-footer` depends on `.pad-signature-row` for nothing anymore**: it's now `position: absolute` too (anchored via the same `--footer-h` pattern), because it used to rely on flowing directly after `.pad-signature-row` in the DOM — but that row's children became `position: absolute` (see above), so the row itself contributes **zero height** to the flow, and `.pad-footer` was collapsing up to sit right after the totals box instead of near the bottom of the page.
- **Signature positioning**: "Authorised Signature" (`.sig-authorised`) and "Received Signature" (`.sig-received`) are **independently absolutely-positioned** (not a shared flex row anymore — that was causing them to stack instead of sit apart) inside `.business-pad-paper` (now `position: relative`). Authorised sits bottom-left, roughly under where the pad's own pre-printed signature block is; Received sits pinned to the bottom-right corner. Both are anchored via `bottom: calc(var(--footer-h, 110px) + Npx)`, where `--footer-h` is set inline in `applyPadBackground()` from the configured `footer_height_px`, so they track that setting if it's adjusted. Current offsets (`style.css`): `left: 60px; bottom: calc(var(--footer-h) + 55px)` for Authorised, `right: 40px; bottom: calc(var(--footer-h) + 35px)` for Received — these were tightened down from an earlier, larger pair of offsets that let "Grand Total" overlap "Authorised Signature" on short invoices (see the fixed-height-page point above); nudge them in `style.css` if they still don't land exactly right on the real printed pad.

## Google Drive integration (challan uploads + letterhead pad image)

Two features push files to a **shared Google Drive folder** using OAuth as the business owner's own Google account — **not a service account**. A service account was tried first and rejected by Google at upload time with `403 storageQuotaExceeded: Service Accounts do not have storage quota` — service accounts have no Drive storage of their own and can't borrow a personal account's quota either; that's only possible inside a paid Google Workspace "Shared Drive." OAuth as the real account sidesteps this since the app uploads with the actual account's own quota. See `GOOGLE_DRIVE_SETUP.md` for the full one-time setup walkthrough (OAuth consent screen, OAuth client, and a one-time browser sign-in via `authorize_google_drive.py`).

- Config: `config.json → google_drive` = `{"oauth_client_secret_path": ..., "oauth_token_path": ..., "challans_folder_id": ...}` (server-side only, never exposed via `/api/config`, same pattern as `database_config`). Both features reuse the same one configured folder.
- **Scope is deliberately narrow**: `https://www.googleapis.com/auth/drive.file` (can only see/manage files the app itself created) — this is a non-sensitive scope that doesn't require Google's app-verification review, unlike full Drive access.
- `authorize_google_drive.py` (project root) — a standalone one-time script (`python authorize_google_drive.py`) that runs `InstalledAppFlow.run_local_server()`, opens the browser for the owner to sign in and approve, and saves the resulting token to `oauth_token_path` (default `drive_token.json`). This is the **only manual step** — everything after that is silent; `google_drive.py`'s `_get_drive_service()` auto-refreshes the access token from the saved refresh token and rewrites the token file when it does.
- `google_drive.py` — `upload_file_to_drive(file_bytes, filename, mime_type, make_public=False)` is the shared primitive; `upload_challan_to_drive()` and `upload_letterhead_pad_image()` are thin wrappers over it. Imports of `google-api-python-client`/`google-auth`/`google-auth-oauthlib` are lazy (inside the function) so a missing install doesn't break app startup, only the upload call. Raises `ValueError` with actionable setup instructions (which script to run) if the token file, client secret, or folder ID is missing.
- `service_account.json` may still exist in the project folder as a leftover from the earlier (non-working) approach — it's unused and harmless, still gitignored.

**Sales Report → Upload Challan** (`promptChallanUpload()` in `app.js`, `POST /api/sales/<chalan_no>/challan`):
- Files are named `{chalan_no}_{buyer_name}_{sale_date}.{ext}` and all land in the shared folder (not per-invoice subfolders). Uploaded with `make_public=False` — the folder is already shared with the business owner's own Google account (they created it), so a plain `webViewLink` is enough.
- `database.py → save_challan_upload()` upserts into `challan_uploads` keyed by `(client_id, chalan_no)` — a chalan is one physical document even though a multi-product sale spreads it across several `sales` rows, so the attachment lives in its own table rather than being duplicated onto every line item.
- `sales_report`'s query pulls the link back in via a correlated subquery (same pattern as `transport_cost`): `(SELECT drive_view_url FROM challan_uploads WHERE chalan_no = sales.chalan_no AND client_id = :client_id) as challan_file_url`. The generic report table renderer (`loadReportData()`) auto-links any cell value starting with `http` as a **View File** anchor.

**Business Pad Setup → pad image** (`POST /api/letterhead/pad_image`):
- **The full image is never stored in the Aiven database** — only the Drive **file_id** (a short string, not even a full URL) goes into `letterhead_settings.pad_image`. This replaced the old behavior of storing the entire image as base64 text (up to 8MB) directly in that MySQL column, specifically to save Aiven storage.
- **The browser never loads this image directly from Drive.** An earlier attempt returned Drive's direct-content URL (`drive.google.com/uc?export=view&id=...`, granted via `make_public=True`) and used it straight as a CSS `background-image` — this silently failed to render: Google sends `Cross-Origin-Resource-Policy: same-site` on that response, which browsers enforce to block exactly this kind of cross-site embedding (confirmed by testing — the URL opens fine as a full-page navigation, but fails as an `<img>`/background-image on any other origin, ours included). This is unrelated to OAuth vs service account; it's just how Google serves that endpoint.
- **Fix**: `GET /api/letterhead/pad_image_proxy?id=<file_id>` (in `PUBLIC_PATHS` — no Bearer token, since a CSS `background-image: url()` can't attach one, and a letterhead image isn't sensitive) fetches the bytes server-side via `google_drive.py → download_file_from_drive()` (`files().get_media()` + `MediaIoBaseDownload`) and streams them back through our own origin with `Cache-Control: public, max-age=3600`. Since the browser now only ever talks to our own domain for this image, the CORP header never comes into play. `app.js → padImageSrc()` builds this proxy URL from the stored file_id (a bare value, no `://`) wherever the pad image is displayed; a legacy value that's already a full `data:`/`http` URL is passed through unchanged rather than mangled.
- Frontend flow (`app.js`): picking a file only creates an instant local preview (`URL.createObjectURL()`, never sent anywhere) and stores the raw `File` in `pendingPadImageFile`. The actual upload to Drive happens inside `saveLetterheadSettings()` when the form is submitted — it POSTs the file to `/api/letterhead/pad_image` first, gets back the file_id, then includes that in the normal JSON `/api/letterhead` save alongside the other fields.
- `MAX_PAD_IMAGE_B64_CHARS` in `database.py` is now a defensive fallback only (pad_image should always be a short file_id going forward) — kept in case something still submits a raw base64 string.

## Cloud database (Aiven MySQL)

`config.json → database_config` currently points at a **live Aiven MySQL instance** (`mode: "mysql"`, database `defaultdb`, MySQL 8.4.8). Connection requires SSL:

- `ca.pem` — Aiven's self-signed CA cert, must sit next to `config.json` (referenced via `ssl_ca_path`)
- **Important fix already applied**: connecting via PyMySQL's `ssl={'ca': path}` shortcut fails against Aiven with `CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain`. The working approach (already in `database.py → get_db_connection()`) builds an explicit `ssl.SSLContext` via `ssl.create_default_context(cafile=resolved_ca)` with `check_hostname=False` and `verify_mode=ssl.CERT_REQUIRED`. Don't revert to the dict shortcut.

**⚠️ SENSITIVE**: `config.json` currently contains the **vendor's own live Aiven password in plaintext**. Before shipping to any real client, run `generate_customer_config.py` to produce a customer-specific config pointed at *their* database — do not distribute this repo's `config.json` as-is. Never commit/paste/share this file's `database_config` block.

### Render deployment: config.json needs a manual sync every time its schema changes

`config.json` is gitignored (it holds the live Aiven password) and Render's copy is a **separately-maintained Secret File**, not something `git push` ever touches. This means:
- **Code changes** (`app.py`, `database.py`, `static/*`) deploy automatically on every `git push` via Render's GitHub integration — no manual step.
- **Schema/form changes** (anything under `config.json → tables` / `entry_points` / `report_points`, e.g. adding the `origin`, `record_source`, or `address` columns/fields this project has gone through) do **not** ship with the push — Render keeps serving whatever `entry_points`/`report_points` were last pasted into its Secret File, silently missing the new fields, even though the underlying Python/JS code (and the live Aiven database schema, since local dev already ran the migration against that same shared DB) is already correct. Verify via `curl .../api/config` and check for the new field/column by name if a "did it actually deploy" question comes up.
- **To sync**: copy the current local `config.json`, but do **not** overwrite `google_drive.oauth_client_secret_path`/`oauth_token_path` with the local relative paths (`oauth_client_secret.json`/`drive_token.json`) — Render needs the absolute Secret File mount paths (`/etc/secrets/oauth_client_secret.json`/`/etc/secrets/drive_token.json`) instead. Everything else (`database_config`, `tables`, `entry_points`, `report_points`, `roles`, `letterhead`) transfers as-is since it's the same live database either way.
- **Real incident**: pasting into Render's Secret File editor once produced `json.decoder.JSONDecodeError: Extra data: line 1 column 16 (char 15)` on the next deploy — the paste hadn't fully replaced the box's existing short leftover content, so the parser read a tiny valid JSON fragment followed by "extra data." The app fails to import at all when this happens (`init_db()` runs at module load time in `app.py`), so **every** route 500s, including static ones like `/` that don't touch the DB — that symptom (even `/` failing) is the tell that it's a config-parse crash, not a runtime/data bug. Fix: in the Secret File editor, click the box, **Ctrl+A then Delete** to confirm it's fully empty before pasting the new content fresh.

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

## Multi-item transaction workflow

A single Sales or Purchase transaction can now include multiple product line items, all sharing one chalan_no/input_invoice_no:

1. **Frontend form flow**: User opens Sales Entry / Purchase Entry → sets "Number of Products" (default 1) → N repeatable rows render with product dropdowns and quantity/price inputs → user fills all rows → form auto-calculates running total per row and grand total across all
2. **Submission**: `handleFormSubmit()` detects line items and sends `POST /api/entry/<entry_id>/multi` with `{ shared: {buyer_name, ...}, line_items: [{product_type, size, ...}, ...] }`
3. **Backend processing**: `save_multi_item_entry()` inserts N rows to the DB, all sharing one chalan_no. Inventory & cost calculations apply per row.
4. **Invoice rendering**: when user opens the invoice modal, all rows are rendered as a table; totals are summed across all items.
5. **Reporting**: each row appears as a separate line in transaction reports, but they share the same chalan_no/invoice_no for grouping.

**Key invariant**: the full advance/due from the form is attributed to the first inserted row; subsequent rows carry 0/0 advance/due. This ensures that when customer reports aggregate by invoice number, the total advance/due is correct without double-counting. The individual row records still exist for full audit trail.

## Known state / open items

- No connection pooling for MySQL (each request opens/closes a connection via `get_db_connection()`).
- No license-key / anti-piracy mechanism on the exe.
- `jahan_trading.db` in the project root is a local SQLite leftover from earlier local-mode testing; irrelevant while `mode: mysql` is active.
- Flask dev server (`app.run(debug=False)`) is used directly — fine for a single-client desktop-style exe, not hardened for concurrent/public use.
- `app.py` auto-opens the user's default browser 1.2s after the server starts (`threading.Timer` → `webbrowser.open_new`).
- Google Drive integration (challan uploads + letterhead pad image) requires the one-time `python authorize_google_drive.py` sign-in (see `GOOGLE_DRIVE_SETUP.md`) before it works; until then, both the Upload Challan button and saving a new pad image fail with a clear "not authorized yet" message instead of erroring obscurely.
- `list_products()` previously omitted the `origin` column entirely (a pre-existing bug, unrelated to whoever added the column) — fixed during the quotations work since the quotation line-item auto-fill depends on it.

## Schema migration pattern

New columns are added to live DBs automatically via `_migrate_missing_columns()` in `database.py` — it runs `ALTER TABLE ... ADD COLUMN` for any column in `config.json → tables` that is missing from the live schema. No manual DB migration is ever needed; just add the column to config and restart. Columns added in the last major sessions: `unloading_location` (purchases), `loading_location` (sales), `from_location`/`to_location` (transporters), `origin` (products), `record_source` (sales, purchases), `unit_rate_per_ton` (transporters), `project_location` (quotations), `unloading_cost_per_unit`/`unloading_cost` (sales). The `payments`/`payment_allocations` tables are new-table additions (not column additions to an existing table), so they're created by `init_db()`'s normal `CREATE TABLE IF NOT EXISTS` pass, same as any other config-defined table — no special migration needed either way. The `letterhead_settings` table (not config-driven — see below) gets its own small ad-hoc migration in `_ensure_letterhead_table()` for the same reason (`footer_height_px` added this session).

## Full session history

See `CHAT_SUMMARY.txt` in this folder for the detailed narrative (SSL debugging, security fixes, build troubleshooting) if deeper historical context is ever needed — this file is meant to replace the need to re-read it or the source files from scratch.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
