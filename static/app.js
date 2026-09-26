let systemConfig = null;
let currentClientId = "CLI-001";
let currentTab = "dashboard";
let currentEntryId = null;
let currentReportId = null;
let currentReportRawData = [];
let currentReportColumns = [];
let currentReportKeys = [];

let currentUser = null;
let currentPermissions = null;
let authToken = null;

// Lookup caches (per client)
let productsCache = [];
let inventoryCache = [];
let customersByTypeCache = {};

document.addEventListener("DOMContentLoaded", () => { initApp(); });

// ---------------- MOBILE SIDEBAR ----------------
function toggleMobileSidebar() {
  document.getElementById("appSidebar").classList.toggle("mobile-open");
  document.getElementById("sidebarBackdrop").classList.toggle("active");
}

function closeMobileSidebar() {
  document.getElementById("appSidebar").classList.remove("mobile-open");
  document.getElementById("sidebarBackdrop").classList.remove("active");
}

document.querySelector(".nav-menu")?.addEventListener("click", (e) => {
  if (e.target.closest(".nav-item")) closeMobileSidebar();
});

// Every API call except /api/config and /api/login requires this app's
// session token — attach it here so none of the ~20 call sites below need
// to remember to do so individually.
async function apiFetch(url, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (authToken) {
    opts.headers["Authorization"] = `Bearer ${authToken}`;
  }
  return fetch(url, opts);
}

async function initApp() {
  try {
    const res = await apiFetch("/api/config");
    systemConfig = await res.json();

    document.getElementById("brandAppName").innerText = systemConfig.system.app_name || "JAHAN TRADING";
    const dbMode = (systemConfig.database_config && systemConfig.database_config.mode) || "sqlite";
    document.getElementById("dbModeStatus").innerText = dbMode.toUpperCase() === "MYSQL" ? "MySQL Connected" : "SQLite Connected";

    populateLetterheadForm();
  } catch (err) {
    console.error("Failed to initialize app config:", err);
  }
}

// ---------------- LOGIN ----------------
async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;
  const clientId = document.getElementById("loginClientId").value;

  try {
    const res = await apiFetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.status === "success") {
      currentUser = data.user;
      currentPermissions = data.role_permissions;
      authToken = data.token;
      currentClientId = clientId;

      document.getElementById("activeUserBadge").innerText = `${currentUser.full_name} (${currentUser.username})`;
      document.getElementById("clientIdSelect").value = currentClientId;
      document.getElementById("loginScreen").style.display = "none";

      await refreshLookups();
      buildDynamicNavigation();
      loadDashboard();
    } else {
      alert("Login Failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

function handleLogout() {
  if (authToken) {
    apiFetch("/api/logout", { method: "POST" }).catch(() => {});
  }
  currentUser = null;
  currentPermissions = null;
  authToken = null;
  document.getElementById("loginScreen").style.display = "flex";
}

async function switchClientProfile(newClientId) {
  currentClientId = newClientId;
  await refreshLookups();
  if (currentTab === "dashboard") loadDashboard();
  else if (currentTab === "entry-form" && currentEntryId) renderEntryForm(currentEntryId);
  else if (currentTab === "report-view" && currentReportId) renderReportView(currentReportId);
}

async function refreshLookups() {
  try {
    const [pRes, iRes] = await Promise.all([
      apiFetch(`/api/products?client_id=${currentClientId}`),
      apiFetch(`/api/inventory?client_id=${currentClientId}`)
    ]);
    productsCache = await pRes.json();
    inventoryCache = await iRes.json();
    customersByTypeCache = {};
  } catch (err) {
    console.error("Lookup refresh failed:", err);
  }
}

async function getCustomersByType(customerType) {
  if (customersByTypeCache[customerType]) return customersByTypeCache[customerType];
  try {
    const res = await apiFetch(`/api/customers?client_id=${currentClientId}&type=${encodeURIComponent(customerType)}`);
    const list = await res.json();
    customersByTypeCache[customerType] = list;
    return list;
  } catch (err) {
    console.error("Failed to load customers:", err);
    return [];
  }
}

// ---------------- NAVIGATION ----------------
function buildDynamicNavigation() {
  const entryNav = document.getElementById("dynamicEntryNav");
  const reportNav = document.getElementById("dynamicReportNav");
  entryNav.innerHTML = "";
  reportNav.innerHTML = "";

  const allowedEntries = currentPermissions ? currentPermissions.allowed_entry_points : ["*"];
  const allowedReports = currentPermissions ? currentPermissions.allowed_report_points : ["*"];

  systemConfig.entry_points.forEach(ep => {
    if (allowedEntries.includes("*") || allowedEntries.includes(ep.id)) {
      const a = document.createElement("a");
      a.href = "#"; a.className = "nav-item";
      a.setAttribute("data-tab", `entry-${ep.id}`);
      a.onclick = (e) => { e.preventDefault(); switchEntryTab(ep.id); };
      a.innerHTML = `<i class="fa-solid ${ep.icon || 'fa-plus'}"></i><span>${ep.title}</span>`;
      entryNav.appendChild(a);
    }
  });

  systemConfig.report_points.forEach(rp => {
    if (allowedReports.includes("*") || allowedReports.includes(rp.id)) {
      const a = document.createElement("a");
      a.href = "#"; a.className = "nav-item";
      a.setAttribute("data-tab", `report-${rp.id}`);
      a.onclick = (e) => { e.preventDefault(); switchReportTab(rp.id); };
      a.innerHTML = `<i class="fa-solid ${rp.icon || 'fa-table'}"></i><span>${rp.title}</span>`;
      reportNav.appendChild(a);
    }
  });

  const canManage = currentPermissions && currentPermissions.can_manage_users;
  document.getElementById("adminNavTitle").style.display = canManage ? "block" : "none";
  document.getElementById("adminNavMenu").style.display = canManage ? "block" : "none";

  const canAuthorize = currentPermissions && currentPermissions.can_authorize;
  const authNavItem = document.getElementById("pendingAuthNavItem");
  if (authNavItem) authNavItem.style.display = canAuthorize ? "flex" : "none";
}

function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-view").forEach(el => el.classList.remove("active"));

  if (tabId === "dashboard") {
    document.querySelector('.nav-item[data-tab="dashboard"]').classList.add("active");
    document.getElementById("tab-dashboard").classList.add("active");
    document.getElementById("pageTitle").innerText = "Dashboard Overview";
    document.getElementById("pageSubtitle").innerText = "Real-time business performance metrics.";
    loadDashboard();
  } else if (tabId === "user-management") {
    document.querySelector('.nav-item[data-tab="user-management"]')?.classList.add("active");
    document.getElementById("tab-user-management").classList.add("active");
    document.getElementById("pageTitle").innerText = "User & Password Setup";
    document.getElementById("pageSubtitle").innerText = "Create employee login accounts and assign access roles.";
    loadUsersList();
  } else if (tabId === "letterhead-settings") {
    document.querySelector('.nav-item[data-tab="letterhead-settings"]')?.classList.add("active");
    document.getElementById("tab-letterhead-settings").classList.add("active");
    document.getElementById("pageTitle").innerText = "Business Pad Setup";
    document.getElementById("pageSubtitle").innerText = "Configure company letterhead branding.";
  } else if (tabId === "pending-authorizations") {
    document.querySelector('.nav-item[data-tab="pending-authorizations"]')?.classList.add("active");
    document.getElementById("tab-pending-authorizations").classList.add("active");
    document.getElementById("pageTitle").innerText = "Pending Authorizations";
    document.getElementById("pageSubtitle").innerText = "Review and authorize sales & purchase transactions submitted by employees.";
    loadPendingAuthorizations();
  }
}

function switchEntryTab(entryId) {
  currentTab = "entry-form";
  currentEntryId = entryId;
  currentRecordMode = "New";
  modifyTargetRef = null;
  paymentEditId = null;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelector(`.nav-item[data-tab="entry-${entryId}"]`)?.classList.add("active");
  document.querySelectorAll(".tab-view").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-entry-form").classList.add("active");
  renderEntryForm(entryId);
}

function switchReportTab(reportId) {
  currentTab = "report-view";
  currentReportId = reportId;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelector(`.nav-item[data-tab="report-${reportId}"]`)?.classList.add("active");
  document.querySelectorAll(".tab-view").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-report-view").classList.add("active");
  renderReportView(reportId);
}

// ---------------- DASHBOARD ----------------
async function loadDashboard() {
  try {
    const res = await apiFetch(`/api/dashboard?client_id=${currentClientId}`);
    const data = await res.json();
    const curr = data.currency || "BDT";
    const fmt = n => `${curr} ${(n||0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    document.getElementById("kpiRevenue").innerText = fmt(data.total_revenue);
    document.getElementById("kpiSalesCount").innerText = data.total_sales_count;
    document.getElementById("kpiPurchases").innerText = fmt(data.total_purchases);
    document.getElementById("kpiInventory").innerText = fmt(data.inventory_valuation);
    document.getElementById("kpiLowStock").innerText = `${data.low_stock_count} Items`;
    document.getElementById("kpiReceivable").innerText = fmt(data.total_receivable);
    document.getElementById("kpiPayable").innerText = fmt(data.total_payable);

    renderSVGChart(data);
    renderRecentSalesTable(data.recent_sales);
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

function renderSVGChart(data) {
  const rev = Math.max(1, data.total_revenue || 1);
  const pur = Math.max(1, data.total_purchases || 1);
  const inv = Math.max(1, data.inventory_valuation || 1);
  const max = Math.max(rev, pur, inv);
  const scale = v => 180 - (v / max) * 140;
  const container = document.getElementById("svgChartContainer");
  container.innerHTML = `
    <svg width="100%" height="220" viewBox="0 0 500 220" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="40" x2="500" y2="40" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4"/>
      <line x1="0" y1="110" x2="500" y2="110" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4"/>
      <line x1="0" y1="180" x2="500" y2="180" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4"/>
      <rect x="80"  y="${scale(rev)}" width="70" height="${180-scale(rev)}" fill="#10b981" rx="6"/>
      <rect x="215" y="${scale(pur)}" width="70" height="${180-scale(pur)}" fill="#06b6d4" rx="6"/>
      <rect x="350" y="${scale(inv)}" width="70" height="${180-scale(inv)}" fill="#6366f1" rx="6"/>
      <text x="115" y="205" fill="#9ca3af" text-anchor="middle" font-size="11">Sales</text>
      <text x="250" y="205" fill="#9ca3af" text-anchor="middle" font-size="11">Purchases</text>
      <text x="385" y="205" fill="#9ca3af" text-anchor="middle" font-size="11">Stock Value</text>
    </svg>
  `;
}

function renderRecentSalesTable(sales) {
  const tbody = document.querySelector("#recentSalesTable tbody");
  tbody.innerHTML = "";
  if (!sales || sales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No sales recorded yet.</td></tr>`;
    return;
  }
  sales.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${s.chalan_no}</strong></td>
      <td>${s.sale_date}</td>
      <td>${s.buyer_name}</td>
      <td>${s.product_type}${s.size ? ' (' + s.size + ')' : ''}</td>
      <td>BDT ${parseFloat(s.sale_total_price).toFixed(2)}</td>
      <td>${parseFloat(s.due||0) > 0 ? '<span class="status-badge pending">BDT '+parseFloat(s.due).toFixed(2)+'</span>' : '<span class="status-badge paid">Cleared</span>'}</td>
      <td>
        <button class="btn btn-secondary" style="padding:4px 10px; font-size:11px;" onclick="openInvoiceModal('${s.chalan_no}')">
          <i class="fa-solid fa-print"></i> Invoice
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------- USER MGMT ----------------
async function handleCreateUser(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById("nuUsername").value,
    password: document.getElementById("nuPassword").value,
    full_name: document.getElementById("nuFullName").value,
    role: document.getElementById("nuRole").value,
    client_id: document.getElementById("nuClientId").value,
    requested_by: currentUser ? currentUser.username : null
  };
  try {
    const res = await apiFetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === "success") {
      alert(`User Account '${payload.username}' created successfully!`);
      document.getElementById("newUserForm").reset();
      loadUsersList();
    } else {
      alert("Failed to create user: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

async function loadUsersList() {
  try {
    const res = await apiFetch(`/api/users?requested_by=${encodeURIComponent(currentUser ? currentUser.username : "")}`);
    const users = await res.json();
    const tbody = document.querySelector("#usersTable tbody");
    tbody.innerHTML = "";
    const canDelete = currentPermissions && currentPermissions.can_delete;
    if (!users || users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No users found.</td></tr>`;
      return;
    }
    users.forEach(u => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.id}</td>
        <td><strong>${u.username}</strong></td>
        <td>${u.full_name}</td>
        <td><span class="badge">${u.role}</span></td>
        <td>${u.client_id}</td>
        <td><span class="status-badge ${u.is_active ? 'paid' : 'pending'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openEditUserModal(${u.id}, '${u.username}')"><i class="fa-solid fa-user-pen"></i> Edit</button>
          ${canDelete ? `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; color:var(--accent-rose);" onclick="deleteUser(${u.id})"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading users list:", err);
  }
}

let editUserTargetId = null;

function openEditUserModal(userId, currentUsername) {
  editUserTargetId = userId;
  document.getElementById("euUsername").value = currentUsername;
  document.getElementById("euPassword").value = "";
  document.getElementById("editUserModal").classList.add("active");
}

function closeEditUserModal() {
  document.getElementById("editUserModal").classList.remove("active");
  editUserTargetId = null;
}

async function submitEditUser() {
  const username = document.getElementById("euUsername").value.trim();
  const password = document.getElementById("euPassword").value;
  if (!username) { alert("Username cannot be empty."); return; }
  try {
    const res = await apiFetch(`/api/users/${editUserTargetId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.status === "success") {
      closeEditUserModal();
      loadUsersList();
    } else {
      alert("Update failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

async function deleteUser(userId) {
  if (!confirm("Delete this user account? This cannot be undone.")) return;
  try {
    const res = await apiFetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requested_by: currentUser ? currentUser.username : null })
    });
    const data = await res.json();
    if (data.status === "success") {
      loadUsersList();
    } else {
      alert("Delete failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

// ---------------- ENTRY FORM ----------------
// Sales/purchases/quotations can carry multiple product line items sharing
// one chalan_no / input_invoice_no / quotation_no. These field names are
// rendered inside the repeatable line-item rows instead of the normal
// one-per-form loop.
const MULTI_ITEM_FIELDS = {
  new_sale: ['product_type', 'size', 'cost_price', 'received_quantity', 'sale_unit_price', 'unloading_cost_per_unit'],
  new_purchase: ['product_type', 'size', 'unit_price', 'quantity'],
  new_quotation: ['product_type', 'size', 'origin', 'unit_price', 'quantity'],
  new_purchase_order: ['product_type', 'size', 'unit_price', 'quantity']
};

// New/Previous entry mode for Sales & Purchase — "Previous" is a manual
// historical-backfill mode (see record_source field): nothing touches
// inventory on save, and there's no *live* transaction (chalan/quotation)
// to reference, but customer and product details stay linked to their
// catalogs — see buildCustomerComboInput()/buildProductComboInput() below.
// Reset whenever the user navigates to a different entry tab
// (switchEntryTab), not on every re-render, since toggling the dropdown
// itself triggers a re-render and must not stomp on itself.
let currentRecordMode = "New";

// "Modify" (admin-only) loads an existing Sales/Purchase transaction or
// Customer record for in-place editing — see buildModifyRefSelectGroup()/
// loadRecordForModify()/loadCustomerForModify() below. Holds the reference
// number (chalan_no/input_invoice_no) or customer id currently loaded, so
// handleFormSubmit() knows which existing record to update; cleared
// whenever the mode changes or the tab is switched.
let modifyTargetRef = null;

// Set by the Payment/Receipt report's Edit button to load an existing
// payment back into the entry form for editing; null means the form is
// creating a brand new payment. Cleared on save/cancel/tab switch.
let paymentEditId = null;

// Widget choice only — Previous (never touches inventory) and Modify
// (edits a real transaction's inventory effect server-side) both render
// manual/catalog-linked fields instead of live stock-locked dropdowns,
// since neither has a *new* live pick to make from current stock.
function usesManualWidgets(entryId) {
  return (currentRecordMode === "Previous" || currentRecordMode === "Modify") &&
    (entryId === "new_sale" || entryId === "new_purchase");
}

function effectiveFieldType(f, entryId) {
  if (!usesManualWidgets(entryId)) {
    return f.type;
  }
  // customer_select stays linked to the customer catalog even in Previous/
  // Modify mode (rendered as an editable combobox, see the customer_select
  // branch below) — only reference-number lookups tied to a *live*
  // transaction (an existing chalan/quotation) get downgraded, since
  // there's nothing live to reference during a historical backfill or edit.
  if (["invoice_ref_select", "quotation_ref_select", "purchase_order_ref_select", "purchase_invoice_ref_select"].includes(f.type)) {
    return "text";
  }
  return f.type;
}

// Builds an editable combobox: a plain <input> backed by a <datalist> of
// suggestions, so the user can either pick an existing customer/product
// (which fires onMatch with its full record) or type a name that isn't in
// the list at all (onMatch fires with null) — this is what lets Previous
// mode stay linked to the customer/product catalogs while still allowing
// fully manual entry for a customer or product no longer/never registered.
// Returns {input, datalist} — caller must append both to the DOM (the
// datalist renders nothing itself, but must be present for `list=` to work).
function makeComboInput(items, getValue, getLabel, onMatch) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control";
  input.autocomplete = "off";

  const datalist = document.createElement("datalist");
  datalist.id = `combo_${Math.random().toString(36).slice(2)}`;
  input.setAttribute("list", datalist.id);

  // First occurrence wins on duplicate values (e.g. same product name in
  // different sizes) — matches the datalist's own first-listed option,
  // so picking "the first BLACKSTONE(GABRO)" resolves to the same record
  // whether the user reads it off the suggestion list or the lookup below.
  const byValue = {};
  items.forEach(item => {
    const val = getValue(item);
    if (!(val in byValue)) byValue[val] = item;
    const o = document.createElement("option");
    o.value = val;
    if (getLabel) o.label = getLabel(item);
    datalist.appendChild(o);
  });

  if (onMatch) {
    input.addEventListener("input", () => onMatch(byValue[input.value] || null));
  }
  return { input, datalist };
}

async function renderEntryForm(entryId) {
  const ep = systemConfig.entry_points.find(x => x.id === entryId);
  if (!ep) return;

  document.getElementById("pageTitle").innerText = ep.title;
  document.getElementById("pageSubtitle").innerText = `Enter details to store into table '${ep.table}'.`;
  document.getElementById("entryFormTitle").innerHTML = `<i class="fa-solid ${ep.icon || 'fa-pen'}"></i> ${ep.title}`;
  document.getElementById("entryFormTable").innerText = `Table: ${ep.table}`;

  if (entryId === "new_payment") {
    await renderPaymentEntryForm();
    return;
  }

  // Refresh lookups so dropdowns are current
  await refreshLookups();

  const container = document.getElementById("formFieldsContainer");
  container.innerHTML = "";

  if (entryId === "new_purchase_order") {
    const infoBanner = document.createElement("div");
    infoBanner.className = "form-group col-12";
    infoBanner.innerHTML = `
      <div style="padding:10px 14px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:8px; font-size:13px;">
        Contact Person: <strong>Mr. Saidul Islam</strong> &nbsp;|&nbsp; Mobile: <strong>01830983633</strong>
      </div>
    `;
    container.appendChild(infoBanner);
  }

  const lineItemFieldNames = MULTI_ITEM_FIELDS[entryId] || [];

  for (const f of ep.fields) {
    if (lineItemFieldNames.includes(f.name)) continue;

    const group = document.createElement("div");
    group.className = "form-group col-6";
    const label = document.createElement("label");
    label.innerText = f.label + (f.required ? " *" : "");
    group.appendChild(label);

    const effType = effectiveFieldType(f, entryId);
    let input;
    let pendingDatalist = null;
    if (f.name === "record_source" || f.name === "entry_mode") {
      input = document.createElement("select");
      input.className = "form-control";
      const isAdmin = currentUser && currentUser.role === "admin";
      f.options.forEach(opt => {
        // "Modify" edits an existing record in place — admin-only, same as
        // every other edit/delete action in this app, so non-admins never
        // even see the option (rather than picking it and hitting a 403).
        if (opt === "Modify" && !isAdmin) return;
        const o = document.createElement("option");
        o.value = opt; o.innerText = opt;
        input.appendChild(o);
      });
      input.value = currentRecordMode;
      input.onchange = () => {
        currentRecordMode = input.value;
        modifyTargetRef = null;
        renderEntryForm(entryId);
      };
    } else if ((f.name === "chalan_no" || f.name === "input_invoice_no") && currentRecordMode === "Modify") {
      // Modify mode: the ref field becomes a picker for an existing record
      // instead of an auto-generated/readonly value — selecting one loads
      // the whole transaction (shared fields + line items) for editing.
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- Select record to modify --</option>`;
      populateModifyRefSelect(entryId, input);
      input.onchange = () => loadRecordForModify(entryId, input.value);
    } else if (effType === "quotation_ref_select") {
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- No Quotation (manual entry) --</option>`;
      (async () => {
        try {
          const r = await apiFetch(`/api/quotation_refs?client_id=${currentClientId}`);
          const refs = await r.json();
          refs.forEach(ref => {
            const o = document.createElement("option");
            o.value = ref.quotation_no;
            o.innerText = `${ref.quotation_no} — ${ref.customer_name}`;
            input.appendChild(o);
          });
        } catch (e) { /* ignore */ }
      })();
      input.onchange = () => applyQuotationToSale(input.value);
    } else if (effType === "purchase_order_ref_select") {
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- No Purchase Order (manual entry) --</option>`;
      (async () => {
        try {
          const r = await apiFetch(`/api/purchase_order_refs?client_id=${currentClientId}`);
          const refs = await r.json();
          refs.forEach(ref => {
            const o = document.createElement("option");
            o.value = ref.purchase_order_no;
            o.innerText = `${ref.purchase_order_no} — ${ref.supplier_name}`;
            input.appendChild(o);
          });
        } catch (e) { /* ignore */ }
      })();
      input.onchange = () => applyPurchaseOrderToPurchase(input.value);
    } else if (effType === "purchase_invoice_ref_select") {
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- No Purchase Invoice (manual entry) --</option>`;
      (async () => {
        try {
          const r = await apiFetch(`/api/purchase_invoice_refs?client_id=${currentClientId}`);
          const refs = await r.json();
          refs.forEach(ref => {
            const o = document.createElement("option");
            o.value = ref.input_invoice_no;
            o.innerText = `${ref.input_invoice_no} — ${ref.supplier_name}`;
            input.appendChild(o);
          });
        } catch (e) { /* ignore */ }
      })();
      input.onchange = () => applyPurchaseInvoiceToSale(input.value);
    } else if (effType === "select") {
      input = document.createElement("select");
      input.className = "form-control";
      f.options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt; o.innerText = opt;
        input.appendChild(o);
      });
    } else if (effType === "product_select") {
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- Select Product --</option>`;
      productsCache.forEach(p => {
        const o = document.createElement("option");
        o.value = p.product_type;
        o.dataset.size = p.size;
        o.dataset.price = p.unit_price;
        o.innerText = `${p.product_type} — ${p.size} (BDT ${parseFloat(p.unit_price).toFixed(2)})`;
        input.appendChild(o);
      });
      input.onchange = () => {
        const opt = input.options[input.selectedIndex];
        const sizeEl = document.getElementById("input_size");
        const priceEl = document.getElementById("input_unit_price");
        if (sizeEl) sizeEl.value = opt.dataset.size || "";
        if (priceEl && opt.dataset.price) priceEl.value = opt.dataset.price;
        calculatePurchaseTotal();
      };
    } else if (effType === "inventory_select") {
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- Select from Inventory --</option>`;
      inventoryCache.forEach(item => {
        if ((item.quantity || 0) <= 0) return;
        const o = document.createElement("option");
        o.value = item.product_type;
        o.dataset.size = item.size;
        o.dataset.cost = item.cost_price;
        o.dataset.stock = item.quantity;
        o.innerText = `${item.product_type} — ${item.size} (Stock: ${item.quantity}, Cost: BDT ${parseFloat(item.cost_price).toFixed(2)})`;
        input.appendChild(o);
      });
      if (inventoryCache.length === 0 || inventoryCache.every(i => (i.quantity||0) <= 0)) {
        const o = document.createElement("option");
        o.value = ""; o.disabled = true;
        o.innerText = "No stock available — add a Purchase first";
        input.appendChild(o);
      }
      input.onchange = () => {
        const opt = input.options[input.selectedIndex];
        const sizeEl = document.getElementById("input_size");
        const costEl = document.getElementById("input_cost_price");
        if (sizeEl) sizeEl.value = opt.dataset.size || "";
        if (costEl) costEl.value = opt.dataset.cost || 0;
        calculateSalesTotal();
      };
    } else if (effType === "customer_select") {
      const custList = await getCustomersByType(f.customer_type_filter);

      // Required customer_select fields (Buyer Name, Supplier Name) must
      // always resolve to an existing registered customer — the client
      // does not want a sale/purchase saveable against a free-text name,
      // so these stay a locked dropdown even in Previous/Modify mode.
      // Optional ones (Transporter Name) keep the flexible combo there.
      if (usesManualWidgets(entryId) && !f.required) {
        // Previous/Modify mode: still linked to the customer catalog
        // (autocompletes and fills contact/address on an exact match) but
        // not locked to it — typing a name that isn't in the list is a
        // normal manual entry.
        const combo = makeComboInput(
          custList,
          c => c.customer_name,
          c => c.contact_number ? `${c.customer_name} (${c.contact_number})` : c.customer_name,
          (matched) => {
            if (f.fills_contact_field) {
              const contactEl = document.getElementById(`input_${f.fills_contact_field}`);
              if (contactEl) contactEl.value = matched ? (matched.contact_number || "") : contactEl.value;
            }
            if (f.fills_address_field) {
              const addressEl = document.getElementById(`input_${f.fills_address_field}`);
              if (addressEl) addressEl.value = matched ? (matched.address || "") : addressEl.value;
            }
          }
        );
        input = combo.input;
        input.placeholder = `${f.customer_type_filter} customer name — pick existing or type a new one`;
        pendingDatalist = combo.datalist;
      } else {
        input = document.createElement("select");
        input.className = "form-control";
        if (f.required) input.required = true;
        input.innerHTML = `<option value="">-- Select ${f.customer_type_filter} Customer --</option>`;
        custList.forEach(c => {
          const o = document.createElement("option");
          o.value = c.customer_name;
          o.dataset.contact = c.contact_number || "";
          o.dataset.address = c.address || "";
          o.innerText = c.contact_number ? `${c.customer_name} (${c.contact_number})` : c.customer_name;
          input.appendChild(o);
        });
        if (custList.length === 0) {
          const o = document.createElement("option");
          o.value = ""; o.disabled = true;
          o.innerText = `No ${f.customer_type_filter} customers yet — add one in Customer Registration first`;
          input.appendChild(o);
        }
        const isCreditField = (entryId === "new_sale" && f.name === "buyer_name") ||
                               (entryId === "new_purchase" && f.name === "supplier_name");
        if (f.fills_contact_field || f.fills_address_field || isCreditField) {
          input.onchange = () => {
            const opt = input.options[input.selectedIndex];
            if (f.fills_contact_field) {
              const contactEl = document.getElementById(`input_${f.fills_contact_field}`);
              if (contactEl) contactEl.value = opt.dataset.contact || "";
            }
            if (f.fills_address_field) {
              const addressEl = document.getElementById(`input_${f.fills_address_field}`);
              if (addressEl) addressEl.value = opt.dataset.address || "";
            }
            if (isCreditField) updateAvailableCredit(entryId, opt.value);
          };
        }
      }
    } else if (effType === "invoice_ref_select") {
      input = document.createElement("select");
      input.className = "form-control";
      if (f.required) input.required = true;
      input.innerHTML = `<option value="">-- Select Reference --</option>`;
      input.dataset.dependsOn = f.depends_on || "";
      const populateInvoiceRefs = async () => {
        const dependEl = document.getElementById(`input_${f.depends_on}`);
        const movementType = dependEl ? dependEl.value : "Purchase";
        const refType = movementType === "Sales" ? "sales" : "purchases";
        input.innerHTML = `<option value="">-- Select Reference --</option>`;
        try {
          const r = await apiFetch(`/api/invoice_refs?type=${refType}&client_id=${currentClientId}`);
          const refs = await r.json();
          refs.forEach(ref => {
            const o = document.createElement("option");
            o.value = ref.reference_no;
            o.dataset.quantity = ref.quantity || 0;
            o.dataset.fromLocation = ref.from_location || "";
            o.dataset.toLocation = ref.to_location || "";
            o.dataset.transporterName = ref.transporter_name || "";
            o.dataset.truckNo = ref.truck_no || "";
            const totalStr = parseFloat(ref.total_amount || 0).toFixed(2);
            o.innerText = `${ref.reference_no} — ${ref.customer_name || "Unknown"} (BDT ${totalStr})`;
            input.appendChild(o);
          });
        } catch (e) { /* ignore */ }
      };
      input._populateInvoiceRefs = populateInvoiceRefs;
      input.onchange = () => {
        const opt = input.options[input.selectedIndex];
        const qtyEl = document.getElementById("input_quantity");
        if (qtyEl && opt.dataset.quantity !== undefined) qtyEl.value = opt.dataset.quantity;
        const fromEl = document.getElementById("input_from_location");
        if (fromEl) fromEl.value = opt.dataset.fromLocation || "";
        const toEl = document.getElementById("input_to_location");
        if (toEl) toEl.value = opt.dataset.toLocation || "";
        const transEl = document.getElementById("input_transporter_name");
        if (transEl) transEl.value = opt.dataset.transporterName || "";
        const truckEl = document.getElementById("input_truck_no");
        if (truckEl) truckEl.value = opt.dataset.truckNo || "";
        // Best-effort contact/address lookup against the registered
        // Transport-type customer catalog, matched by the transporter name
        // stored on the sale/purchase record itself.
        (async () => {
          const custList = await getCustomersByType("Transport");
          const match = custList.find(c => c.customer_name === (opt.dataset.transporterName || ""));
          const contactEl = document.getElementById("input_contact_number");
          if (contactEl) contactEl.value = match ? (match.contact_number || "") : "";
          const addressEl = document.getElementById("input_address");
          if (addressEl) addressEl.value = match ? (match.address || "") : "";
        })();
        if (typeof calculateTransporterTotal === "function") calculateTransporterTotal();
      };
    } else {
      input = document.createElement("input");
      input.type = effType === "number" ? "number" : (effType === "date" ? "date" : "text");
      input.className = "form-control";
      if (effType === "number") input.step = "any";
      // Chrome/Edge render the native date picker's display format based on
      // the input's `lang` attribute — force en-GB so it shows dd/mm/yyyy
      // instead of the browser-default mm/dd/yyyy (en-US).
      if (effType === "date") input.setAttribute("lang", "en-GB");
      if (f.required) input.required = true;
      // Previous (historical backfill) mode always allows editing every
      // normally-readonly field manually — there's no live customer/
      // inventory link left to auto-populate them from (chalan_no's
      // auto-gen, contact/address auto-fill, cost_price from inventory).
      const forceEditable = currentRecordMode === "Previous" || currentRecordMode === "Modify";
      if (f.readonly && !forceEditable) input.readOnly = true;
      if (f.auto_gen && currentRecordMode === "New") input.value = `${f.auto_gen}${Date.now().toString().slice(-6)}`;
      if (effType === "date") input.value = new Date().toISOString().split('T')[0];
      if (f.default !== undefined && !input.value) input.value = f.default;
    }

    input.name = f.name;
    input.id = `input_${f.name}`;

    // Recalc totals as user types
    if (MULTI_ITEM_FIELDS[entryId]) {
      if (f.name === 'advance') input.oninput = () => recalcLineItemTotals(entryId);
    } else if (ep.table === 'sales' && ['received_quantity', 'sale_unit_price', 'advance'].includes(f.name)) {
      input.oninput = calculateSalesTotal;
    } else if (ep.table === 'purchases' && ['quantity', 'unit_price', 'advance'].includes(f.name)) {
      input.oninput = calculatePurchaseTotal;
    } else if (ep.table === 'transporters' && ['unit_rate_per_ton', 'advance'].includes(f.name)) {
      input.oninput = calculateTransporterTotal;
    }

    if (f.show_if) {
      group.dataset.showIfField = f.show_if.field;
      group.dataset.showIfValue = f.show_if.value;
    }

    group.appendChild(input);
    if (pendingDatalist) group.appendChild(pendingDatalist);
    container.appendChild(group);

    if (f.name === "entry_mode" && entryId === "new_customer" && currentRecordMode === "Modify") {
      container.appendChild(await buildCustomerModifySelectGroup());
    }
  }

  // Wire up show_if conditional visibility now that all fields exist
  container.querySelectorAll('[data-show-if-field]').forEach(group => {
    const watchEl = document.getElementById(`input_${group.dataset.showIfField}`);
    if (!watchEl) return;
    const targetEl = group.querySelector('input, select, textarea');
    const update = () => {
      const visible = watchEl.value === group.dataset.showIfValue;
      group.style.display = visible ? "" : "none";
      // A required field hidden via show_if (e.g. Bank Name/LC No, only
      // shown for Foreign purchases) must not block submission of the
      // Domestic case — the browser tries to validate/focus it either way.
      if (targetEl && targetEl.dataset.originallyRequired === "true") {
        targetEl.required = visible;
      }
    };
    if (targetEl && targetEl.required) targetEl.dataset.originallyRequired = "true";
    watchEl.addEventListener("change", update);
    update();
  });

  // Wire up invoice_ref_select fields to refresh when their depends_on field changes
  container.querySelectorAll('select[data-depends-on]').forEach(refSelect => {
    const dependsOnName = refSelect.dataset.dependsOn;
    if (!dependsOnName || !refSelect._populateInvoiceRefs) return;
    const watchEl = document.getElementById(`input_${dependsOnName}`);
    if (watchEl) watchEl.addEventListener("change", refSelect._populateInvoiceRefs);
    refSelect._populateInvoiceRefs();
  });

  // Auto-fill chalan (only in New mode — Previous keys in its own historical
  // number, and Modify's chalan_no field is a picker, not a text input)
  if (ep.table === 'sales' && currentRecordMode === 'New') {
    try {
      const r = await apiFetch(`/api/next_chalan?client_id=${currentClientId}`);
      const data = await r.json();
      const el = document.getElementById("input_chalan_no");
      if (el && !el.value) el.value = data.chalan_no;
    } catch (e) { /* ignore */ }
  }

  // Available credit (overpayment carry-forward from an earlier invoice
  // for this same customer) — New mode only, mirrors the "credit" concept
  // introduced by the Customer Payment feature but scoped to direct
  // entry-time overpayment on Sales/Purchase.
  if ((entryId === "new_sale" || entryId === "new_purchase") && currentRecordMode === "New") {
    const wrap = document.createElement("div");
    wrap.className = "form-group col-12";
    wrap.id = "creditBoxWrap";
    wrap.style.display = "none";
    wrap.innerHTML = `
      <div style="display:flex; align-items:center; gap:14px; padding:10px 14px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
        <span>Available Credit for this customer: <strong id="creditAvailableAmount" style="color:var(--accent-emerald);">BDT 0.00</strong></span>
        <label style="margin-left:auto; display:flex; align-items:center; gap:6px; font-weight:400;">
          Apply:
          <input type="number" step="any" min="0" class="form-control" id="input_apply_credit" name="apply_credit" value="0" style="width:140px;">
        </label>
      </div>
    `;
    container.appendChild(wrap);
    const applyInput = wrap.querySelector("#input_apply_credit");
    applyInput.oninput = () => recalcLineItemTotals(entryId);
  }

  // Multi-product line items (sales/purchases only)
  if (MULTI_ITEM_FIELDS[entryId]) {
    const wrap = document.createElement("div");
    wrap.className = "form-group col-12";
    wrap.innerHTML = `
      <label style="display:flex; justify-content:space-between; align-items:center;">
        <span>Product Line Items</span>
        <span style="display:flex; align-items:center; gap:8px; font-weight:400;">
          Number of Products:
          <input type="number" id="lineItemCount" class="form-control" style="width:80px;" min="1" value="1">
        </span>
      </label>
      <div id="lineItemsContainer" style="margin-top:10px; display:flex; flex-direction:column; gap:14px;"></div>
    `;
    container.appendChild(wrap);
    document.getElementById("lineItemCount").addEventListener("input", (e) => {
      let n = parseInt(e.target.value || "1", 10);
      if (!n || n < 1) n = 1;
      renderLineItemRows(entryId, n);
    });
    renderLineItemRows(entryId, 1);
  }

  // Live totals box
  if (ep.table === 'sales' || ep.table === 'purchases' || ep.table === 'transporters' || ep.table === 'quotations' || ep.table === 'purchase_orders') {
    const totalBox = document.createElement("div");
    totalBox.className = "form-group col-12";
    totalBox.style.padding = "14px";
    totalBox.style.background = "rgba(99,102,241,0.1)";
    totalBox.style.borderRadius = "8px";
    const noDueTable = ep.table === 'quotations' || ep.table === 'purchase_orders';
    const totalLabel = ep.table === 'quotations' ? 'Total Quotation Price:' : ep.table === 'purchase_orders' ? 'Total Purchase Order Value:' : 'Calculated Total:';
    const dueRowDisplay = noDueTable ? 'none' : 'flex';
    totalBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:600; color:var(--accent-cyan);">${totalLabel}</span>
        <h2 id="liveCalculatedTotal" style="color:var(--accent-emerald);">BDT 0.00</h2>
      </div>
      <div style="display:${dueRowDisplay}; justify-content:space-between; margin-top:8px; font-size:12px; color:var(--text-muted);">
        <span>Suggested Due (Total − Advance):</span>
        <span id="liveCalculatedDue">BDT 0.00</span>
      </div>
    `;
    container.appendChild(totalBox);
  }
}

function renderLineItemRows(entryId, count) {
  const rowsContainer = document.getElementById("lineItemsContainer");
  if (!rowsContainer) return;
  rowsContainer.innerHTML = "";
  for (let i = 0; i < count; i++) {
    rowsContainer.appendChild(buildLineItemRow(entryId, i));
  }
  recalcLineItemTotals(entryId);
}

function buildLineItemRow(entryId, idx) {
  const row = document.createElement("div");
  row.className = "form-grid";
  row.style.cssText = "border:1px solid var(--border-color); border-radius:8px; padding:12px;";
  row.dataset.rowIndex = idx;

  const mkGroup = (colSpan, labelText) => {
    const g = document.createElement("div");
    g.className = `form-group col-${colSpan}`;
    if (labelText) {
      const l = document.createElement("label");
      l.innerText = labelText;
      g.appendChild(l);
    }
    return g;
  };

  const useManualLine = usesManualWidgets(entryId);

  if (useManualLine) {
    // Previous (historical backfill) or Modify (editing an existing
    // transaction) — product identity still links to the product catalog
    // (autocompletes and suggests size/price on an exact match) with
    // manual entry as a fallback for a product no longer/never registered
    // there, rather than a live-stock-locked dropdown.
    const priceFieldId = entryId === "new_sale" ? `li_sale_unit_price_${idx}` : `li_unit_price_${idx}`;
    const gProduct = mkGroup(4, `Product #${idx + 1} Type *`);
    const productCombo = makeComboInput(
      productsCache,
      p => p.product_type,
      p => `${p.product_type} — ${p.size} (BDT ${parseFloat(p.unit_price).toFixed(2)})`,
      (matched) => {
        const sizeEl = document.getElementById(`li_size_${idx}`);
        const priceEl = document.getElementById(priceFieldId);
        if (sizeEl) sizeEl.value = matched ? (matched.size || "") : sizeEl.value;
        if (matched && priceEl && (!priceEl.value || parseFloat(priceEl.value) === 0)) {
          priceEl.value = matched.unit_price || 0;
        }
        recalcLineItemTotals(entryId);
      }
    );
    productCombo.input.id = `li_product_type_${idx}`;
    productCombo.input.placeholder = "Product name — pick existing or type a new one";
    productCombo.input.required = true;
    gProduct.appendChild(productCombo.input);
    gProduct.appendChild(productCombo.datalist);

    const gSize = mkGroup(2, "Size");
    const inSize = document.createElement("input");
    inSize.type = "text"; inSize.className = "form-control"; inSize.id = `li_size_${idx}`;
    gSize.appendChild(inSize);

    if (entryId === "new_sale") {
      const gCost = mkGroup(2, "Cost Price");
      const inCost = document.createElement("input");
      inCost.type = "number"; inCost.step = "any"; inCost.className = "form-control"; inCost.id = `li_cost_price_${idx}`; inCost.value = 0;
      gCost.appendChild(inCost);

      const gQty = mkGroup(2, "Qty *");
      const inQty = document.createElement("input");
      inQty.type = "number"; inQty.step = "any"; inQty.min = "0.01"; inQty.className = "form-control"; inQty.id = `li_received_quantity_${idx}`; inQty.value = 0; inQty.required = true;
      inQty.oninput = () => recalcLineItemTotals(entryId);
      gQty.appendChild(inQty);

      const gPrice = mkGroup(2, "Sale Price *");
      const inPrice = document.createElement("input");
      inPrice.type = "number"; inPrice.step = "any"; inPrice.min = "0.01"; inPrice.className = "form-control"; inPrice.id = `li_sale_unit_price_${idx}`; inPrice.value = 0; inPrice.required = true;
      inPrice.oninput = () => recalcLineItemTotals(entryId);
      gPrice.appendChild(inPrice);

      const gUnload = mkGroup(2, "Unload Cost/Unit");
      const inUnload = document.createElement("input");
      inUnload.type = "number"; inUnload.step = "any"; inUnload.className = "form-control"; inUnload.id = `li_unloading_cost_per_unit_${idx}`; inUnload.value = 0;
      inUnload.oninput = () => recalcLineItemTotals(entryId);
      gUnload.appendChild(inUnload);

      row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gCost); row.appendChild(gQty); row.appendChild(gPrice); row.appendChild(gUnload);
    } else {
      const gQty = mkGroup(3, "Quantity *");
      const inQty = document.createElement("input");
      inQty.type = "number"; inQty.step = "any"; inQty.min = "0.01"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0; inQty.required = true;
      inQty.oninput = () => recalcLineItemTotals(entryId);
      gQty.appendChild(inQty);

      const gPrice = mkGroup(3, "Unit Price *");
      const inPrice = document.createElement("input");
      inPrice.type = "number"; inPrice.step = "any"; inPrice.min = "0.01"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0; inPrice.required = true;
      inPrice.oninput = () => recalcLineItemTotals(entryId);
      gPrice.appendChild(inPrice);

      row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gQty); row.appendChild(gPrice);
    }
  } else if (entryId === "new_sale") {
    const gProduct = mkGroup(4, `Product #${idx + 1} (from Inventory) *`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
    selProduct.required = true;
    selProduct.innerHTML = `<option value="">-- Select from Inventory --</option>`;
    inventoryCache.forEach(item => {
      if ((item.quantity || 0) <= 0) return;
      const o = document.createElement("option");
      o.value = item.product_type;
      o.dataset.size = item.size;
      o.dataset.cost = item.cost_price;
      o.innerText = `${item.product_type} — ${item.size} (Stock: ${item.quantity}, Cost: BDT ${parseFloat(item.cost_price).toFixed(2)})`;
      selProduct.appendChild(o);
    });
    selProduct.onchange = () => {
      const opt = selProduct.options[selProduct.selectedIndex];
      const sizeEl = document.getElementById(`li_size_${idx}`);
      const costEl = document.getElementById(`li_cost_price_${idx}`);
      if (sizeEl) sizeEl.value = opt.dataset.size || "";
      if (costEl) costEl.value = opt.dataset.cost || 0;
      recalcLineItemTotals(entryId);
    };
    gProduct.appendChild(selProduct);

    const gSize = mkGroup(2, "Size");
    const inSize = document.createElement("input");
    inSize.type = "text"; inSize.className = "form-control"; inSize.id = `li_size_${idx}`; inSize.readOnly = true;
    gSize.appendChild(inSize);

    const gCost = mkGroup(2, "Cost (auto)");
    const inCost = document.createElement("input");
    inCost.type = "number"; inCost.className = "form-control"; inCost.id = `li_cost_price_${idx}`; inCost.readOnly = true; inCost.value = 0;
    gCost.appendChild(inCost);

    const gQty = mkGroup(2, "Qty *");
    const inQty = document.createElement("input");
    inQty.type = "number"; inQty.step = "any"; inQty.min = "0.01"; inQty.className = "form-control"; inQty.id = `li_received_quantity_${idx}`; inQty.value = 0; inQty.required = true;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(2, "Sale Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.min = "0.01"; inPrice.className = "form-control"; inPrice.id = `li_sale_unit_price_${idx}`; inPrice.value = 0; inPrice.required = true;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    const gUnload = mkGroup(2, "Unload Cost/Unit");
    const inUnload = document.createElement("input");
    inUnload.type = "number"; inUnload.step = "any"; inUnload.className = "form-control"; inUnload.id = `li_unloading_cost_per_unit_${idx}`; inUnload.value = 0;
    inUnload.oninput = () => recalcLineItemTotals(entryId);
    gUnload.appendChild(inUnload);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gCost); row.appendChild(gQty); row.appendChild(gPrice); row.appendChild(gUnload);
  } else if (entryId === "new_quotation") {
    const gProduct = mkGroup(3, `Product #${idx + 1} Type *`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
    selProduct.required = true;
    selProduct.innerHTML = `<option value="">-- Select Product --</option>`;
    productsCache.forEach(p => {
      const o = document.createElement("option");
      o.value = p.product_type;
      o.dataset.size = p.size;
      o.dataset.price = p.unit_price;
      o.dataset.origin = p.origin || "";
      o.innerText = `${p.product_type} — ${p.size} (BDT ${parseFloat(p.unit_price).toFixed(2)})`;
      selProduct.appendChild(o);
    });
    selProduct.onchange = () => {
      const opt = selProduct.options[selProduct.selectedIndex];
      const sizeEl = document.getElementById(`li_size_${idx}`);
      const priceEl = document.getElementById(`li_unit_price_${idx}`);
      const originEl = document.getElementById(`li_origin_${idx}`);
      if (sizeEl) sizeEl.value = opt.dataset.size || "";
      if (priceEl && opt.dataset.price) priceEl.value = opt.dataset.price;
      if (originEl) originEl.value = opt.dataset.origin || "";
      recalcLineItemTotals(entryId);
    };
    gProduct.appendChild(selProduct);

    const gSize = mkGroup(2, "Size");
    const inSize = document.createElement("input");
    inSize.type = "text"; inSize.className = "form-control"; inSize.id = `li_size_${idx}`;
    gSize.appendChild(inSize);

    const gOrigin = mkGroup(2, "Origin");
    const inOrigin = document.createElement("input");
    inOrigin.type = "text"; inOrigin.className = "form-control"; inOrigin.id = `li_origin_${idx}`;
    gOrigin.appendChild(inOrigin);

    const gQty = mkGroup(2, "Qty *");
    const inQty = document.createElement("input");
    inQty.type = "number"; inQty.step = "any"; inQty.min = "0.01"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0; inQty.required = true;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(3, "Unit Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.min = "0.01"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0; inPrice.required = true;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gOrigin); row.appendChild(gQty); row.appendChild(gPrice);
  } else {
    const gProduct = mkGroup(4, `Product #${idx + 1} Type *`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
    selProduct.required = true;
    selProduct.innerHTML = `<option value="">-- Select Product --</option>`;
    productsCache.forEach(p => {
      const o = document.createElement("option");
      o.value = p.product_type;
      o.dataset.size = p.size;
      o.dataset.price = p.unit_price;
      o.innerText = `${p.product_type} — ${p.size} (BDT ${parseFloat(p.unit_price).toFixed(2)})`;
      selProduct.appendChild(o);
    });
    selProduct.onchange = () => {
      const opt = selProduct.options[selProduct.selectedIndex];
      const sizeEl = document.getElementById(`li_size_${idx}`);
      const priceEl = document.getElementById(`li_unit_price_${idx}`);
      if (sizeEl) sizeEl.value = opt.dataset.size || "";
      if (priceEl && opt.dataset.price) priceEl.value = opt.dataset.price;
      recalcLineItemTotals(entryId);
    };
    gProduct.appendChild(selProduct);

    const gSize = mkGroup(2, "Size");
    const inSize = document.createElement("input");
    inSize.type = "text"; inSize.className = "form-control"; inSize.id = `li_size_${idx}`;
    gSize.appendChild(inSize);

    const gQty = mkGroup(3, "Quantity *");
    const inQty = document.createElement("input");
    inQty.type = "number"; inQty.step = "any"; inQty.min = "0.01"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0; inQty.required = true;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(3, "Unit Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.min = "0.01"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0; inPrice.required = true;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gQty); row.appendChild(gPrice);
  }

  const gSubtotal = mkGroup(12, "");
  const unloadSpan = entryId === "new_sale"
    ? ` &nbsp;|&nbsp; Unloading Cost: <strong id="li_unload_cost_${idx}" style="color:var(--accent-emerald);">BDT 0.00</strong>`
    : "";
  gSubtotal.innerHTML = `<div style="text-align:right; font-size:12px; color:var(--text-muted);">Line Subtotal: <strong id="li_subtotal_${idx}" style="color:var(--accent-emerald);">BDT 0.00</strong>${unloadSpan}</div>`;
  row.appendChild(gSubtotal);

  return row;
}

// ---------------- MODIFY EXISTING RECORD (Sales/Purchase/Customer) ----------------
// Admin-only: lets a previously entered record be loaded back into its own
// entry form for in-place editing (the "Modify" record_source/entry_mode
// option). Distinct from Previous mode — Modify edits a record (and its
// inventory effect) that already exists, rather than backfilling a new one.

async function populateModifyRefSelect(entryId, selectEl) {
  const table = entryId === "new_sale" ? "sales" : "purchases";
  try {
    const res = await apiFetch(`/api/modify_refs?table=${table}&client_id=${currentClientId}`);
    const refs = await res.json();
    refs.forEach(r => {
      const o = document.createElement("option");
      o.value = r.reference_no;
      o.innerText = `${r.reference_no} — ${r.party_name || ''} (${r.record_date || ''})`;
      selectEl.appendChild(o);
    });
  } catch (e) { /* ignore */ }
}

async function loadRecordForModify(entryId, referenceNo) {
  modifyTargetRef = null;
  if (!referenceNo) return;
  const table = entryId === "new_sale" ? "sales" : "purchases";
  const refFieldName = entryId === "new_sale" ? "chalan_no" : "input_invoice_no";
  try {
    const res = await apiFetch(`/api/entry_record?table=${table}&reference_no=${encodeURIComponent(referenceNo)}&client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert(data.message); return; }

    modifyTargetRef = referenceNo;
    const ep = systemConfig.entry_points.find(x => x.id === entryId);
    const lineItemFieldNames = MULTI_ITEM_FIELDS[entryId] || [];

    ep.fields.forEach(f => {
      if (lineItemFieldNames.includes(f.name)) return;
      if (f.name === "record_source" || f.name === refFieldName) return;
      const el = document.getElementById(`input_${f.name}`);
      if (el && data.header[f.name] !== undefined && data.header[f.name] !== null) {
        el.value = data.header[f.name];
      }
    });

    const items = data.items || [];
    const countEl = document.getElementById("lineItemCount");
    if (countEl) countEl.value = items.length || 1;
    renderLineItemRows(entryId, items.length || 1);

    const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ""; };
    items.forEach((item, idx) => {
      setVal(`li_product_type_${idx}`, item.product_type);
      setVal(`li_size_${idx}`, item.size);
      if (entryId === "new_sale") {
        setVal(`li_cost_price_${idx}`, item.cost_price);
        setVal(`li_received_quantity_${idx}`, item.received_quantity);
        setVal(`li_sale_unit_price_${idx}`, item.sale_unit_price);
        setVal(`li_unloading_cost_per_unit_${idx}`, item.unloading_cost_per_unit);
      } else {
        setVal(`li_quantity_${idx}`, item.quantity);
        setVal(`li_unit_price_${idx}`, item.unit_price);
      }
    });
    recalcLineItemTotals(entryId);
  } catch (err) {
    alert("Failed to load record: " + err.message);
  }
}

async function buildCustomerModifySelectGroup() {
  const g = document.createElement("div");
  g.className = "form-group col-12";
  const l = document.createElement("label");
  l.innerText = "Select Customer to Modify *";
  g.appendChild(l);

  const sel = document.createElement("select");
  sel.className = "form-control";
  sel.innerHTML = `<option value="">-- Select Customer --</option>`;
  try {
    const res = await apiFetch(`/api/customers?client_id=${currentClientId}`);
    const list = await res.json();
    list.forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.innerText = `${c.customer_name} (${c.customer_type}${c.contact_number ? ' — ' + c.contact_number : ''})`;
      sel.appendChild(o);
    });
  } catch (e) { /* ignore */ }
  sel.onchange = () => loadCustomerForModify(sel.value);
  g.appendChild(sel);
  return g;
}

async function loadCustomerForModify(customerId) {
  modifyTargetRef = null;
  if (!customerId) return;
  try {
    const res = await apiFetch(`/api/customers?client_id=${currentClientId}`);
    const list = await res.json();
    const c = list.find(x => String(x.id) === String(customerId));
    if (!c) return;
    modifyTargetRef = c.id;
    const setVal = (name, v) => { const e = document.getElementById(`input_${name}`); if (e) e.value = v ?? ""; };
    setVal("customer_name", c.customer_name);
    setVal("customer_type", c.customer_type);
    setVal("contact_number", c.contact_number);
    setVal("address", c.address);
  } catch (err) {
    alert("Failed to load customer: " + err.message);
  }
}

function recalcLineItemTotals(entryId) {
  const rowsContainer = document.getElementById("lineItemsContainer");
  if (!rowsContainer) return;
  const rows = rowsContainer.querySelectorAll("[data-row-index]");
  let grand = 0;
  rows.forEach(row => {
    const idx = row.dataset.rowIndex;
    let qty, price;
    if (entryId === "new_sale") {
      qty = parseFloat(document.getElementById(`li_received_quantity_${idx}`)?.value || 0);
      price = parseFloat(document.getElementById(`li_sale_unit_price_${idx}`)?.value || 0);
    } else {
      qty = parseFloat(document.getElementById(`li_quantity_${idx}`)?.value || 0);
      price = parseFloat(document.getElementById(`li_unit_price_${idx}`)?.value || 0);
    }
    const subtotal = qty * price;
    grand += subtotal;
    const subtotalEl = document.getElementById(`li_subtotal_${idx}`);
    if (subtotalEl) subtotalEl.innerText = `BDT ${subtotal.toFixed(2)}`;

    if (entryId === "new_sale") {
      const unloadRate = parseFloat(document.getElementById(`li_unloading_cost_per_unit_${idx}`)?.value || 0);
      const unloadCost = qty * unloadRate;
      const unloadEl = document.getElementById(`li_unload_cost_${idx}`);
      if (unloadEl) unloadEl.innerText = `BDT ${unloadCost.toFixed(2)}`;
    }
  });

  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const appliedCredit = parseFloat(document.getElementById("input_apply_credit")?.value || 0);
  const effectiveAdvance = adv + appliedCredit;
  const due = Math.max(0, grand - effectiveAdvance);
  const totalEl = document.getElementById("liveCalculatedTotal");
  const dueDisplayEl = document.getElementById("liveCalculatedDue");
  if (totalEl) totalEl.innerText = `BDT ${grand.toFixed(2)}`;
  if (dueDisplayEl) {
    dueDisplayEl.innerText = `BDT ${due.toFixed(2)}`;
    if (effectiveAdvance > grand) {
      dueDisplayEl.innerText += ` (overpaid by BDT ${(effectiveAdvance - grand).toFixed(2)} — saved as credit)`;
    }
  }
  const dueEl = document.getElementById("input_due");
  if (dueEl && !dueEl._userTouched) dueEl.value = due.toFixed(2);
}

function calculateSalesTotal() {
  const qty = parseFloat(document.getElementById("input_received_quantity")?.value || 0);
  const price = parseFloat(document.getElementById("input_sale_unit_price")?.value || 0);
  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const total = qty * price;
  const due = Math.max(0, total - adv);

  document.getElementById("liveCalculatedTotal").innerText = `BDT ${total.toFixed(2)}`;
  document.getElementById("liveCalculatedDue").innerText = `BDT ${due.toFixed(2)}`;
  const dueEl = document.getElementById("input_due");
  if (dueEl && !dueEl._userTouched) dueEl.value = due.toFixed(2);
  if (dueEl) dueEl.addEventListener("input", () => { dueEl._userTouched = true; }, { once: true });
}

function calculatePurchaseTotal() {
  const qty = parseFloat(document.getElementById("input_quantity")?.value || 0);
  const price = parseFloat(document.getElementById("input_unit_price")?.value || 0);
  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const total = qty * price;
  const due = Math.max(0, total - adv);

  document.getElementById("liveCalculatedTotal").innerText = `BDT ${total.toFixed(2)}`;
  document.getElementById("liveCalculatedDue").innerText = `BDT ${due.toFixed(2)}`;
  const dueEl = document.getElementById("input_due");
  if (dueEl && !dueEl._userTouched) dueEl.value = due.toFixed(2);
  if (dueEl) dueEl.addEventListener("input", () => { dueEl._userTouched = true; }, { once: true });
}

function calculateTransporterTotal() {
  const qty = parseFloat(document.getElementById("input_quantity")?.value || 0);
  const rate = parseFloat(document.getElementById("input_unit_rate_per_ton")?.value || 0);
  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const rent = qty * rate;
  const due = Math.max(0, rent - adv);

  const rentEl = document.getElementById("input_rent");
  if (rentEl) rentEl.value = rent.toFixed(2);

  document.getElementById("liveCalculatedTotal").innerText = `BDT ${rent.toFixed(2)}`;
  document.getElementById("liveCalculatedDue").innerText = `BDT ${due.toFixed(2)}`;
  const dueEl = document.getElementById("input_due");
  if (dueEl && !dueEl._userTouched) dueEl.value = due.toFixed(2);
  if (dueEl) dueEl.addEventListener("input", () => { dueEl._userTouched = true; }, { once: true });
}

function resetCurrentForm() {
  paymentEditId = null;
  if (currentEntryId) renderEntryForm(currentEntryId);
}

// Fetches and displays a customer's available overpayment credit balance
// (built up when a past invoice was paid/received for more than its own
// total) on Sales/Purchase Entry, so the operator can apply it toward the
// invoice currently being created — see the CUSTOMER CREDIT section in
// database.py for how the balance itself is tracked.
async function updateAvailableCredit(entryId, customerName) {
  const wrap = document.getElementById("creditBoxWrap");
  const amountEl = document.getElementById("creditAvailableAmount");
  const applyInput = document.getElementById("input_apply_credit");
  if (!wrap) return;
  if (!customerName) {
    wrap.style.display = "none";
    if (applyInput) { applyInput.value = 0; applyInput.max = ""; }
    recalcLineItemTotals(entryId);
    return;
  }
  const txnType = entryId === "new_sale" ? "Sales" : "Purchase";
  try {
    const r = await apiFetch(`/api/customer_credit?txn_type=${txnType}&customer=${encodeURIComponent(customerName)}&client_id=${currentClientId}`);
    const data = await r.json();
    const available = parseFloat(data.available || 0);
    wrap.style.display = available > 0 ? "block" : "none";
    if (amountEl) amountEl.innerText = `BDT ${available.toFixed(2)}`;
    if (applyInput) { applyInput.max = available; applyInput.value = 0; }
    recalcLineItemTotals(entryId);
  } catch (e) { /* ignore */ }
}

// ---------------- CUSTOMER PAYMENT / RECEIPT ----------------
// Custom (non-config-driven) entry form: pick a Transaction Type, then a
// customer who currently owes/is-owed money under that type, then the
// outstanding bills for that customer load in with an editable "amount to
// apply" per bill. Built entirely via DOM here (like the multi-item line
// rows) rather than through the generic field-loop in renderEntryForm(),
// since the due-bill list is fetched dynamically and isn't a fixed field.
async function renderPaymentEntryForm() {
  const container = document.getElementById("formFieldsContainer");
  container.innerHTML = "";

  const mkGroup = (span, labelHtml) => {
    const g = document.createElement("div");
    g.className = `form-group col-${span}`;
    if (labelHtml) g.innerHTML = `<label>${labelHtml}</label>`;
    return g;
  };

  const gDate = mkGroup(4, "Payment Date *");
  const inDate = document.createElement("input");
  inDate.type = "date"; inDate.className = "form-control"; inDate.id = "pmt_date"; inDate.required = true;
  inDate.setAttribute("lang", "en-GB");
  inDate.value = new Date().toISOString().split('T')[0];
  gDate.appendChild(inDate);
  container.appendChild(gDate);

  const gType = mkGroup(4, "Transaction Type *");
  const selType = document.createElement("select");
  selType.className = "form-control"; selType.id = "pmt_txn_type"; selType.required = true;
  selType.innerHTML = `<option value="">-- Select --</option>
    <option value="Sales">Sales (money received from customer)</option>
    <option value="Purchase">Purchase (money paid to supplier)</option>
    <option value="Transport">Transport (money paid to transporter)</option>`;
  selType.onchange = () => populatePaymentCustomers();
  gType.appendChild(selType);
  container.appendChild(gType);

  const gCust = mkGroup(4, "Customer *");
  const selCust = document.createElement("select");
  selCust.className = "form-control"; selCust.id = "pmt_customer"; selCust.required = true;
  selCust.innerHTML = `<option value="">-- Select Transaction Type First --</option>`;
  selCust.onchange = () => loadPaymentDueBills();
  gCust.appendChild(selCust);
  container.appendChild(gCust);

  const gNotes = mkGroup(12, "Notes");
  const inNotes = document.createElement("input");
  inNotes.type = "text"; inNotes.className = "form-control"; inNotes.id = "pmt_notes";
  gNotes.appendChild(inNotes);
  container.appendChild(gNotes);

  const gBills = mkGroup(12, "Outstanding Bills");
  const billsWrap = document.createElement("div");
  billsWrap.id = "pmtBillsContainer";
  billsWrap.style.cssText = "margin-top:8px; display:flex; flex-direction:column; gap:8px;";
  billsWrap.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">Select a Transaction Type and Customer to see outstanding bills.</div>`;
  gBills.appendChild(billsWrap);
  const totalLine = document.createElement("div");
  totalLine.style.cssText = "text-align:right; margin-top:10px; font-size:14px;";
  totalLine.innerHTML = `Total Payment Amount: <strong id="pmtTotalAmount" style="color:var(--accent-emerald);">BDT 0.00</strong>`;
  gBills.appendChild(totalLine);
  container.appendChild(gBills);

  if (paymentEditId) {
    await loadPaymentForEdit(paymentEditId);
  }
}

async function populatePaymentCustomers() {
  const type = document.getElementById("pmt_txn_type")?.value;
  const selCust = document.getElementById("pmt_customer");
  if (!selCust) return;
  selCust.innerHTML = `<option value="">-- Select Customer --</option>`;
  const billsWrap = document.getElementById("pmtBillsContainer");
  if (billsWrap) billsWrap.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">Select a customer to see outstanding bills.</div>`;
  updatePaymentTotal();
  if (!type) return;
  try {
    const r = await apiFetch(`/api/customers_with_dues?txn_type=${encodeURIComponent(type)}&client_id=${currentClientId}`);
    const names = await r.json();
    if (!names.length) {
      selCust.innerHTML = `<option value="">-- No outstanding dues for this type --</option>`;
      return;
    }
    names.forEach(name => {
      const o = document.createElement("option");
      o.value = name; o.innerText = name;
      selCust.appendChild(o);
    });
  } catch (e) { /* ignore */ }
}

function buildPaymentBillRow(referenceNo, txnDate, total, advance, due, prefillAmount, displayLabel) {
  const row = document.createElement("div");
  row.className = "pmt-bill-row";
  row.dataset.referenceNo = referenceNo;
  row.style.cssText = "display:grid; grid-template-columns: 1.3fr 1fr 1fr 1fr 1.2fr; gap:10px; align-items:center; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:8px;";
  const dateLine = txnDate ? `<br><span style="font-size:11px; color:var(--text-muted);">${txnDate}</span>` : "";
  row.innerHTML = `
    <div><strong>${displayLabel || referenceNo}</strong>${dateLine}</div>
    <div>Total: BDT ${parseFloat(total || 0).toFixed(2)}</div>
    <div>Advance: BDT ${parseFloat(advance || 0).toFixed(2)}</div>
    <div style="color:var(--accent-rose);">Due: BDT ${parseFloat(due || 0).toFixed(2)}</div>
    <input type="number" step="any" min="0" class="form-control pmt-bill-amount" placeholder="Amount to apply" value="${prefillAmount || 0}">
  `;
  row.querySelector(".pmt-bill-amount").oninput = () => updatePaymentTotal();
  return row;
}

async function loadPaymentDueBills() {
  const type = document.getElementById("pmt_txn_type")?.value;
  const customer = document.getElementById("pmt_customer")?.value;
  const billsWrap = document.getElementById("pmtBillsContainer");
  if (!billsWrap) return;
  billsWrap.innerHTML = "";
  if (!type || !customer) {
    billsWrap.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">Select a customer to see outstanding bills.</div>`;
    updatePaymentTotal();
    return;
  }
  try {
    const r = await apiFetch(`/api/customer_dues?txn_type=${encodeURIComponent(type)}&customer=${encodeURIComponent(customer)}&client_id=${currentClientId}`);
    const bills = await r.json();
    if (!bills.length) {
      billsWrap.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">No outstanding bills for this customer.</div>`;
      updatePaymentTotal();
      return;
    }
    bills.forEach(bill => {
      billsWrap.appendChild(buildPaymentBillRow(bill.reference_no, bill.txn_date, bill.total, bill.advance, bill.due, 0));
    });
    updatePaymentTotal();
  } catch (e) { /* ignore */ }
}

function updatePaymentTotal() {
  let total = 0;
  document.querySelectorAll(".pmt-bill-amount").forEach(inp => { total += parseFloat(inp.value || 0); });
  const el = document.getElementById("pmtTotalAmount");
  if (el) el.innerText = `BDT ${total.toFixed(2)}`;
}

// Loads an existing payment's data back into the form for editing. The
// due-bill list only shows bills with due > 0 right now — a bill this same
// payment already fully covered won't appear in it, so any allocation not
// found among the freshly-loaded rows gets a synthetic row injected
// instead (its "true" due, if this payment were reversed, would be its
// current due plus this allocation, but showing that live recomputation
// isn't essential here — the backend handles the reverse-then-reapply
// correctly regardless of what the form displays).
async function loadPaymentForEdit(paymentId) {
  try {
    const r = await apiFetch(`/api/payment/${paymentId}?client_id=${currentClientId}`);
    const data = await r.json();
    if (data.status === "error") { alert("Could not load payment: " + data.message); return; }

    document.getElementById("pmt_date").value = data.payment_date;
    document.getElementById("pmt_txn_type").value = data.txn_type;
    document.getElementById("pmt_notes").value = data.notes || "";

    await populatePaymentCustomers();
    const custSel = document.getElementById("pmt_customer");
    if (!Array.from(custSel.options).some(o => o.value === data.customer_name)) {
      const o = document.createElement("option");
      o.value = data.customer_name; o.innerText = data.customer_name;
      custSel.appendChild(o);
    }
    custSel.value = data.customer_name;

    await loadPaymentDueBills();

    const billsWrap = document.getElementById("pmtBillsContainer");
    (data.allocations || []).forEach(alloc => {
      const existingRow = Array.from(billsWrap.querySelectorAll(".pmt-bill-row"))
        .find(r => r.dataset.referenceNo === alloc.reference_no);
      if (existingRow) {
        existingRow.querySelector(".pmt-bill-amount").value = alloc.allocated_amount;
      } else {
        billsWrap.appendChild(buildPaymentBillRow(
          alloc.reference_no, "", 0, 0, 0, alloc.allocated_amount,
          `${alloc.reference_no} (fully covered by this payment)`
        ));
      }
    });
    updatePaymentTotal();
  } catch (err) {
    alert("Failed to load payment: " + err.message);
  }
}

function collectLineItems(entryId) {
  const rowsContainer = document.getElementById("lineItemsContainer");
  if (!rowsContainer) return [];
  const rows = rowsContainer.querySelectorAll("[data-row-index]");
  const items = [];
  rows.forEach(row => {
    const idx = row.dataset.rowIndex;
    if (entryId === "new_sale") {
      items.push({
        product_type: document.getElementById(`li_product_type_${idx}`)?.value || "",
        size: document.getElementById(`li_size_${idx}`)?.value || "",
        cost_price: document.getElementById(`li_cost_price_${idx}`)?.value || 0,
        received_quantity: document.getElementById(`li_received_quantity_${idx}`)?.value || 0,
        sale_unit_price: document.getElementById(`li_sale_unit_price_${idx}`)?.value || 0,
        unloading_cost_per_unit: document.getElementById(`li_unloading_cost_per_unit_${idx}`)?.value || 0
      });
    } else if (entryId === "new_quotation") {
      items.push({
        product_type: document.getElementById(`li_product_type_${idx}`)?.value || "",
        size: document.getElementById(`li_size_${idx}`)?.value || "",
        origin: document.getElementById(`li_origin_${idx}`)?.value || "",
        quantity: document.getElementById(`li_quantity_${idx}`)?.value || 0,
        unit_price: document.getElementById(`li_unit_price_${idx}`)?.value || 0
      });
    } else {
      items.push({
        product_type: document.getElementById(`li_product_type_${idx}`)?.value || "",
        size: document.getElementById(`li_size_${idx}`)?.value || "",
        quantity: document.getElementById(`li_quantity_${idx}`)?.value || 0,
        unit_price: document.getElementById(`li_unit_price_${idx}`)?.value || 0
      });
    }
  });
  return items;
}

// Auto-fill Sales Entry's buyer + product line items from an approved
// quotation. Leaving the dropdown on "-- No Quotation --" changes nothing —
// the client keys in the sale manually as before.
async function applyQuotationToSale(quotationNo) {
  if (!quotationNo) return;
  try {
    const res = await apiFetch(`/api/quotation/${encodeURIComponent(quotationNo)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Quotation not found."); return; }

    const buyerSel = document.getElementById("input_buyer_name");
    if (buyerSel) {
      let matched = Array.from(buyerSel.options).find(o => o.value === data.customer_name);
      if (!matched) {
        matched = document.createElement("option");
        matched.value = data.customer_name;
        matched.innerText = data.customer_name;
        buyerSel.appendChild(matched);
      }
      buyerSel.selectedIndex = Array.from(buyerSel.options).indexOf(matched);
      const contactEl = document.getElementById("input_contact_number");
      if (contactEl) contactEl.value = matched.dataset.contact || "";
      const addressEl = document.getElementById("input_address");
      if (addressEl) addressEl.value = data.address || matched.dataset.address || "";
    }

    // Project Location on the quotation feeds the Sales Entry's Unloading
    // Location — the quotation names where the job site is, which is where
    // the goods actually get dropped off.
    const unloadEl = document.getElementById("input_unloading_location");
    if (unloadEl && data.project_location) unloadEl.value = data.project_location;

    const items = data.items || [];
    const countEl = document.getElementById("lineItemCount");
    if (countEl) countEl.value = items.length || 1;
    renderLineItemRows("new_sale", items.length || 1);

    items.forEach((item, idx) => {
      const selProduct = document.getElementById(`li_product_type_${idx}`);
      if (selProduct) {
        let matched = Array.from(selProduct.options).find(
          o => o.value === item.product_type && (o.dataset.size || "") === (item.size || "")
        );
        if (!matched) {
          matched = document.createElement("option");
          matched.value = item.product_type;
          matched.dataset.size = item.size || "";
          matched.dataset.cost = 0;
          matched.innerText = `${item.product_type} — ${item.size || ''} (from quotation — not currently in stock)`;
          selProduct.appendChild(matched);
        }
        selProduct.selectedIndex = Array.from(selProduct.options).indexOf(matched);
      }
      const sizeEl = document.getElementById(`li_size_${idx}`);
      if (sizeEl) sizeEl.value = item.size || "";
      const qtyEl = document.getElementById(`li_received_quantity_${idx}`);
      if (qtyEl) qtyEl.value = item.quantity || 0;
      const priceEl = document.getElementById(`li_sale_unit_price_${idx}`);
      if (priceEl) priceEl.value = item.unit_price || 0;
    });
    recalcLineItemTotals("new_sale");
  } catch (err) {
    alert("Failed to load quotation: " + err.message);
  }
}

// "Direct from Purchase" — copies transporter/truck/loading-location and
// every line item's product/size/quantity/cost straight from an existing
// purchase invoice into a new Sales Entry, so a batch bought in can be
// resold without retyping its details. Buyer and sale price are never
// filled here (different party, new price decision) and every field stays
// a normal editable input afterward, same as applyQuotationToSale() above.
async function applyPurchaseInvoiceToSale(inputInvoiceNo) {
  if (!inputInvoiceNo) return;
  try {
    const res = await apiFetch(`/api/purchase_invoice/${encodeURIComponent(inputInvoiceNo)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Purchase invoice not found."); return; }

    const transporterSel = document.getElementById("input_transporter_name");
    if (transporterSel && data.transporter_name) {
      let matched = Array.from(transporterSel.options).find(o => o.value === data.transporter_name);
      if (!matched) {
        matched = document.createElement("option");
        matched.value = data.transporter_name;
        matched.innerText = data.transporter_name;
        transporterSel.appendChild(matched);
      }
      transporterSel.selectedIndex = Array.from(transporterSel.options).indexOf(matched);
    }
    const truckEl = document.getElementById("input_truck_no");
    if (truckEl && data.truck_no) truckEl.value = data.truck_no;
    // The purchase's own unloading_location (where those goods arrived) is
    // where the onward sale shipment now loads from — and doubles as a
    // sensible default for the sale's own Unloading Location too, since a
    // "direct from purchase" sale is often shipped straight out from the
    // same site without a separate warehouse leg. Both stay editable.
    const loadingEl = document.getElementById("input_loading_location");
    if (loadingEl && data.loading_location) loadingEl.value = data.loading_location;
    const unloadingEl = document.getElementById("input_unloading_location");
    if (unloadingEl && data.loading_location) unloadingEl.value = data.loading_location;

    const items = data.items || [];
    const countEl = document.getElementById("lineItemCount");
    if (countEl) countEl.value = items.length || 1;
    renderLineItemRows("new_sale", items.length || 1);

    items.forEach((item, idx) => {
      const selProduct = document.getElementById(`li_product_type_${idx}`);
      if (selProduct) {
        let matched = Array.from(selProduct.options).find(
          o => o.value === item.product_type && (o.dataset.size || "") === (item.size || "")
        );
        if (!matched) {
          matched = document.createElement("option");
          matched.value = item.product_type;
          matched.dataset.size = item.size || "";
          matched.dataset.cost = item.unit_price || 0;
          matched.innerText = `${item.product_type} — ${item.size || ''} (from purchase ${inputInvoiceNo})`;
          selProduct.appendChild(matched);
        }
        selProduct.selectedIndex = Array.from(selProduct.options).indexOf(matched);
      }
      const sizeEl = document.getElementById(`li_size_${idx}`);
      if (sizeEl) sizeEl.value = item.size || "";
      const costEl = document.getElementById(`li_cost_price_${idx}`);
      if (costEl) costEl.value = item.unit_price || 0;
      const qtyEl = document.getElementById(`li_received_quantity_${idx}`);
      if (qtyEl) qtyEl.value = item.quantity || 0;
    });
    recalcLineItemTotals("new_sale");
  } catch (err) {
    alert("Failed to load purchase invoice: " + err.message);
  }
}

// Auto-fill Purchase Entry's supplier + product line items from a confirmed
// Purchase Order. Per the business requirement, everything else on the form
// stays editable but the supplier and each line item's product type are
// locked in place once a PO is linked — they came from a specific order the
// business placed and must not silently drift from it. Leaving the dropdown
// on "-- No Purchase Order --" re-renders the form fresh (fully unlocked).
async function applyPurchaseOrderToPurchase(purchaseOrderNo) {
  if (!purchaseOrderNo) { renderEntryForm("new_purchase"); return; }
  try {
    const res = await apiFetch(`/api/purchase_order/${encodeURIComponent(purchaseOrderNo)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Purchase order not found."); return; }

    const supplierSel = document.getElementById("input_supplier_name");
    if (supplierSel) {
      let matched = Array.from(supplierSel.options).find(o => o.value === data.supplier_name);
      if (!matched) {
        matched = document.createElement("option");
        matched.value = data.supplier_name;
        matched.innerText = data.supplier_name;
        supplierSel.appendChild(matched);
      }
      supplierSel.selectedIndex = Array.from(supplierSel.options).indexOf(matched);
      const mobileEl = document.getElementById("input_mobile_number");
      if (mobileEl) mobileEl.value = data.mobile_number || matched.dataset.contact || "";
      const addressEl = document.getElementById("input_address");
      if (addressEl) addressEl.value = matched.dataset.address || "";

      // Lock the supplier — customer name must not change once a PO is
      // linked. A disabled <select> is dropped from FormData on submit, so
      // its value is carried through a hidden mirror input instead.
      supplierSel.disabled = true;
      let hiddenSupplier = document.getElementById("po_locked_supplier_name");
      if (!hiddenSupplier) {
        hiddenSupplier = document.createElement("input");
        hiddenSupplier.type = "hidden";
        hiddenSupplier.id = "po_locked_supplier_name";
        hiddenSupplier.name = "supplier_name";
        supplierSel.insertAdjacentElement("afterend", hiddenSupplier);
      }
      hiddenSupplier.value = data.supplier_name || "";
    }

    // The PO's delivery address is where the supplier should deliver the
    // goods — the same place recorded as the Purchase Entry's own
    // Unloading Location.
    const unloadEl = document.getElementById("input_unloading_location");
    if (unloadEl && data.delivery_address) unloadEl.value = data.delivery_address;

    const items = data.items || [];
    const countEl = document.getElementById("lineItemCount");
    if (countEl) countEl.value = items.length || 1;
    renderLineItemRows("new_purchase", items.length || 1);

    items.forEach((item, idx) => {
      const selProduct = document.getElementById(`li_product_type_${idx}`);
      if (selProduct) {
        let matched = Array.from(selProduct.options).find(
          o => o.value === item.product_type && (o.dataset.size || "") === (item.size || "")
        );
        if (!matched) {
          matched = document.createElement("option");
          matched.value = item.product_type;
          matched.dataset.size = item.size || "";
          matched.innerText = `${item.product_type} — ${item.size || ''} (from purchase order)`;
          selProduct.appendChild(matched);
        }
        selProduct.selectedIndex = Array.from(selProduct.options).indexOf(matched);
        // Lock the product type — type of goods must not change once a PO
        // is linked. collectLineItems() reads .value via getElementById
        // directly (not FormData), so a disabled <select> still submits fine.
        selProduct.disabled = true;
      }
      const sizeEl = document.getElementById(`li_size_${idx}`);
      if (sizeEl) sizeEl.value = item.size || "";
      const qtyEl = document.getElementById(`li_quantity_${idx}`);
      if (qtyEl) qtyEl.value = item.quantity || 0;
      const priceEl = document.getElementById(`li_unit_price_${idx}`);
      if (priceEl) priceEl.value = item.unit_price || 0;
    });
    recalcLineItemTotals("new_purchase");
  } catch (err) {
    alert("Failed to load purchase order: " + err.message);
  }
}

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!currentEntryId) return;

  if (currentEntryId === "new_payment") {
    const shared = {
      payment_date: document.getElementById("pmt_date")?.value,
      txn_type: document.getElementById("pmt_txn_type")?.value,
      customer_name: document.getElementById("pmt_customer")?.value,
      notes: document.getElementById("pmt_notes")?.value
    };
    if (!shared.payment_date || !shared.txn_type || !shared.customer_name) {
      alert("Fill in Payment Date, Transaction Type, and Customer.");
      return;
    }
    const allocations = [];
    document.querySelectorAll(".pmt-bill-row").forEach(row => {
      const amt = parseFloat(row.querySelector(".pmt-bill-amount")?.value || 0);
      if (amt > 0) allocations.push({ reference_no: row.dataset.referenceNo, amount: amt });
    });
    if (allocations.length === 0) {
      alert("Enter an amount greater than 0 for at least one bill.");
      return;
    }

    const isEdit = !!paymentEditId;
    const url = isEdit ? `/api/payment/${paymentEditId}` : `/api/payment`;
    try {
      const res = await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: currentClientId, shared, allocations })
      });
      const data = await res.json();
      if (data.status === "success") {
        alert(isEdit ? "Payment updated successfully." : `Payment saved (BDT ${parseFloat(data.total_amount).toFixed(2)}).`);
        paymentEditId = null;
        resetCurrentForm();
      } else {
        alert("Error saving payment: " + data.message);
      }
    } catch (err) {
      alert("Connection failure: " + err.message);
    }
    return;
  }

  const form = document.getElementById("dynamicForm");
  const formData = new FormData(form);
  const payload = { client_id: currentClientId, created_by: currentUser ? currentUser.username : null };
  for (let [k, v] of formData.entries()) payload[k] = v;

  const isModifyTxn = (currentEntryId === "new_sale" || currentEntryId === "new_purchase") &&
    currentRecordMode === "Modify";
  const isModifyCustomer = currentEntryId === "new_customer" && currentRecordMode === "Modify";

  if (isModifyTxn) {
    if (!modifyTargetRef) { alert("Select a record to modify first."); return; }
    try {
      const res = await apiFetch(`/api/entry/${currentEntryId}/modify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: currentClientId,
          original_ref: modifyTargetRef,
          shared: payload,
          line_items: collectLineItems(currentEntryId)
        })
      });
      const data = await res.json();
      if (data.status === "success") {
        alert(`Record modified successfully (${data.chalan_no || data.input_invoice_no}).`);
        currentRecordMode = "New";
        modifyTargetRef = null;
        await refreshLookups();
        resetCurrentForm();
      } else {
        alert("Error modifying record: " + data.message);
      }
    } catch (err) {
      alert("Connection failure: " + err.message);
    }
    return;
  }

  if (isModifyCustomer) {
    if (!modifyTargetRef) { alert("Select a customer to modify first."); return; }
    try {
      const res = await apiFetch(`/api/record/customers/${modifyTargetRef}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === "success") {
        alert("Customer updated successfully.");
        currentRecordMode = "New";
        modifyTargetRef = null;
        await refreshLookups();
        resetCurrentForm();
      } else {
        alert("Error updating customer: " + data.message);
      }
    } catch (err) {
      alert("Connection failure: " + err.message);
    }
    return;
  }

  const isMultiItem = !!MULTI_ITEM_FIELDS[currentEntryId];
  const url = isMultiItem ? `/api/entry/${currentEntryId}/multi` : `/api/entry/${currentEntryId}`;
  const body = isMultiItem
    ? JSON.stringify({ client_id: currentClientId, shared: payload, line_items: collectLineItems(currentEntryId) })
    : JSON.stringify(payload);

  try {
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    const data = await res.json();

    if (data.status === "success") {
      const pendingNote = data.entry_status === "pending" ? " — PENDING ADMIN AUTHORIZATION." : "";
      const countNote = data.line_count > 1 ? ` (${data.line_count} products)` : "";
      const msg = data.chalan_no ? `Sale saved (Chalan #${data.chalan_no})${countNote}.${pendingNote}` :
                  data.input_invoice_no ? `Purchase saved (Invoice #${data.input_invoice_no})${countNote}.${pendingNote}` :
                  data.quotation_no ? `Quotation saved (${data.quotation_no})${countNote} — pending admin approval.` :
                  data.purchase_order_no ? `Purchase order saved (${data.purchase_order_no})${countNote} — pending admin confirmation.` :
                  `Record saved to table '${data.table}'.`;
      alert(msg);
      if (data.chalan_no) openInvoiceModal(data.chalan_no);
      if (data.quotation_no) openQuotationModal(data.quotation_no);
      if (data.purchase_order_no) openPurchaseOrderModal(data.purchase_order_no);
      await refreshLookups();
      resetCurrentForm();
    } else {
      alert("Error saving record: " + data.message);
    }
  } catch (err) {
    alert("Connection failure: " + err.message);
  }
}

// ---------------- REPORTS ----------------
async function renderReportView(reportId) {
  const rp = systemConfig.report_points.find(x => x.id === reportId);
  if (!rp) return;

  document.getElementById("pageTitle").innerText = rp.title;
  document.getElementById("pageSubtitle").innerText = `Query results for client ${currentClientId}.`;
  document.getElementById("reportTitle").innerHTML = `<i class="fa-solid ${rp.icon || 'fa-table'}"></i> ${rp.title}`;

  const periodFilter = document.getElementById("periodFilter");
  periodFilter.style.display = rp.supports_period ? "flex" : "none";
  const dateFilterWrap = document.getElementById("dateFilterWrap");
  if (dateFilterWrap) dateFilterWrap.style.display = rp.is_po_invoice_generator ? "none" : "contents";
  document.getElementById("customerFilterWrap").style.display = rp.supports_customer_filter ? "block" : "none";
  if (rp.supports_customer_filter) await populateReportCustomerFilter(reportId);
  const poFilterWrap = document.getElementById("poFilterWrap");
  if (poFilterWrap) {
    poFilterWrap.style.display = rp.supports_po_filter ? "block" : "none";
    if (rp.supports_po_filter) await populateReportPoFilter(reportId);
  }
  const txnTypeWrap = document.getElementById("txnTypeFilterWrap");
  if (txnTypeWrap) {
    txnTypeWrap.style.display = rp.supports_txn_type_filter ? "flex" : "none";
    if (!rp.supports_txn_type_filter) {
      const sel = document.getElementById("reportTxnTypeFilter");
      if (sel) sel.value = "All";
    }
  }
  const recordModeWrap = document.getElementById("recordModeFilterWrap");
  if (recordModeWrap) {
    recordModeWrap.style.display = rp.supports_record_mode ? "flex" : "none";
    if (!rp.supports_record_mode) {
      const sel = document.getElementById("reportRecordModeFilter");
      if (sel) sel.value = "New";
    }
  }

  // PO-wise Invoice is a generator, not a data table — swap the usual
  // report table/toolbar-actions/summary bar for a single "Generate
  // Invoice" button once Customer + PO are picked, reusing the same
  // customer/PO dropdown infrastructure every other filtered report uses.
  const tableWrap = document.getElementById("reportTableWrap");
  const genWrap = document.getElementById("poInvoiceGenerateWrap");
  const searchBoxWrap = document.getElementById("reportSearchBoxWrap");
  const tableActionsWrap = document.getElementById("reportTableActionsWrap");
  const summaryBar = document.getElementById("reportSummaryBar");
  if (rp.is_po_invoice_generator) {
    if (tableWrap) tableWrap.style.display = "none";
    if (searchBoxWrap) searchBoxWrap.style.display = "none";
    if (tableActionsWrap) tableActionsWrap.style.display = "none";
    if (summaryBar) summaryBar.style.display = "none";
    if (genWrap) genWrap.style.display = "block";
    return;
  }
  if (tableWrap) tableWrap.style.display = "";
  if (searchBoxWrap) searchBoxWrap.style.display = "";
  if (tableActionsWrap) tableActionsWrap.style.display = "contents";
  if (summaryBar) summaryBar.style.display = "";
  if (genWrap) genWrap.style.display = "none";

  await loadReportData(reportId);
}

const DELETABLE_REPORT_TABLES = {
  sales_report: "sales",
  purchases_report: "purchases",
  transporter_report: "transporters",
  inventory_report: "inventory",
  products_report: "products",
  customer_report: "customers",
  quotation_report: "quotations",
  purchase_order_report: "purchase_orders"
};

// Adjust (due date / advance delta) only makes sense for transaction tables
// that actually have due/advance columns — not inventory or product prices.
const ADJUSTABLE_REPORT_TABLES = {
  sales_report: "sales",
  purchases_report: "purchases",
  transporter_report: "transporters"
};

// Plain field edit (no derived totals/inventory side-effects) — master
// data only. Maps a report id to {table, entryPointId}: entryPointId
// points at the entry_point whose field list drives the edit modal's form.
const EDITABLE_REPORT_TABLES = {
  products_report: { table: "products", entryPointId: "new_product" },
  customer_report: { table: "customers", entryPointId: "new_customer" }
};

// Populates the report toolbar's Customer dropdown with the distinct
// names actually present in that report's own transaction data (not the
// customers catalog — see list_report_customer_options() for why), so
// every option is guaranteed to match something via the exact-match
// {customer_filter} the backend applies.
async function populateReportCustomerFilter(reportId) {
  const sel = document.getElementById("reportCustomerFilter");
  if (!sel) return;
  const prevValue = sel.value;
  try {
    const r = await apiFetch(`/api/report/${reportId}/customer_options?client_id=${currentClientId}`);
    const names = await r.json();
    sel.innerHTML = `<option value="">-- All Customers --</option>`;
    names.forEach(name => {
      const o = document.createElement("option");
      o.value = name; o.innerText = name;
      sel.appendChild(o);
    });
    if (prevValue && names.includes(prevValue)) sel.value = prevValue;
  } catch (e) { /* ignore */ }
}

// Populates the Total Sales Report's PO Order dropdown, scoped to whatever
// customer/date range is currently selected in the toolbar — so after
// picking a customer, the PO list narrows to just that customer's orders
// (cascading), and picking a PO then further narrows the report itself.
async function populateReportPoFilter(reportId) {
  const sel = document.getElementById("reportPoFilter");
  if (!sel) return;
  const prevValue = sel.value;
  const customer = document.getElementById("reportCustomerFilter")?.value || "";
  const df = document.getElementById("reportDateFrom")?.value || "";
  const dt = document.getElementById("reportDateTo")?.value || "";
  const params = new URLSearchParams({ client_id: currentClientId });
  if (customer) params.append("customer", customer);
  if (df) params.append("from", df);
  if (dt) params.append("to", dt);
  try {
    const r = await apiFetch(`/api/report/${reportId}/po_options?${params.toString()}`);
    const pos = await r.json();
    sel.innerHTML = `<option value="">-- All PO Orders --</option>`;
    pos.forEach(po => {
      const o = document.createElement("option");
      o.value = po; o.innerText = po;
      sel.appendChild(o);
    });
    if (prevValue && pos.includes(prevValue)) sel.value = prevValue;
  } catch (e) { /* ignore */ }
}

async function loadReportData(reportId) {
  const df = document.getElementById("reportDateFrom")?.value || "";
  const dt = document.getElementById("reportDateTo")?.value || "";
  const cust = document.getElementById("reportCustomerFilter")?.value || "";
  const po = document.getElementById("reportPoFilter")?.value || "";
  const txnType = document.getElementById("reportTxnTypeFilter")?.value || "";
  const recordMode = document.getElementById("reportRecordModeFilter")?.value || "";

  const params = new URLSearchParams({ client_id: currentClientId });
  if (df) params.append("from", df);
  if (dt) params.append("to", dt);
  if (cust) params.append("customer", cust);
  if (po) params.append("po_order", po);
  if (txnType && txnType !== "All") params.append("txn_type", txnType);
  if (recordMode) params.append("record_mode", recordMode);

  try {
    const res = await apiFetch(`/api/report/${reportId}?${params.toString()}`);
    const data = await res.json();
    if (data.status === "error") { alert("Report error: " + data.message); return; }

    currentReportRawData = data.data || [];
    currentReportColumns = data.columns || [];
    currentReportKeys = data.keys || [];

    const deleteTable = DELETABLE_REPORT_TABLES[reportId];
    const adjustTable = ADJUSTABLE_REPORT_TABLES[reportId];
    const editSpec = EDITABLE_REPORT_TABLES[reportId];
    const canDelete = deleteTable && currentPermissions && currentPermissions.can_delete;
    const canAdjust = adjustTable && currentUser && currentUser.role === 'admin';
    const canEdit = editSpec && currentUser && currentUser.role === 'admin';
    const canDownloadInvoice = reportId === 'sales_report';
    const canApproveQuotation = reportId === 'quotation_report' && currentUser && currentUser.role === 'admin';
    const canPrintQuotation = reportId === 'quotation_report';
    const canConfirmPurchaseOrder = reportId === 'purchase_order_report' && currentUser && currentUser.role === 'admin';
    const canPrintPurchaseOrder = reportId === 'purchase_order_report';
    const canUploadChallan = reportId === 'sales_report';
    const canEditPayment = reportId === 'payment_report' && currentUser && currentUser.role === 'admin';
    const canDeletePayment = reportId === 'payment_report' && currentUser && currentUser.role === 'admin';
    const showActions = canDelete || canAdjust || canEdit || canDownloadInvoice ||
      canApproveQuotation || canPrintQuotation || canConfirmPurchaseOrder || canPrintPurchaseOrder ||
      canUploadChallan || canEditPayment || canDeletePayment;

    const NUM_COLS = new Set(["qty","quantity","unit price","total","advance","due","rent","cost","price","amount","transport cost","profit","revenue","stock valuation","cost price","sale price"]);
    const theadTr = document.getElementById("reportTableHead");
    theadTr.innerHTML = "";
    data.columns.forEach(colName => {
      const th = document.createElement("th");
      th.innerText = colName;
      if (NUM_COLS.has(colName.toLowerCase())) th.style.textAlign = "right";
      theadTr.appendChild(th);
    });
    if (showActions) {
      const th = document.createElement("th");
      th.innerText = "Actions";
      theadTr.appendChild(th);
    }

    const tbody = document.getElementById("reportTableBody");
    tbody.innerHTML = "";

    if (currentReportRawData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${data.columns.length + (showActions ? 1 : 0)}" style="text-align:center; color:var(--text-muted);">No records found.</td></tr>`;
    } else {
      const keys = currentReportKeys;
      currentReportRawData.forEach(row => {
        const tr = document.createElement("tr");
        keys.forEach(k => {
          const td = document.createElement("td");
          const v = row[k];
          if (v !== null && v !== undefined && typeof v === "number") {
            td.innerText = parseFloat(v.toFixed(2));
            td.style.textAlign = "right";
            td.style.fontVariantNumeric = "tabular-nums";
          } else if (typeof v === "string" && /^https?:\/\//.test(v)) {
            const a = document.createElement("a");
            a.href = v; a.target = "_blank"; a.rel = "noopener"; a.innerText = "View File";
            td.appendChild(a);
          } else {
            td.innerText = v === null || v === undefined ? "" : v;
          }
          tr.appendChild(td);
        });
        if (showActions) {
          const td = document.createElement("td");
          td.style.whiteSpace = "nowrap";
          let html = "";
          if (canDownloadInvoice) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openInvoiceModal('${row.chalan_no}')"><i class="fa-solid fa-file-invoice"></i> Invoice</button>`;
          }
          if (canUploadChallan) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="promptChallanUpload('${row.chalan_no}', '${(row.buyer_name || '').replace(/'/g, "\\'")}', '${row.sale_date || ''}')"><i class="fa-solid fa-upload"></i> Challan</button>`;
          }
          if (canPrintQuotation) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openQuotationModal('${row.quotation_no}')"><i class="fa-solid fa-print"></i> Print</button>`;
          }
          if (canPrintPurchaseOrder) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openPurchaseOrderModal('${row.purchase_order_no}')"><i class="fa-solid fa-print"></i> Print</button>`;
          }
          if (canApproveQuotation && row.status === 'pending') {
            html += `<button class="btn btn-primary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="approveQuotationRow('${row.quotation_no}')"><i class="fa-solid fa-check"></i> Approve</button>`;
          }
          if (canConfirmPurchaseOrder && row.status === 'pending') {
            html += `<button class="btn btn-primary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="confirmPurchaseOrderRow('${row.purchase_order_no}')"><i class="fa-solid fa-check"></i> Confirm</button>`;
          }
          if (canEdit) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openEditRecordModalFromReport('${reportId}', ${row.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>`;
          }
          if (canAdjust) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="openAdjustModal('${adjustTable}', ${row.id})"><i class="fa-solid fa-pen"></i> Adjust</button>`;
          }
          if (canDelete) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; color:var(--accent-rose);" onclick="deleteReportRecord('${deleteTable}', ${row.id}, '${reportId}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
          }
          if (canEditPayment) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="editPaymentFromReport(${row.id})"><i class="fa-solid fa-pen-to-square"></i> Edit</button>`;
          }
          if (canDeletePayment) {
            html += `<button class="btn btn-secondary" style="padding:4px 10px; font-size:11px; color:var(--accent-rose);" onclick="deletePaymentFromReport(${row.id})"><i class="fa-solid fa-trash"></i> Delete</button>`;
          }
          td.innerHTML = html;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    }

    document.getElementById("summaryCount").innerText = currentReportRawData.length;
    if (data.summary_column) {
      document.getElementById("summaryTitle").innerText = `Total ${data.summary_column.replace(/_/g, ' ').toUpperCase()}:`;
      document.getElementById("summaryValue").innerText = `BDT ${(data.summary_total || 0).toFixed(2)}`;
    } else {
      document.getElementById("summaryTitle").innerText = `Summary:`;
      document.getElementById("summaryValue").innerText = `-`;
    }
  } catch (err) {
    console.error("Report execution error:", err);
  }
}

// ---------------- PENDING AUTHORIZATIONS ----------------
async function loadPendingAuthorizations() {
  try {
    const res = await apiFetch(`/api/pending?client_id=${currentClientId}`);
    const data = await res.json();

    const purTbody = document.querySelector("#pendingPurchasesTable tbody");
    purTbody.innerHTML = "";
    if (!data.purchases || data.purchases.length === 0) {
      purTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No pending purchases.</td></tr>`;
    } else {
      data.purchases.forEach(p => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${p.input_invoice_no}</strong></td>
          <td>${p.purchase_date}</td>
          <td>${p.supplier_name}</td>
          <td>${p.product_type}</td>
          <td>${p.size || '-'}</td>
          <td>${p.quantity}</td>
          <td>BDT ${parseFloat(p.total).toFixed(2)}</td>
          <td>${p.created_by || '-'}</td>
          <td><button class="btn btn-primary" style="padding:4px 10px; font-size:11px;" onclick="authorizeTransaction('purchases', ${p.id})"><i class="fa-solid fa-check"></i> Authorize</button></td>
        `;
        purTbody.appendChild(tr);
      });
    }

    const salTbody = document.querySelector("#pendingSalesTable tbody");
    salTbody.innerHTML = "";
    if (!data.sales || data.sales.length === 0) {
      salTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No pending sales.</td></tr>`;
    } else {
      data.sales.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${s.chalan_no}</strong></td>
          <td>${s.sale_date}</td>
          <td>${s.buyer_name}</td>
          <td>${s.product_type}</td>
          <td>${s.size || '-'}</td>
          <td>${s.received_quantity}</td>
          <td>BDT ${parseFloat(s.sale_total_price).toFixed(2)}</td>
          <td>${s.created_by || '-'}</td>
          <td><button class="btn btn-primary" style="padding:4px 10px; font-size:11px;" onclick="authorizeTransaction('sales', ${s.id})"><i class="fa-solid fa-check"></i> Authorize</button></td>
        `;
        salTbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error("Error loading pending authorizations:", err);
  }
}

async function authorizeTransaction(table, id) {
  if (!confirm("Authorize this transaction? This will update inventory and include it in reports.")) return;
  try {
    const res = await apiFetch(`/api/authorize/${table}/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorized_by: currentUser ? currentUser.username : null, client_id: currentClientId })
    });
    const data = await res.json();
    if (data.status === "success") {
      await refreshLookups();
      loadPendingAuthorizations();
    } else {
      alert("Authorization failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

function formatNumber(n) {
  if (!isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

// ---------------- ADMIN ADJUST (due date + additive advance) ----------------
let adjustTargetTable = null;
let adjustTargetId = null;

function openAdjustModal(table, id) {
  adjustTargetTable = table;
  adjustTargetId = id;
  document.getElementById("adjustDueDate").value = "";
  document.getElementById("adjustAdvanceDelta").value = "";
  document.getElementById("adjustEntryModal").classList.add("active");
}

function closeAdjustModal() {
  document.getElementById("adjustEntryModal").classList.remove("active");
  adjustTargetTable = null;
  adjustTargetId = null;
}

async function submitAdjustEntry() {
  const payment_due_date = document.getElementById("adjustDueDate").value || null;
  const advanceVal = document.getElementById("adjustAdvanceDelta").value;
  const additional_advance = advanceVal === "" ? null : parseFloat(advanceVal);

  if (payment_due_date === null && additional_advance === null) {
    alert("Enter a new due date and/or an additional advance amount.");
    return;
  }

  try {
    const res = await apiFetch(`/api/record/${adjustTargetTable}/${adjustTargetId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requested_by: currentUser ? currentUser.username : null,
        client_id: currentClientId,
        payment_due_date,
        additional_advance
      })
    });
    const data = await res.json();
    if (data.status === "success") {
      closeAdjustModal();
      if (currentReportId) loadReportData(currentReportId);
    } else {
      alert("Adjustment failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

// ---------------- EDIT RECORD (products / customers) ----------------
let editRecordTarget = { table: null, id: null };

function openEditRecordModalFromReport(reportId, id) {
  const spec = EDITABLE_REPORT_TABLES[reportId];
  if (!spec) return;
  const row = currentReportRawData.find(r => r.id === id);
  if (!row) return;
  openEditRecordModal(spec.table, spec.entryPointId, row);
}

function openEditRecordModal(table, entryPointId, row) {
  editRecordTarget = { table, id: row.id };
  const ep = systemConfig.entry_points.find(e => e.id === entryPointId);
  if (!ep) return;

  const container = document.getElementById("editRecordFieldsContainer");
  container.innerHTML = "";
  ep.fields.forEach(f => {
    const group = document.createElement("div");
    group.className = "form-group";
    group.style.marginTop = "14px";
    const label = document.createElement("label");
    label.innerText = f.label;
    group.appendChild(label);

    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      input.className = "form-control";
      f.options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt; o.innerText = opt;
        input.appendChild(o);
      });
      input.value = row[f.name] ?? "";
    } else {
      input = document.createElement("input");
      input.type = f.type === "number" ? "number" : "text";
      input.className = "form-control";
      if (f.type === "number") input.step = "any";
      input.value = row[f.name] ?? "";
    }
    input.id = `er_${f.name}`;
    group.appendChild(input);
    container.appendChild(group);
  });

  document.getElementById("editRecordModal").classList.add("active");
}

function closeEditRecordModal() {
  document.getElementById("editRecordModal").classList.remove("active");
  editRecordTarget = { table: null, id: null };
}

async function submitEditRecord() {
  const { table, id } = editRecordTarget;
  if (!table || !id) return;

  const spec = Object.values(EDITABLE_REPORT_TABLES).find(s => s.table === table);
  const ep = systemConfig.entry_points.find(e => e.id === spec.entryPointId);
  const payload = { client_id: currentClientId };
  ep.fields.forEach(f => {
    const el = document.getElementById(`er_${f.name}`);
    if (el) payload[f.name] = el.value;
  });

  try {
    const res = await apiFetch(`/api/record/${table}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === "success") {
      closeEditRecordModal();
      await refreshLookups();
      if (currentReportId) loadReportData(currentReportId);
    } else {
      alert("Update failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

// Mirrors switchEntryTab()'s tab-switching but deliberately skips its
// paymentEditId reset (and awaits the render) so the edit target survives
// into renderPaymentEntryForm() — calling switchEntryTab() itself here
// would race its own un-awaited render against this one.
async function editPaymentFromReport(paymentId) {
  currentTab = "entry-form";
  currentEntryId = "new_payment";
  currentRecordMode = "New";
  modifyTargetRef = null;
  paymentEditId = paymentId;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelector('.nav-item[data-tab="entry-new_payment"]')?.classList.add("active");
  document.querySelectorAll(".tab-view").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-entry-form").classList.add("active");
  await renderEntryForm("new_payment");
}

async function deletePaymentFromReport(paymentId) {
  if (!confirm("Delete this payment? The amount will be added back to the relevant bill's outstanding due.")) return;
  try {
    const res = await apiFetch(`/api/payment/${paymentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClientId })
    });
    const data = await res.json();
    if (data.status === "success") {
      loadReportData("payment_report");
    } else {
      alert("Delete failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

async function deleteReportRecord(table, id, reportId) {
  if (!confirm("Delete this record? If it was already authorized, inventory will be adjusted back.")) return;
  try {
    const res = await apiFetch(`/api/record/${table}/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requested_by: currentUser ? currentUser.username : null, client_id: currentClientId })
    });
    const data = await res.json();
    if (data.status === "success") {
      await refreshLookups();
      loadReportData(reportId);
    } else {
      alert("Delete failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

function applyReportFilters() { if (currentReportId) loadReportData(currentReportId); }
function clearReportFilters() {
  document.getElementById("reportDateFrom").value = "";
  document.getElementById("reportDateTo").value = "";
  const c = document.getElementById("reportCustomerFilter"); if (c) c.value = "";
  const p = document.getElementById("reportPoFilter"); if (p) p.value = "";
  const t = document.getElementById("reportTxnTypeFilter"); if (t) t.value = "All";
  const r = document.getElementById("reportRecordModeFilter"); if (r) r.value = "New";
  if (currentReportId) {
    populateReportPoFilter(currentReportId);
    loadReportData(currentReportId);
  }
}

async function approveQuotationRow(quotationNo) {
  if (!confirm(`Approve quotation ${quotationNo}? It will then be selectable for linking into a Sales Entry.`)) return;
  try {
    const res = await apiFetch(`/api/quotation/${encodeURIComponent(quotationNo)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClientId })
    });
    const data = await res.json();
    if (data.status === "success") {
      if (currentReportId) loadReportData(currentReportId);
    } else {
      alert("Approval failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

async function confirmPurchaseOrderRow(purchaseOrderNo) {
  if (!confirm(`Confirm purchase order ${purchaseOrderNo}? It will then be selectable for linking into a Purchase Entry.`)) return;
  try {
    const res = await apiFetch(`/api/purchase_order/${encodeURIComponent(purchaseOrderNo)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: currentClientId })
    });
    const data = await res.json();
    if (data.status === "success") {
      if (currentReportId) loadReportData(currentReportId);
    } else {
      alert("Confirmation failed: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

// ---------------- CHALLAN FILE UPLOAD (Google Drive) ----------------
function promptChallanUpload(chalanNo, buyerName, saleDate) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.style.display = "none";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    document.body.removeChild(input);
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("client_id", currentClientId);
    formData.append("buyer_name", buyerName || "Customer");
    formData.append("sale_date", saleDate || "");
    try {
      const res = await apiFetch(`/api/sales/${encodeURIComponent(chalanNo)}/challan`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (data.status === "success") {
        alert("Challan file uploaded to Google Drive.");
        if (currentReportId) loadReportData(currentReportId);
      } else {
        alert("Upload failed: " + data.message);
      }
    } catch (err) {
      alert("Connection error: " + err.message);
    }
  };
  document.body.appendChild(input);
  input.click();
}

function filterReportTable() {
  const query = document.getElementById("reportSearchInput").value.toLowerCase();
  document.querySelectorAll("#reportTableBody tr").forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(query) ? "" : "none";
  });
}

function exportReportCSV() {
  if (!currentReportRawData || currentReportRawData.length === 0) {
    alert("No data available to export."); return;
  }
  const keys = currentReportKeys;
  let csv = keys.join(",") + "\n";
  currentReportRawData.forEach(row => {
    csv += keys.map(k => {
      const v = row[k];
      return `"${(v === null || v === undefined ? '' : v).toString().replace(/"/g, '""')}"`;
    }).join(",") + "\n";
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", `Report_${currentReportId}_${currentClientId}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Builds the full standalone HTML document used for both printReportTable()
// (opened in a real browser window/print dialog) and saveReportAsPDF()
// (rendered off-screen in an iframe and rasterized into a downloadable PDF)
// so the two stay visually identical.
function buildReportPrintDocument() {
  const lh = systemConfig && systemConfig.letterhead ? systemConfig.letterhead : {};
  const companyName = lh.company_name || "JAHAN TRADING CO.";
  const companyAddress = lh.address || "";
  const companyPhone = lh.phone || "";
  const reportTitleEl = document.getElementById("reportTitle");
  const reportTitle = reportTitleEl ? reportTitleEl.innerText.replace(/\s+/g, ' ').trim() : 'Report';

  const NUM_COLS = new Set(["qty","quantity","unit price","total","advance","due","rent","cost","price","amount","transport cost","profit","revenue","stock valuation","cost price","sale price","total cost","total revenue","net profit","total amount","total advance","total due"]);
  const keys = currentReportKeys;
  const isNumCol = currentReportColumns.map(c => NUM_COLS.has(c.toLowerCase()));

  const headerRow = currentReportColumns.map((c, i) =>
    `<th style="${isNumCol[i] ? 'text-align:right;' : ''}">${c}</th>`
  ).join('');

  const dataRows = currentReportRawData.map(row =>
    `<tr>${keys.map((k, i) => {
      const v = row[k];
      const isNum = typeof v === 'number';
      const display = v === null || v === undefined ? '' : (isNum ? parseFloat(v.toFixed(2)) : v);
      return `<td style="${(isNum || isNumCol[i]) ? 'text-align:right; font-variant-numeric:tabular-nums;' : ''}">${display}</td>`;
    }).join('')}</tr>`
  ).join('');

  const dfVal = document.getElementById("reportDateFrom")?.value || '';
  const dtVal = document.getElementById("reportDateTo")?.value || '';
  const txnVal = document.getElementById("reportTxnTypeFilter")?.value || '';
  let filterStr = '';
  if (dfVal || dtVal) filterStr += ` | ${dfVal || '—'} to ${dtVal || '—'}`;
  if (txnVal && txnVal !== 'All') filterStr += ` | Type: ${txnVal}`;

  const summaryLabel = document.getElementById('summaryTitle')?.innerText || '';
  const summaryVal = document.getElementById('summaryValue')?.innerText || '';

  return {
    title: reportTitle,
    html: `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>${reportTitle}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; background: #fff; }
      .header { border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
      .header h1 { font-size: 20px; font-weight: 800; color: #0f172a; }
      .header h2 { font-size: 13px; font-weight: 600; color: #475569; margin-top: 2px; }
      .header .sub { font-size: 10px; color: #64748b; margin-top: 2px; }
      .meta { display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      thead tr { background: #f1f5f9; }
      th { padding: 8px 10px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; border: 1px solid #cbd5e1; white-space: nowrap; text-align: left; }
      td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
      tr:nth-child(even) td { background: #f8fafc; }
      .summary { margin-top: 14px; text-align: right; font-size: 12px; font-weight: 700; color: #0f172a; border-top: 2px solid #0f172a; padding-top: 8px; }
      .count { float: left; font-weight: normal; color: #475569; }
      @media print {
        body { padding: 10px; font-size: 10px; }
        th { font-size: 8px; padding: 6px 8px; }
        td { font-size: 10px; padding: 5px 8px; }
        @page { margin: 10mm; size: A4 landscape; }
      }
    </style>
  </head><body>
    <div class="header">
      <h1>${companyName}</h1>
      <h2>${reportTitle}${filterStr}</h2>
      ${companyAddress ? `<div class="sub">${companyAddress}${companyPhone ? ' | ' + companyPhone : ''}</div>` : ''}
    </div>
    <div class="meta">
      <span>Client: ${currentClientId}</span>
      <span>Printed: ${new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})}</span>
    </div>
    <table><thead><tr>${headerRow}</tr></thead><tbody>${dataRows}</tbody></table>
    <div class="summary">
      <span class="count">Total Records: ${currentReportRawData.length}</span>
      ${summaryLabel} ${summaryVal}
    </div>
  </body></html>`
  };
}

function printReportTable() {
  if (!currentReportRawData || currentReportRawData.length === 0) {
    alert("No data to print."); return;
  }
  const doc = buildReportPrintDocument();
  const printWin = window.open('', '_blank', 'width=1200,height=850');
  if (!printWin) { alert("Pop-up blocked — please allow pop-ups for printing."); return; }
  printWin.document.write(doc.html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 600);
}

// "Save" renders the same report document off-screen in a hidden iframe
// (kept style-isolated from the app's own dark theme), rasterizes it with
// html2canvas, and slices the result across as many A4 pages as needed —
// producing an actual downloadable PDF file instead of going through the
// browser's print dialog.
async function saveReportAsPDF() {
  if (!currentReportRawData || currentReportRawData.length === 0) {
    alert("No data to save."); return;
  }
  const doc = buildReportPrintDocument();
  const iframe = document.createElement('iframe');
  iframe.style.cssText = "position:fixed; left:-99999px; top:0; width:1200px; height:800px; border:none;";
  document.body.appendChild(iframe);

  try {
    iframe.contentDocument.open();
    iframe.contentDocument.write(doc.html);
    iframe.contentDocument.close();
    await new Promise(resolve => setTimeout(resolve, 400));

    const canvas = await html2canvas(iframe.contentDocument.body, { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`${doc.title.replace(/[^\w\-]+/g, '_')}_${currentClientId}.pdf`);
  } catch (err) {
    alert("Could not save PDF: " + err.message);
  } finally {
    document.body.removeChild(iframe);
  }
}

// Single-page PDF export for the invoice/quotation business pad. The page
// is forced to the pad's true physical size — US Letter, 612x792pt/8.5x11in
// (confirmed from the client's actual reference PDF) — rather than derived
// from whatever pixel size html2canvas happens to capture. Capturing at a
// size not proportional to 612:792 (e.g. picking up a scrollbar, or a
// sub-pixel rounding difference from the CSS aspect-ratio box) was the
// source of the visible border/misalignment in the exported PDF.
async function saveElementAsPDF(elementId, filenameBase) {
  const el = document.getElementById(elementId);
  if (!el) return;

  // The modal is normally capped to max-height:90vh (with a scrollbar) so it
  // fits a small screen — left in place, that cap would compress the pad
  // below its true 612:792 aspect ratio during capture, and the scrollbar
  // itself would get rasterized as a stray border. Both are lifted here and
  // restored afterward.
  const container = el.closest('.invoice-modal-container');
  const prevPadOverflow = el.style.overflow;
  const prevPadHeight = el.style.height;
  const prevContainerMaxHeight = container ? container.style.maxHeight : null;
  const prevContainerOverflow = container ? container.style.overflow : null;

  el.style.overflow = "hidden";
  if (container) {
    container.style.maxHeight = "none";
    container.style.overflow = "visible";
  }

  try {
    const captureWidthPx = Math.round(el.clientWidth) || 850;
    const captureHeightPx = Math.round(captureWidthPx * PAD_PAGE_HEIGHT_PT / PAD_PAGE_WIDTH_PT);
    // The `aspect-ratio` CSS property alone isn't reliably respected inside
    // html2canvas's internal clone (confirmed by testing — the live DOM
    // measures correctly, but the captured canvas came out shorter,
    // crowding the totals box into the signature row below). Pinning an
    // explicit pixel height removes that ambiguity entirely.
    el.style.height = `${captureHeightPx}px`;
    void el.clientWidth; // force a synchronous reflow before capture

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      width: captureWidthPx,
      height: captureHeightPx,
      windowWidth: captureWidthPx,
      windowHeight: captureHeightPx
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [PAD_PAGE_WIDTH_PT, PAD_PAGE_HEIGHT_PT] });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', 0, 0, PAD_PAGE_WIDTH_PT, PAD_PAGE_HEIGHT_PT);
    pdf.save(`${(filenameBase || 'Document').replace(/[^\w\-]+/g, '_')}.pdf`);
  } catch (err) {
    // Most likely cause: the pad's background image is hosted somewhere
    // (e.g. Google Drive) that doesn't allow cross-origin canvas reads —
    // Print still works in that case since it doesn't need to read pixels back.
    alert("Could not save PDF (the pad background image may not allow this) — try Print instead. " + err.message);
  } finally {
    el.style.overflow = prevPadOverflow;
    el.style.height = prevPadHeight;
    if (container) {
      container.style.maxHeight = prevContainerMaxHeight;
      container.style.overflow = prevContainerOverflow;
    }
  }
}

// ---------------- INVOICE ----------------
async function openInvoiceModal(invoiceRef) {
  if (!invoiceRef) return;
  try {
    const res = await apiFetch(`/api/invoice/${encodeURIComponent(invoiceRef)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Invoice not found."); return; }

    const sale = data.sale;
    const lh = data.letterhead;
    const padPaper = document.getElementById("invoicePadPaper");
    const headerArea = document.getElementById("padHeaderArea");

    const ribbon = document.getElementById("padPendingRibbon");
    if (ribbon) ribbon.style.display = sale.status === "pending" ? "block" : "none";

    const padDivider = document.getElementById("padDividerLine");

    // The uploaded pad image IS the page — invoice content prints as an
    // overlay on top of it (like text on a pre-printed letterhead sheet),
    // not as a separate block stacked above/below the artwork.
    applyPadBackground(padPaper, headerArea, padDivider, lh, {
      companyTitleId: "padCompanyTitle", subHeadingId: "padSubHeading", contactLineId: "padContactLine"
    });

    document.getElementById("padCustName").innerText = sale.buyer_name || "-";
    document.getElementById("padCustAddress").innerText = sale.address || "";
    document.getElementById("padCustPhone").innerText = sale.contact_number ? `Phone: ${sale.contact_number}` : "";
    document.getElementById("padInvNo").innerText = sale.chalan_no || "-";
    document.getElementById("padInvDate").innerText = sale.sale_date || "-";
    document.getElementById("padPoOrder").innerText = sale.po_order || "-";

    // A multi-product sale shares one chalan_no across several rows —
    // data.items holds all of them (single-product sales just have one).
    const items = (data.items && data.items.length) ? data.items : [sale];
    let grand = 0, totalAdvance = 0, totalDue = 0;
    const rowsHtml = items.map((item, i) => {
      const qty = parseFloat(item.received_quantity || 0);
      const price = parseFloat(item.sale_unit_price || 0);
      const rowSubtotal = qty * price;
      grand += rowSubtotal;
      totalAdvance += parseFloat(item.advance || 0);
      totalDue += parseFloat(item.due || 0);
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${item.product_type || '-'}</strong></td>
        <td>${item.size || '-'}</td>
        <td style="text-align:center;">${qty}</td>
        <td>${item.unloading_location || '-'}</td>
        <td style="text-align:right;">${price.toFixed(2)}</td>
        <td style="text-align:right;"><strong>${rowSubtotal.toFixed(2)}</strong></td>
      </tr>`;
    }).join('');
    document.getElementById("padItemsBody").innerHTML = rowsHtml;

    const transportBits = [];
    if (sale.transporter_name) transportBits.push(`Transporter: ${sale.transporter_name}`);
    if (sale.truck_no) transportBits.push(`Truck: ${sale.truck_no}`);
    document.getElementById("padTransport").innerText = transportBits.length ? transportBits.join(' | ') : '-';

    document.getElementById("padSubtotal").innerText = `BDT ${grand.toFixed(2)}`;
    document.getElementById("padAdvance").innerText = `BDT ${totalAdvance.toFixed(2)}`;
    document.getElementById("padDue").innerText = `BDT ${totalDue.toFixed(2)}`;
    document.getElementById("padGrandTotal").innerText = `BDT ${grand.toFixed(2)}`;
    document.getElementById("padFooterNote").innerText = lh.footer_note || "Thank you for your business!";

    document.getElementById("invoiceModal").classList.add("active");
  } catch (err) {
    alert("Failed to load invoice: " + err.message);
  }
}

function openQuickSaleTab() { switchEntryTab("new_sale"); }

function promptInvoiceLookup() {
  const ref = prompt("Enter Chalan No or Sale ID:");
  if (ref) openInvoiceModal(ref.trim());
}

function closeInvoiceModal() {
  document.getElementById("invoiceModal").classList.remove("active");
}

// ---------------- PO-WISE INVOICE PAD ----------------
// A single combined invoice across every chalan a customer has against one
// PO Order — reuses the same .business-pad-paper/.pad-* styling and
// applyPadBackground() as the per-chalan invoice/quotation pads, but (like
// the quotation pad) grows to fit an unbounded number of rows instead of
// being locked to one fixed physical-pad page.
async function generatePoInvoice() {
  const customer = document.getElementById("reportCustomerFilter")?.value;
  const poOrder = document.getElementById("reportPoFilter")?.value;
  if (!customer) { alert("Select a Customer first."); return; }
  if (!poOrder) { alert("Select a PO Order first."); return; }
  try {
    const res = await apiFetch(`/api/po_invoice?customer=${encodeURIComponent(customer)}&po_order=${encodeURIComponent(poOrder)}&client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert(data.message || "No invoice data found."); return; }

    // Unlike the other two pads, this one uses the client's own
    // pre-designed pad artwork (static po_pad_header/footer/watermark
    // images — see style.css) instead of applyPadBackground()'s
    // letterhead-settings-driven text header, so there's no company-name/
    // contact text to populate here.
    const lh = data.letterhead;

    document.getElementById("poiCustName").innerText = data.customer_name || "-";
    document.getElementById("poiCustAddress").innerText = data.address || "";
    document.getElementById("poiPoOrder").innerText = data.po_order || "-";
    document.getElementById("poiGenDate").innerText = new Date().toISOString().split('T')[0];

    const rowsHtml = data.items.map((item, i) => {
      const qty = parseFloat(item.received_quantity || 0);
      const price = parseFloat(item.sale_unit_price || 0);
      const amount = parseFloat(item.sale_total_price || 0);
      return `
      <tr>
        <td>${i + 1}</td>
        <td>${item.sale_date || '-'}</td>
        <td>${item.chalan_no || '-'}</td>
        <td><strong>${item.product_type || '-'}</strong></td>
        <td>${item.size || '-'}</td>
        <td style="text-align:center;"><strong>${qty}</strong></td>
        <td>${item.truck_no || '-'}</td>
        <td>${item.unloading_location || '-'}</td>
        <td style="text-align:right;">${price.toFixed(2)}</td>
        <td style="text-align:right;"><strong>${amount.toFixed(2)}</strong></td>
      </tr>`;
    }).join('');
    document.getElementById("poiItemsBody").innerHTML = rowsHtml;

    document.getElementById("poiTotalQuantity").innerText = parseFloat(data.total_quantity || 0);
    document.getElementById("poiTotalAmount").innerText = `BDT ${parseFloat(data.total_amount || 0).toFixed(2)}`;
    document.getElementById("poiTotalAdvance").innerText = `BDT ${parseFloat(data.total_advance || 0).toFixed(2)}`;
    document.getElementById("poiTotalDue").innerText = `BDT ${parseFloat(data.total_due || 0).toFixed(2)}`;
    document.getElementById("poiFooterNote").innerText = lh.footer_note || "Thank you for doing business with Jahan Trading!";

    document.getElementById("poInvoiceModal").classList.add("active");
  } catch (err) {
    alert("Failed to generate invoice: " + err.message);
  }
}

function closePoInvoiceModal() {
  document.getElementById("poInvoiceModal").classList.remove("active");
}

// Renders a loaded <img> element to a same-origin PNG data URL so jsPDF
// gets a guaranteed-decodable image source, rather than relying on its own
// format sniffing of an HTMLImageElement passed directly.
function imageElementToDataUrl(imgEl) {
  const canvas = document.createElement('canvas');
  canvas.width = imgEl.naturalWidth;
  canvas.height = imgEl.naturalHeight;
  canvas.getContext('2d').drawImage(imgEl, 0, 0);
  return canvas.toDataURL('image/png');
}

// The header/footer pad artwork must repeat on EVERY page of a multi-page
// PO invoice, not just appear once at the top/bottom of one long canvas
// (which is what naively rasterizing #poiPadPaper as a whole and slicing it
// would produce — see the earlier single-canvas-slice approach used by
// saveElementAsPDF()/saveQuotationAsPDF(), which is fine for content that's
// always short but wrong here since a PO can span many chalans/pages).
// Instead: capture the header/footer images once, capture just the
// scrollable body (.poi-content) as one tall canvas, then plan pages by
// measuring each table row's own pixel bounds in the LIVE DOM (not a fixed
// arithmetic page height) so a slice boundary always falls BETWEEN rows,
// never through one — a naive fixed-height slice cut rows in half, leaving
// a truncated fragment trapped under the footer bar on one page and the
// same row repeated in full at the top of the next. The table header
// repeats on every page too, and the totals/signature/footer-note block is
// kept atomic (pushed onto a fresh page if it wouldn't fit whole).
async function savePoInvoiceAsPDF() {
  const el = document.getElementById('poiPadPaper');
  if (!el) return;
  const container = el.closest('.invoice-modal-container');
  const prevContainerMaxHeight = container ? container.style.maxHeight : null;
  const prevContainerOverflow = container ? container.style.overflow : null;
  const prevElOverflow = el.style.overflow;
  if (container) { container.style.maxHeight = "none"; container.style.overflow = "visible"; }
  el.style.overflow = "visible";

  try {
    const headerImgEl = document.querySelector('.poi-header-img');
    const footerImgEl = document.querySelector('.poi-footer-img');
    const bodyEl = document.querySelector('.poi-content');
    const theadEl = bodyEl.querySelector('.pad-table thead');
    const totalsRowEl = bodyEl.querySelector('.pad-totals-row');
    const rowEls = Array.from(document.getElementById('poiItemsBody').children);

    const headerHeightPt = PAD_PAGE_WIDTH_PT * (headerImgEl.naturalHeight / headerImgEl.naturalWidth);
    const footerHeightPt = PAD_PAGE_WIDTH_PT * (footerImgEl.naturalHeight / footerImgEl.naturalWidth);
    const budgetPt = PAD_PAGE_HEIGHT_PT - headerHeightPt - footerHeightPt;

    const headerDataUrl = imageElementToDataUrl(headerImgEl);
    const footerDataUrl = imageElementToDataUrl(footerImgEl);

    const bodyCanvas = await html2canvas(bodyEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pxPerPt = bodyCanvas.width / PAD_PAGE_WIDTH_PT;
    const budgetPx = budgetPt * pxPerPt;

    // Measure every region's canvas-pixel [top, bottom) from the live DOM,
    // relative to bodyEl's own top edge, scaled by the same factor
    // html2canvas used to rasterize it.
    const contentRect = bodyEl.getBoundingClientRect();
    const canvasScaleY = bodyCanvas.height / contentRect.height;
    const regionPx = (rect) => ({
      top: (rect.top - contentRect.top) * canvasScaleY,
      bottom: (rect.bottom - contentRect.top) * canvasScaleY
    });
    const thead = regionPx(theadEl.getBoundingClientRect());
    const trailing = { top: regionPx(totalsRowEl.getBoundingClientRect()).top, bottom: bodyCanvas.height };
    const meta = { top: 0, bottom: thead.top };
    const rows = rowEls.map(tr => regionPx(tr.getBoundingClientRect()));

    const theadHeightPx = thead.bottom - thead.top;
    const metaHeightPx = meta.bottom - meta.top;
    const trailingHeightPx = trailing.bottom - trailing.top;

    // Plan which rows land on which page — a new page starts only between
    // rows, never mid-row, and the trailing block only joins the last page
    // if it fits whole.
    const pages = [];
    let currentRowIdxs = [];
    let usedPx = metaHeightPx + theadHeightPx;
    let isFirstPage = true;
    for (let i = 0; i < rows.length; i++) {
      const rowHeightPx = rows[i].bottom - rows[i].top;
      if (currentRowIdxs.length > 0 && usedPx + rowHeightPx > budgetPx) {
        pages.push({ rowIdxs: currentRowIdxs, includeMeta: isFirstPage, includeTrailing: false });
        currentRowIdxs = [];
        isFirstPage = false;
        usedPx = theadHeightPx;
      }
      currentRowIdxs.push(i);
      usedPx += rowHeightPx;
    }
    if (usedPx + trailingHeightPx <= budgetPx) {
      pages.push({ rowIdxs: currentRowIdxs, includeMeta: isFirstPage, includeTrailing: true });
    } else {
      pages.push({ rowIdxs: currentRowIdxs, includeMeta: isFirstPage, includeTrailing: false });
      pages.push({ rowIdxs: [], includeMeta: false, includeTrailing: true });
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [PAD_PAGE_WIDTH_PT, PAD_PAGE_HEIGHT_PT] });

    pages.forEach((pageDef, pageIdx) => {
      if (pageIdx > 0) pdf.addPage();

      let pageHeightPx = theadHeightPx;
      if (pageDef.includeMeta) pageHeightPx += metaHeightPx;
      pageDef.rowIdxs.forEach(i => { pageHeightPx += rows[i].bottom - rows[i].top; });
      if (pageDef.includeTrailing) pageHeightPx += trailingHeightPx;

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = bodyCanvas.width;
      pageCanvas.height = Math.max(1, pageHeightPx);
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

      let dy = 0;
      const stamp = (region) => {
        const h = region.bottom - region.top;
        ctx.drawImage(bodyCanvas, 0, region.top, bodyCanvas.width, h, 0, dy, bodyCanvas.width, h);
        dy += h;
      };
      if (pageDef.includeMeta) stamp(meta);
      stamp(thead);
      pageDef.rowIdxs.forEach(i => stamp(rows[i]));
      if (pageDef.includeTrailing) stamp(trailing);

      const pageHeightPt = pageHeightPx / pxPerPt;
      pdf.addImage(headerDataUrl, 'PNG', 0, 0, PAD_PAGE_WIDTH_PT, headerHeightPt);
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, headerHeightPt, PAD_PAGE_WIDTH_PT, pageHeightPt);
      pdf.addImage(footerDataUrl, 'PNG', 0, PAD_PAGE_HEIGHT_PT - footerHeightPt, PAD_PAGE_WIDTH_PT, footerHeightPt);
    });

    pdf.save(`PO_Invoice_${(document.getElementById('poiPoOrder')?.innerText || 'po')}.pdf`);
  } catch (err) {
    alert("Could not save PDF: " + err.message);
  } finally {
    el.style.overflow = prevElOverflow;
    if (container) { container.style.maxHeight = prevContainerMaxHeight; container.style.overflow = prevContainerOverflow; }
  }
}

// ---------------- QUOTATION PRINT PAD ----------------
async function openQuotationModal(quotationNo) {
  if (!quotationNo) return;
  try {
    const res = await apiFetch(`/api/quotation/${encodeURIComponent(quotationNo)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Quotation not found."); return; }

    const lh = data.letterhead || {};
    const padPaper = document.getElementById("quotationPadPaper");
    const headerArea = document.getElementById("qpHeaderArea");
    const padDivider = document.getElementById("qpDividerLine");

    applyPadBackground(padPaper, headerArea, padDivider, lh, {
      companyTitleId: "qpCompanyTitle", subHeadingId: "qpSubHeading", contactLineId: "qpContactLine"
    }, { forceTextHeader: true });

    document.getElementById("qpCustName").innerText = data.customer_name || "-";
    document.getElementById("qpCustAddress").innerText = data.address || "";
    document.getElementById("qpInvNo").innerText = data.quotation_no || "-";
    document.getElementById("qpInvDate").innerText = data.quotation_date || "-";

    const items = data.items || [];
    const rowsHtml = items.map((item, i) => {
      const qty = parseFloat(item.quantity || 0);
      const price = parseFloat(item.unit_price || 0);
      const rowTotal = qty * price;
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${item.product_type || '-'}</strong></td>
        <td>${item.size || '-'}</td>
        <td>${item.origin || '-'}</td>
        <td style="text-align:center;">${qty}</td>
        <td style="text-align:right;">${price.toFixed(2)}</td>
        <td style="text-align:right;"><strong>${rowTotal.toFixed(2)}</strong></td>
      </tr>`;
    }).join('');
    document.getElementById("qpItemsBody").innerHTML = rowsHtml;
    document.getElementById("qpGrandTotal").innerText = `BDT ${(data.grand_total || 0).toFixed(2)}`;
    document.getElementById("qpFooterNote").innerText = lh.footer_note || "Thank you for your business!";

    // Offer-letter framing (Sub/intro line) built from the actual line
    // items rather than hardcoded, so it reads correctly for both a single-
    // product quote and a multi-product one.
    const itemsSummary = summarizeQuotationItems(items);
    const projectSuffix = data.project_location ? ` at ${data.project_location}` : "";
    document.getElementById("qpSubLine").innerText =
      `Offer Letter to Supply ${itemsSummary} for ${data.customer_name || 'your'} Project${projectSuffix}.`;
    document.getElementById("qpIntroPara").innerText =
      `We are pleased to offer you the rate quotation for supply of ${itemsSummary} for your ` +
      `${data.customer_name || ''} requirement${projectSuffix}. The rate, terms and conditions, and mode of payment are given below.`;

    document.getElementById("qpTransportTerms").innerText = data.transport_terms || "With Transport";
    document.getElementById("qpWeighingTerms").innerText = data.weighing_terms || "Unload Point Scale Qty";
    document.getElementById("qpPaymentTerms").innerText = data.payment_terms || "After Delivery 15 Days Full Payment";
    document.getElementById("qpBankDetails").innerText = lh.bank_details || "";
    document.getElementById("qpSignOffDate").innerText = data.quotation_date || "";

    document.getElementById("quotationModal").classList.add("active");
  } catch (err) {
    alert("Failed to load quotation: " + err.message);
  }
}

// Builds a short human-readable phrase like
// "5/10 MM PAKUR BLACK STONE (Origin: India)" (single item) or
// "Steel Rod 12mm (Origin: China) and Hydraulic Valve 3in" (multiple) —
// used for the letter's Sub: line and intro paragraph.
function summarizeQuotationItems(items) {
  if (!items || items.length === 0) return "the below-listed product(s)";
  const parts = items.map(item => {
    const size = item.size ? ` ${item.size}` : '';
    const origin = item.origin ? ` (Origin: ${item.origin})` : '';
    return `${item.product_type || 'Product'}${size}${origin}`;
  });
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The quotation pad grows to fit its (variable-length) letter content
// instead of being locked to the invoice's fixed 612x792 physical pad size
// (see applyPadBackground's forceTextHeader), so its PDF export can't reuse
// saveElementAsPDF()'s single-fixed-page approach either — a longer quote
// would get silently clipped to one pad-height. This instead captures the
// element at its natural height and paginates across as many US Letter
// pages as needed, the same slice-and-addPage recipe saveReportAsPDF() uses.
async function saveQuotationAsPDF() {
  const el = document.getElementById('quotationPadPaper');
  if (!el) return;
  const container = el.closest('.invoice-modal-container');
  const prevContainerMaxHeight = container ? container.style.maxHeight : null;
  const prevContainerOverflow = container ? container.style.overflow : null;
  const prevElOverflow = el.style.overflow;
  if (container) { container.style.maxHeight = "none"; container.style.overflow = "visible"; }
  el.style.overflow = "visible";

  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [PAD_PAGE_WIDTH_PT, PAD_PAGE_HEIGHT_PT] });
    const imgWidth = PAD_PAGE_WIDTH_PT;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= PAD_PAGE_HEIGHT_PT;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= PAD_PAGE_HEIGHT_PT;
    }
    pdf.save(`Quotation_${(document.getElementById('qpInvNo')?.innerText || 'quote')}.pdf`);
  } catch (err) {
    alert("Could not save PDF: " + err.message);
  } finally {
    el.style.overflow = prevElOverflow;
    if (container) { container.style.maxHeight = prevContainerMaxHeight; container.style.overflow = prevContainerOverflow; }
  }
}

// Downloads the currently-open quotation as a real .doc file Word can open
// — no server round-trip and no new pip dependency (no python-docx needed
// server-side, so nothing to add to the PyInstaller build). This works
// because Word opens any HTML document saved with a .doc extension/
// application/msword MIME type; the '﻿' BOM + the Office XML
// namespaces in <html> are what make Word recognize and render it cleanly
// rather than showing a "convert on open" prompt.
function saveQuotationAsDoc() {
  const get = id => document.getElementById(id)?.innerText || '';
  const companyName = get('qpCompanyTitle') || (systemConfig?.letterhead?.company_name) || 'JAHAN TRADING CO.';
  const subHeading = get('qpSubHeading');
  const contactLine = get('qpContactLine');
  const quotationNo = get('qpInvNo');
  const quotationDate = get('qpInvDate');
  const custName = get('qpCustName');
  const custAddress = get('qpCustAddress');
  const subLine = get('qpSubLine');
  const introPara = get('qpIntroPara');
  const itemsRowsHtml = document.getElementById('qpItemsBody')?.innerHTML || '';
  const grandTotal = get('qpGrandTotal');
  const transportTerms = get('qpTransportTerms');
  const weighingTerms = get('qpWeighingTerms');
  const paymentTerms = get('qpPaymentTerms');
  const bankDetails = get('qpBankDetails').replace(/\n/g, '<br>');
  const footerNote = get('qpFooterNote');
  const signOffDate = get('qpSignOffDate');

  const html = `<!DOCTYPE html>
  <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head><meta charset="UTF-8"><title>Quotation ${quotationNo}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; color: #1a1a1a; }
    h1 { font-size: 16pt; margin-bottom: 0; text-align: center; }
    .sub-heading, .contact-line { text-align: center; }
    .sub-heading { font-size: 10pt; color: #444; margin-top: 2px; }
    .contact-line { font-size: 9pt; color: #666; margin-top: 2px; }
    table { border-collapse: collapse; width: 100%; margin: 14px 0; }
    table.data th, table.data td { border: 1px solid #999; padding: 6px 8px; font-size: 10.5pt; }
    table.data th { background: #f1f1f1; text-align: left; }
    table.plain, table.plain td { border: none; padding: 0; }
    .right { text-align: right; }
    .center { text-align: center; }
    .section-title { font-weight: bold; margin-top: 14px; }
  </style></head>
  <body>
    <h1>${companyName}</h1>
    <div class="sub-heading">${subHeading}</div>
    <div class="contact-line">${contactLine}</div>
    <hr>
    <table class="plain"><tr>
      <td>Ref: <strong>${quotationNo}</strong></td>
      <td class="right">Date: <strong>${quotationDate}</strong></td>
    </tr></table>
    <p>To,<br><strong>${custName}</strong><br>${custAddress}</p>
    <p><strong>Sub:</strong> ${subLine}</p>
    <p>Dear Sir,</p>
    <p>${introPara}</p>
    <table class="data">
      <thead><tr><th>SL</th><th>Description</th><th>Size</th><th>Origin</th><th class="center">Qty</th><th class="right">Unit Price</th><th class="right">Amount (BDT)</th></tr></thead>
      <tbody>${itemsRowsHtml}</tbody>
    </table>
    <p class="right"><strong>Total Quotation Price: ${grandTotal}</strong></p>
    <p><strong>Transportation:</strong> ${transportTerms} &nbsp;&nbsp;&nbsp; <strong>Weighing Term &amp; Condition:</strong> ${weighingTerms}</p>
    <p class="section-title">Mode Of Payment</p>
    <p>${paymentTerms}</p>
    <p>${bankDetails}</p>
    <br><br>
    <table class="plain"><tr>
      <td>Signature: ____________________</td>
      <td class="right">Date: ${signOffDate}</td>
    </tr></table>
    <p style="text-align:center; font-size:9pt; color:#666; margin-top:20px;">${footerNote}</p>
  </body></html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Quotation_${quotationNo || 'quote'}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function closeQuotationModal() {
  document.getElementById("quotationModal").classList.remove("active");
}

// Purchase Order pad — deliberately the exact same fixed-size business pad
// as the Sales Chalan Invoice (openInvoiceModal above), not the growing
// letter-style layout the Quotation pad uses: same applyPadBackground call
// (no forceTextHeader, so a configured pad-image background renders here
// too), same meta-row/table/totals/signature-row structure, and the same
// saveElementAsPDF() single-fixed-page export.
async function openPurchaseOrderModal(purchaseOrderNo) {
  if (!purchaseOrderNo) return;
  try {
    const res = await apiFetch(`/api/purchase_order/${encodeURIComponent(purchaseOrderNo)}?client_id=${currentClientId}`);
    const data = await res.json();
    if (data.status === "error") { alert("Purchase order not found."); return; }

    const lh = data.letterhead || {};
    const padPaper = document.getElementById("poPadPaper");
    const headerArea = document.getElementById("poHeaderArea");
    const padDivider = document.getElementById("poDividerLine");

    const ribbon = document.getElementById("poPendingRibbon");
    if (ribbon) ribbon.style.display = data.status === "pending" ? "block" : "none";

    applyPadBackground(padPaper, headerArea, padDivider, lh, {
      companyTitleId: "poCompanyTitle", subHeadingId: "poSubHeading", contactLineId: "poContactLine"
    });

    document.getElementById("poCustName").innerText = data.supplier_name || "-";
    document.getElementById("poCustPhone").innerText = data.mobile_number ? `Phone: ${data.mobile_number}` : "";
    document.getElementById("poCustLocation").innerText = data.delivery_address ? `Delivery: ${data.delivery_address}` : "";
    document.getElementById("poInvNo").innerText = data.purchase_order_no || "-";
    document.getElementById("poInvDate").innerText = data.po_date || "-";

    const items = data.items || [];
    const rowsHtml = items.map((item, i) => {
      const qty = parseFloat(item.quantity || 0);
      const price = parseFloat(item.unit_price || 0);
      const rowTotal = qty * price;
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${item.product_type || '-'}</strong></td>
        <td>${item.size || '-'}</td>
        <td style="text-align:center;">${qty}</td>
        <td style="text-align:right;">${price.toFixed(2)}</td>
        <td style="text-align:right;"><strong>${rowTotal.toFixed(2)}</strong></td>
      </tr>`;
    }).join('');
    document.getElementById("poItemsBody").innerHTML = rowsHtml;
    document.getElementById("poGrandTotal").innerText = `BDT ${(data.grand_total || 0).toFixed(2)}`;
    document.getElementById("poFooterNote").innerText = lh.footer_note || "Thank you for doing business with Jahan Trading!";

    document.getElementById("purchaseOrderModal").classList.add("active");
  } catch (err) {
    alert("Failed to load purchase order: " + err.message);
  }
}

function closePurchaseOrderModal() {
  document.getElementById("purchaseOrderModal").classList.remove("active");
}

// The client's real pre-printed business pad is US Letter (8.5in x 11in),
// confirmed by reading the actual page size out of their reference PDF
// (612 x 792pt exactly). Every pad surface — on-screen modal, browser
// Print, and the PDF Save export — is locked to this same physical size,
// rather than derived from whatever pixel proportions an uploaded photo of
// the pad happens to have (a phone photo's own crop ratio is not
// necessarily identical to the true paper size, and was the underlying
// cause of misalignment/an extra border showing up in exports).
const PAD_PAGE_WIDTH_PT = 612;
const PAD_PAGE_HEIGHT_PT = 792;

// letterhead_settings.pad_image stores a bare Google Drive file_id (not a
// URL) — Drive's direct-content URLs send Cross-Origin-Resource-Policy:
// same-site, which blocks a browser from loading them as a background-image
// on any other site, ours included (confirmed by testing: the URL works
// fine as a full-page navigation but silently fails to load as an <img>
// src). Routing through our own /api/letterhead/pad_image_proxy sidesteps
// that entirely since the browser then only talks to our own origin.
// A handful of legacy values (a full data: URL or an old direct Drive URL,
// from before this fix) are passed through unchanged rather than mangled.
function padImageSrc(padImage) {
  if (!padImage) return "";
  if (padImage.startsWith("data:") || padImage.startsWith("http")) return padImage;
  return `/api/letterhead/pad_image_proxy?id=${encodeURIComponent(padImage)}`;
}

// Shared pad-image/header layout logic used by both the invoice and
// quotation print pads so alignment stays identical between the two.
function applyPadBackground(padPaper, headerArea, padDivider, lh, ids, opts) {
  opts = opts || {};
  // Signature positions (see .sig-authorised/.sig-received in style.css) are
  // pinned relative to the bottom of the pad using this footer height, so
  // they stay clear of the pad's pre-printed address bars in both modes.
  padPaper.style.setProperty("--footer-h", `${lh.footer_height_px || 110}px`);

  // The quotation pad is a multi-paragraph letter, not a compact single-page
  // form — it's routinely taller than the invoice's fixed physical pad size,
  // so it always uses the plain text header/auto-growing layout and never
  // the pre-printed pad-image overlay (which forces the invoice's fixed
  // 612x792 aspect ratio — that's tuned for the invoice's short content and
  // clips/overlaps a longer letter).
  if (lh.use_pad_image && lh.pad_image && !opts.forceTextHeader) {
    padPaper.style.backgroundImage = `url('${padImageSrc(lh.pad_image)}')`;
    padPaper.style.backgroundSize = "100% 100%";
    padPaper.style.backgroundRepeat = "no-repeat";
    headerArea.style.display = "none";
    if (padDivider) padDivider.style.display = "none";
    padPaper.style.paddingTop = `${lh.header_height_px || 140}px`;
    padPaper.style.paddingBottom = `${lh.footer_height_px || 110}px`;
    padPaper.style.aspectRatio = `${PAD_PAGE_WIDTH_PT} / ${PAD_PAGE_HEIGHT_PT}`;
  } else {
    padPaper.style.backgroundImage = "none";
    padPaper.style.aspectRatio = "auto";
    padPaper.style.paddingBottom = "0px";
    if (padDivider) padDivider.style.display = "";

    if (lh.show_border === false) {
      headerArea.style.display = "none";
      padPaper.style.paddingTop = `${lh.header_height_px || 140}px`;
    } else {
      headerArea.style.display = "block";
      padPaper.style.paddingTop = "40px";
      document.getElementById(ids.companyTitleId).innerText = lh.company_name || "";
      document.getElementById(ids.subHeadingId).innerText = lh.sub_heading || "";
      document.getElementById(ids.contactLineId).innerText = `${lh.address || ''} | Phone: ${lh.phone || ''}`;
    }
  }
}

// ---------------- LETTERHEAD ----------------
// currentPadImageDataUrl holds the *saved* Google Drive link for the pad
// image (what's actually persisted in letterhead_settings.pad_image — a
// short URL, not the image itself, so the Aiven database never stores the
// full picture). pendingPadImageFile holds a newly-picked file that hasn't
// been uploaded yet; it's only uploaded to Drive when the form is saved,
// and the local <img> preview uses a throwaway object URL until then.
let currentPadImageDataUrl = "";
let pendingPadImageFile = null;
const MAX_PAD_IMAGE_BYTES = 6 * 1024 * 1024;

function populateLetterheadForm() {
  if (!systemConfig || !systemConfig.letterhead) return;
  const lh = systemConfig.letterhead;
  document.getElementById("lhCompanyName").value = lh.company_name || "";
  document.getElementById("lhSubHeading").value = lh.sub_heading || "";
  document.getElementById("lhAddress").value = lh.address || "";
  document.getElementById("lhPhone").value = lh.phone || "";
  document.getElementById("lhEmail").value = lh.email || "";
  document.getElementById("lhFooterNote").value = lh.footer_note || "";
  document.getElementById("lhBankDetails").value = lh.bank_details || "";
  document.getElementById("lhHeaderHeight").value = lh.header_height_px || 140;
  document.getElementById("lhFooterHeight").value = lh.footer_height_px || 110;
  document.getElementById("lhShowBorder").value = lh.show_border !== false ? "true" : "false";
  document.getElementById("lhUsePadImage").checked = !!lh.use_pad_image;

  currentPadImageDataUrl = lh.pad_image || "";
  pendingPadImageFile = null;
  updatePadImagePreview();
}

function updatePadImagePreview() {
  const wrap = document.getElementById("lhPadImagePreviewWrap");
  const img = document.getElementById("lhPadImagePreview");
  if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  if (currentPadImageDataUrl) {
    img.src = padImageSrc(currentPadImageDataUrl);
    wrap.style.display = "flex";
  } else {
    img.src = "";
    wrap.style.display = "none";
  }
}

function handlePadImageSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > MAX_PAD_IMAGE_BYTES) {
    alert("That image is too large (max 6 MB). Please use a smaller or compressed JPG/PNG.");
    event.target.value = "";
    return;
  }
  // Instant local preview only — nothing is uploaded yet. The actual upload
  // to Google Drive happens when the form is saved (see saveLetterheadSettings()).
  pendingPadImageFile = file;
  const wrap = document.getElementById("lhPadImagePreviewWrap");
  const img = document.getElementById("lhPadImagePreview");
  if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(file);
  wrap.style.display = "flex";
}

function removePadImage() {
  currentPadImageDataUrl = "";
  pendingPadImageFile = null;
  document.getElementById("lhPadImageFile").value = "";
  document.getElementById("lhUsePadImage").checked = false;
  updatePadImagePreview();
}

async function saveLetterheadSettings(event) {
  event.preventDefault();

  if (pendingPadImageFile) {
    const fd = new FormData();
    fd.append("file", pendingPadImageFile);
    try {
      const uploadRes = await apiFetch("/api/letterhead/pad_image", { method: "POST", body: fd });
      const uploadData = await uploadRes.json();
      if (uploadData.status !== "success") {
        alert("Failed to upload pad image to Google Drive: " + uploadData.message);
        return;
      }
      currentPadImageDataUrl = uploadData.pad_image;
      pendingPadImageFile = null;
    } catch (err) {
      alert("Connection error uploading pad image: " + err.message);
      return;
    }
  }

  const payload = {
    company_name: document.getElementById("lhCompanyName").value,
    sub_heading: document.getElementById("lhSubHeading").value,
    address: document.getElementById("lhAddress").value,
    phone: document.getElementById("lhPhone").value,
    email: document.getElementById("lhEmail").value,
    footer_note: document.getElementById("lhFooterNote").value,
    bank_details: document.getElementById("lhBankDetails").value,
    header_height_px: parseInt(document.getElementById("lhHeaderHeight").value || 140),
    footer_height_px: parseInt(document.getElementById("lhFooterHeight").value || 110),
    show_border: document.getElementById("lhShowBorder").value === "true",
    use_pad_image: document.getElementById("lhUsePadImage").checked,
    pad_image: currentPadImageDataUrl
  };
  try {
    const res = await apiFetch("/api/letterhead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === "success") {
      systemConfig.letterhead = data.letterhead;
      updatePadImagePreview();
      alert("Letterhead settings updated successfully!");
    } else {
      alert("Failed to update letterhead: " + data.message);
    }
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}
