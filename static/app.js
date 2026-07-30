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
  new_sale: ['product_type', 'size', 'cost_price', 'received_quantity', 'sale_unit_price'],
  new_purchase: ['product_type', 'size', 'unit_price', 'quantity'],
  new_quotation: ['product_type', 'size', 'origin', 'unit_price', 'quantity']
};

// New/Previous entry mode for Sales & Purchase — "Previous" is a manual
// historical-backfill mode (see record_source field): every inventory/
// customer/product lookup becomes a plain text input and nothing touches
// inventory on save. Reset whenever the user navigates to a different
// entry tab (switchEntryTab), not on every re-render, since toggling the
// dropdown itself triggers a re-render and must not stomp on itself.
let currentRecordMode = "New";

function effectiveFieldType(f, entryId) {
  if (currentRecordMode !== "Previous" || (entryId !== "new_sale" && entryId !== "new_purchase")) {
    return f.type;
  }
  if (["customer_select", "inventory_select", "product_select", "invoice_ref_select", "quotation_ref_select"].includes(f.type)) {
    const lname = f.name.toLowerCase();
    return (lname.includes("quantity") || lname.includes("price")) ? "number" : "text";
  }
  return f.type;
}

async function renderEntryForm(entryId) {
  const ep = systemConfig.entry_points.find(x => x.id === entryId);
  if (!ep) return;

  document.getElementById("pageTitle").innerText = ep.title;
  document.getElementById("pageSubtitle").innerText = `Enter details to store into table '${ep.table}'.`;
  document.getElementById("entryFormTitle").innerHTML = `<i class="fa-solid ${ep.icon || 'fa-pen'}"></i> ${ep.title}`;
  document.getElementById("entryFormTable").innerText = `Table: ${ep.table}`;

  // Refresh lookups so dropdowns are current
  await refreshLookups();

  const container = document.getElementById("formFieldsContainer");
  container.innerHTML = "";

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
    if (f.name === "record_source") {
      input = document.createElement("select");
      input.className = "form-control";
      f.options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt; o.innerText = opt;
        input.appendChild(o);
      });
      input.value = currentRecordMode;
      input.onchange = () => { currentRecordMode = input.value; renderEntryForm(entryId); };
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
      input = document.createElement("select");
      input.className = "form-control";
      input.innerHTML = `<option value="">-- Select ${f.customer_type_filter} Customer --</option>`;
      const custList = await getCustomersByType(f.customer_type_filter);
      custList.forEach(c => {
        const o = document.createElement("option");
        o.value = c.customer_name;
        o.dataset.contact = c.contact_number || "";
        o.innerText = c.contact_number ? `${c.customer_name} (${c.contact_number})` : c.customer_name;
        input.appendChild(o);
      });
      if (custList.length === 0) {
        const o = document.createElement("option");
        o.value = ""; o.disabled = true;
        o.innerText = `No ${f.customer_type_filter} customers yet — add one in Customer Registration first`;
        input.appendChild(o);
      }
      if (f.fills_contact_field) {
        input.onchange = () => {
          const opt = input.options[input.selectedIndex];
          const contactEl = document.getElementById(`input_${f.fills_contact_field}`);
          if (contactEl) contactEl.value = opt.dataset.contact || "";
        };
      }
    } else if (effType === "invoice_ref_select") {
      input = document.createElement("select");
      input.className = "form-control";
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
            o.innerText = ref.reference_no;
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
      };
    } else {
      input = document.createElement("input");
      input.type = effType === "number" ? "number" : (effType === "date" ? "date" : "text");
      input.className = "form-control";
      if (effType === "number") input.step = "any";
      if (f.required) input.required = true;
      // Previous (historical backfill) mode always allows editing the
      // reference number manually — there is no live auto-gen to protect.
      const forceEditable = currentRecordMode === "Previous" && f.name === "chalan_no";
      if (f.readonly && !forceEditable) input.readOnly = true;
      if (f.auto_gen && currentRecordMode !== "Previous") input.value = `${f.auto_gen}${Date.now().toString().slice(-6)}`;
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
    } else if (ep.table === 'transporters' && ['rent', 'advance'].includes(f.name)) {
      input.oninput = calculateTransporterTotal;
    }

    if (f.show_if) {
      group.dataset.showIfField = f.show_if.field;
      group.dataset.showIfValue = f.show_if.value;
    }

    group.appendChild(input);
    container.appendChild(group);
  }

  // Wire up show_if conditional visibility now that all fields exist
  container.querySelectorAll('[data-show-if-field]').forEach(group => {
    const watchEl = document.getElementById(`input_${group.dataset.showIfField}`);
    if (!watchEl) return;
    const update = () => {
      group.style.display = (watchEl.value === group.dataset.showIfValue) ? "" : "none";
    };
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

  // Auto-fill chalan (skipped in Previous mode — the client keys in their own historical number)
  if (ep.table === 'sales' && currentRecordMode !== 'Previous') {
    try {
      const r = await apiFetch(`/api/next_chalan?client_id=${currentClientId}`);
      const data = await r.json();
      const el = document.getElementById("input_chalan_no");
      if (el && !el.value) el.value = data.chalan_no;
    } catch (e) { /* ignore */ }
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
  if (ep.table === 'sales' || ep.table === 'purchases' || ep.table === 'transporters' || ep.table === 'quotations') {
    const totalBox = document.createElement("div");
    totalBox.className = "form-group col-12";
    totalBox.style.padding = "14px";
    totalBox.style.background = "rgba(99,102,241,0.1)";
    totalBox.style.borderRadius = "8px";
    const totalLabel = ep.table === 'quotations' ? 'Total Quotation Price:' : 'Calculated Total:';
    const dueRowDisplay = ep.table === 'quotations' ? 'none' : 'flex';
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

  const isPrevious = currentRecordMode === "Previous" && (entryId === "new_sale" || entryId === "new_purchase");

  if (isPrevious) {
    // Historical backfill — plain manual inputs only, no inventory/product catalog linkage.
    const gProduct = mkGroup(4, `Product #${idx + 1} Type *`);
    const inProduct = document.createElement("input");
    inProduct.type = "text"; inProduct.className = "form-control"; inProduct.id = `li_product_type_${idx}`;
    gProduct.appendChild(inProduct);

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
      inQty.type = "number"; inQty.step = "any"; inQty.className = "form-control"; inQty.id = `li_received_quantity_${idx}`; inQty.value = 0;
      inQty.oninput = () => recalcLineItemTotals(entryId);
      gQty.appendChild(inQty);

      const gPrice = mkGroup(2, "Sale Price *");
      const inPrice = document.createElement("input");
      inPrice.type = "number"; inPrice.step = "any"; inPrice.className = "form-control"; inPrice.id = `li_sale_unit_price_${idx}`; inPrice.value = 0;
      inPrice.oninput = () => recalcLineItemTotals(entryId);
      gPrice.appendChild(inPrice);

      row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gCost); row.appendChild(gQty); row.appendChild(gPrice);
    } else {
      const gQty = mkGroup(3, "Quantity *");
      const inQty = document.createElement("input");
      inQty.type = "number"; inQty.step = "any"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0;
      inQty.oninput = () => recalcLineItemTotals(entryId);
      gQty.appendChild(inQty);

      const gPrice = mkGroup(3, "Unit Price *");
      const inPrice = document.createElement("input");
      inPrice.type = "number"; inPrice.step = "any"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0;
      inPrice.oninput = () => recalcLineItemTotals(entryId);
      gPrice.appendChild(inPrice);

      row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gQty); row.appendChild(gPrice);
    }
  } else if (entryId === "new_sale") {
    const gProduct = mkGroup(4, `Product #${idx + 1} (from Inventory)`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
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
    inQty.type = "number"; inQty.step = "any"; inQty.className = "form-control"; inQty.id = `li_received_quantity_${idx}`; inQty.value = 0;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(2, "Sale Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.className = "form-control"; inPrice.id = `li_sale_unit_price_${idx}`; inPrice.value = 0;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gCost); row.appendChild(gQty); row.appendChild(gPrice);
  } else if (entryId === "new_quotation") {
    const gProduct = mkGroup(3, `Product #${idx + 1} Type *`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
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
    inQty.type = "number"; inQty.step = "any"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(3, "Unit Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gOrigin); row.appendChild(gQty); row.appendChild(gPrice);
  } else {
    const gProduct = mkGroup(4, `Product #${idx + 1} Type *`);
    const selProduct = document.createElement("select");
    selProduct.className = "form-control";
    selProduct.id = `li_product_type_${idx}`;
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
    inQty.type = "number"; inQty.step = "any"; inQty.className = "form-control"; inQty.id = `li_quantity_${idx}`; inQty.value = 0;
    inQty.oninput = () => recalcLineItemTotals(entryId);
    gQty.appendChild(inQty);

    const gPrice = mkGroup(3, "Unit Price *");
    const inPrice = document.createElement("input");
    inPrice.type = "number"; inPrice.step = "any"; inPrice.className = "form-control"; inPrice.id = `li_unit_price_${idx}`; inPrice.value = 0;
    inPrice.oninput = () => recalcLineItemTotals(entryId);
    gPrice.appendChild(inPrice);

    row.appendChild(gProduct); row.appendChild(gSize); row.appendChild(gQty); row.appendChild(gPrice);
  }

  const gSubtotal = mkGroup(12, "");
  gSubtotal.innerHTML = `<div style="text-align:right; font-size:12px; color:var(--text-muted);">Line Subtotal: <strong id="li_subtotal_${idx}" style="color:var(--accent-emerald);">BDT 0.00</strong></div>`;
  row.appendChild(gSubtotal);

  return row;
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
  });

  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const due = Math.max(0, grand - adv);
  const totalEl = document.getElementById("liveCalculatedTotal");
  const dueDisplayEl = document.getElementById("liveCalculatedDue");
  if (totalEl) totalEl.innerText = `BDT ${grand.toFixed(2)}`;
  if (dueDisplayEl) dueDisplayEl.innerText = `BDT ${due.toFixed(2)}`;
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
  const rent = parseFloat(document.getElementById("input_rent")?.value || 0);
  const adv = parseFloat(document.getElementById("input_advance")?.value || 0);
  const due = Math.max(0, rent - adv);

  document.getElementById("liveCalculatedTotal").innerText = `BDT ${rent.toFixed(2)}`;
  document.getElementById("liveCalculatedDue").innerText = `BDT ${due.toFixed(2)}`;
  const dueEl = document.getElementById("input_due");
  if (dueEl && !dueEl._userTouched) dueEl.value = due.toFixed(2);
  if (dueEl) dueEl.addEventListener("input", () => { dueEl._userTouched = true; }, { once: true });
}

function resetCurrentForm() { if (currentEntryId) renderEntryForm(currentEntryId); }

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
        sale_unit_price: document.getElementById(`li_sale_unit_price_${idx}`)?.value || 0
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
    }

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

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!currentEntryId) return;

  const form = document.getElementById("dynamicForm");
  const formData = new FormData(form);
  const payload = { client_id: currentClientId, created_by: currentUser ? currentUser.username : null };
  for (let [k, v] of formData.entries()) payload[k] = v;

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
                  `Record saved to table '${data.table}'.`;
      alert(msg);
      if (data.chalan_no) openInvoiceModal(data.chalan_no);
      if (data.quotation_no) openQuotationModal(data.quotation_no);
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
  document.getElementById("customerFilterWrap").style.display = rp.supports_customer_filter ? "block" : "none";
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

  await loadReportData(reportId);
}

const DELETABLE_REPORT_TABLES = {
  sales_report: "sales",
  purchases_report: "purchases",
  transporter_report: "transporters",
  inventory_report: "inventory",
  products_report: "products",
  customer_report: "customers",
  quotation_report: "quotations"
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

async function loadReportData(reportId) {
  const df = document.getElementById("reportDateFrom")?.value || "";
  const dt = document.getElementById("reportDateTo")?.value || "";
  const cust = document.getElementById("reportCustomerFilter")?.value || "";
  const txnType = document.getElementById("reportTxnTypeFilter")?.value || "";
  const recordMode = document.getElementById("reportRecordModeFilter")?.value || "";

  const params = new URLSearchParams({ client_id: currentClientId });
  if (df) params.append("from", df);
  if (dt) params.append("to", dt);
  if (cust) params.append("customer", cust);
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
    const canUploadChallan = reportId === 'sales_report';
    const showActions = canDelete || canAdjust || canEdit || canDownloadInvoice ||
      canApproveQuotation || canPrintQuotation || canUploadChallan;

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
          if (canApproveQuotation && row.status === 'pending') {
            html += `<button class="btn btn-primary" style="padding:4px 10px; font-size:11px; margin-right:6px;" onclick="approveQuotationRow('${row.quotation_no}')"><i class="fa-solid fa-check"></i> Approve</button>`;
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
  const t = document.getElementById("reportTxnTypeFilter"); if (t) t.value = "All";
  const r = document.getElementById("reportRecordModeFilter"); if (r) r.value = "New";
  if (currentReportId) loadReportData(currentReportId);
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
    document.getElementById("padCustPhone").innerText = sale.contact_number ? `Phone: ${sale.contact_number}` : "";
    document.getElementById("padCustLocation").innerText = sale.unloading_location ? `Delivery: ${sale.unloading_location}` : "";
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
    });

    document.getElementById("qpCustName").innerText = data.customer_name || "-";
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

    document.getElementById("quotationModal").classList.add("active");
  } catch (err) {
    alert("Failed to load quotation: " + err.message);
  }
}

function closeQuotationModal() {
  document.getElementById("quotationModal").classList.remove("active");
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

// Shared pad-image/header layout logic used by both the invoice and
// quotation print pads so alignment stays identical between the two.
function applyPadBackground(padPaper, headerArea, padDivider, lh, ids) {
  // Signature positions (see .sig-authorised/.sig-received in style.css) are
  // pinned relative to the bottom of the pad using this footer height, so
  // they stay clear of the pad's pre-printed address bars in both modes.
  padPaper.style.setProperty("--footer-h", `${lh.footer_height_px || 110}px`);

  if (lh.use_pad_image && lh.pad_image) {
    padPaper.style.backgroundImage = `url('${lh.pad_image}')`;
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
    img.src = currentPadImageDataUrl;
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
