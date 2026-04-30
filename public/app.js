const state = {
  user: null,
  dashboard: null,
  listings: [],
  adminTab: "overview",
  ownerTab: "overview",
  tenantTab: "overview",
  editingProperty: null,
  editingResource: null,
  showTenantManagement: false
};

const SESSION_KEY = "easemyrentals-session";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBTMLm3i8fy_hfJipxlnAL7Bp8sCKsOpfk",
  authDomain: "eazycart-a283d.firebaseapp.com",
  projectId: "eazycart-a283d",
  storageBucket: "eazycart-a283d.firebasestorage.app",
  messagingSenderId: "346715485418",
  appId: "1:346715485418:web:f2b59b921d6e2ff28a5393",
  measurementId: "G-65JSFNNZLN"
};

window.EASEMYRENTALS_FIREBASE_CONFIG = FIREBASE_CONFIG;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

let publicSite, portal, portalContent, portalTitle, portalRole, portalSubtitle, siteHeader, loginOverlay, loginForm, loginStatus, contactForm, contactStatus, toast;

async function init() {
  console.log("🚀 App initializing...");
  
  // Initialize DOM elements after DOM is loaded
  publicSite = $("#publicSite");
  portal = $("#portal");
  portalContent = $("#portalContent");
  portalTitle = $("#portalTitle");
  portalRole = $("#portalRole");
  portalSubtitle = $("#portalSubtitle");
  siteHeader = $("#siteHeader");
  loginOverlay = $("#loginOverlay");
  loginForm = $("#loginForm");
  loginStatus = $("#loginStatus");
  contactForm = $("#contactForm");
  contactStatus = $("#contactStatus");
  toast = $("#toast");
  
  bindGlobalEvents();
  console.log("✅ Global events bound");
  bindFeatureTabs();
  console.log("✅ Feature tabs bound");
  await loadPublicListings();
  console.log("✅ Public listings loaded");

  try {
    const storedUser = loadSession();
    if (storedUser?.identifier) {
      state.user = storedUser;
      await loadDashboard();
      return;
    }

    const response = await api("/api/me");
    if (response.user) {
      state.user = response.user;
      saveSession(response.user);
      await loadDashboard();
    }
  } catch (error) {
    clearSession();
    console.error("❌ Init error:", error);
    showToast(error.message);
  }
}

function bindGlobalEvents() {
  $("#openLogin").addEventListener("click", () => openLogin());
  $("#closeLogin").addEventListener("click", () => closeLogin());
  $("#logoutButton").addEventListener("click", logout);

  loginOverlay.addEventListener("click", (event) => {
    if (event.target === loginOverlay) closeLogin();
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    await login(payload.email, payload.password);
  });

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    contactStatus.textContent = "";
    const payload = Object.fromEntries(new FormData(contactForm).entries());

    try {
      await api("/api/public/inquiries", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      contactForm.reset();
      contactStatus.textContent = "Thanks. We saved your enquiry.";
      showToast("Enquiry saved for the admin team.");
    } catch (error) {
      contactStatus.textContent = error.message;
    }
  });
  
  // Handle "List Your Property" button to pre-select "Property owner" in contact form
  $$('a[data-interest="Property owner"]').forEach(link => {
    link.addEventListener("click", () => {
      // Wait for scroll to contact section, then pre-select
      setTimeout(() => {
        const interestSelect = contactForm?.querySelector('#interestSelect');
        if (interestSelect) {
          interestSelect.value = "owner";
          updateContactFormFields("owner");
          // Focus on name field for immediate input
          const nameField = contactForm?.querySelector('input[name="name"]');
          nameField?.focus();
        }
      }, 300);
    });
  });
  
  // Handle interest selection change to show/hide conditional fields
  const interestSelect = contactForm?.querySelector('#interestSelect');
  const ownerFields = contactForm?.querySelector('#ownerFields');
  const tenantFields = contactForm?.querySelector('#tenantFields');
  
  function updateContactFormFields(interest) {
    if (ownerFields) ownerFields.hidden = interest !== "owner";
    if (tenantFields) tenantFields.hidden = interest !== "tenant";
  }
  
  interestSelect?.addEventListener("change", (e) => {
    updateContactFormFields(e.target.value);
  });
}

function bindFeatureTabs() {
  const tabs = $$(".tab-button");
  const panels = $$(".feature-panel");

  function activateTab(name) {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.id === `feature-${name}`));
  }

  tabs.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
      history.replaceState(null, "", `#${button.dataset.tab}`);
    });
  });

  const hash = window.location.hash.replace("#", "");
  if (hash === "owners" || hash === "tenants") {
    activateTab(hash);
  } else {
    activateTab("owners");
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function loadPublicListings() {
  const response = await api("/api/public/listings");
  state.listings = response.listings || [];
  renderPublicListings();
}

function renderPublicListings() {
  const container = $("#publicListings");
  if (!state.listings.length) {
    container.innerHTML = `<div class="empty-state">Listings added by admin will appear here.</div>`;
    return;
  }

  container.innerHTML = state.listings.map(renderListingCard).join("");
}

function renderListingCard(listing) {
  const photos = mediaUrls(listing);
  const cover = photos[0] || fallbackImage();
  return `
    <article class="listing-card">
      <img src="${escapeAttr(cover)}" alt="${escapeAttr(listing.title)}">
      <div class="listing-body">
        <span class="badge">${escapeHtml(listing.status || "Available")}</span>
        <h3>${escapeHtml(listing.title)}</h3>
        <p>${escapeHtml(listing.description || "")}</p>
        <div class="listing-meta">
          <span>${escapeHtml(listing.locality || "Bangalore")}</span>
          <span>${escapeHtml(listing.bedrooms || "Home")}</span>
          <span>${escapeHtml(listing.furnishing || "Managed")}</span>
          <span>${photos.length} photo${photos.length === 1 ? "" : "s"}</span>
          ${listing.video_url ? "<span>Video</span>" : ""}
        </div>
        ${renderMiniGallery(photos, listing.title)}
        ${listing.video_url ? `<a class="media-link" href="${escapeAttr(listing.video_url)}" target="_blank" rel="noreferrer">View video</a>` : ""}
        <div class="listing-cta">
          <p class="listing-cta-note">Pricing available on request</p>
          <a class="button button-primary" href="#contact" data-interest="tenant">Get in Touch to Book</a>
        </div>
      </div>
    </article>
  `;
}

async function login(email, password) {
  loginStatus.textContent = "";

  try {
    const response = await api("/api/auth/staff-login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    state.user = response.user;
    saveSession(response.user);
    closeLogin();
    await loadDashboard();
  } catch (error) {
    loginStatus.textContent = error.message;
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } finally {
    clearSession();
    state.user = null;
    state.dashboard = null;
    document.body.classList.remove("portal-open");
    portal.hidden = true;
    publicSite.hidden = false;
    siteHeader.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function loadDashboard() {
  const identifier = state.user?.identifier || state.user?.email || "";
  const response = await api(`/api/dashboard?identifier=${encodeURIComponent(identifier)}`);
  state.dashboard = response;
  renderPortal();
}

function renderPortal() {
  const role = state.dashboard.role;
  document.body.classList.add("portal-open");
  portal.hidden = false;
  publicSite.hidden = true;
  siteHeader.hidden = true;
  closeLogin();

  portalRole.textContent = `${capitalize(role)} portal`;
  portalTitle.textContent = `Welcome, ${state.dashboard.user.name}`;
  portalSubtitle.textContent = roleSubtitle(role);

  if (role === "admin") renderAdmin();
  if (role === "owner") renderOwner();
  if (role === "tenant") renderTenant();
}

function renderAdmin() {
  const active = state.adminTab;
  const openMaintenance = state.dashboard.stats?.open_maintenance || 0;
  const adminTabs = ["overview", "accounts", "properties", "payments", "inspections", "assets", "listings", "maintenance"];
  portalContent.innerHTML = `
    ${renderStats(state.dashboard.stats)}
    <div class="portal-tabs" role="tablist">
      ${adminTabs.map((tab) => {
        const label = tab === "maintenance" && openMaintenance > 0
          ? `Maintenance <span class="badge">${openMaintenance}</span>`
          : capitalize(tab);
        return `<button type="button" class="${tab === active ? "is-active" : ""}" data-tab="${tab}">${label}</button>`;
      }).join("")}
    </div>
    <section class="portal-panel">
      ${renderAdminPanel(active)}
    </section>
  `;

  bindAdminEvents();
  
  // Bind payment form events if payments tab is active
  if (active === "payments") {
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      bindPaymentFormEvents();
    });
  }
}

function renderAdminPanel(tab) {
  if (tab === "overview") {
    return `
      <div class="panel-heading">
        <div>
          <h2>Operations overview</h2>
          <p>Admin can create logins, enter flat details, assign tenants, and publish rent listings.</p>
        </div>
      </div>
      ${renderTable(state.dashboard.inquiries, inquiryColumns(), "No enquiries yet.")}
      ${renderTable(state.dashboard.payments.slice(0, 6), paymentColumns(), "No payments added yet.")}
    `;
  }

  if (tab === "accounts") {
    return `
      ${accountForm()}
      ${renderTable(state.dashboard.users, [
        ["name", "Name"],
        ["role", "Role"],
        ["email", "Email"],
        ["phone", "Phone"],
        ["status", "Status"],
        ["actions", "Actions", renderUserActions]
      ], "No accounts yet.")}
    `;
  }

  if (tab === "properties") {
    // Check if we're in edit mode or tenant management mode
    if (state.editingProperty && state.showTenantManagement) {
      return renderTenantManagement(state.editingProperty);
    }
    
    if (state.editingProperty) {
      return `
        ${propertyForm(true, state.editingProperty)}
        <h3 style="margin-top: 40px;">All Properties</h3>
        ${renderTable(state.dashboard.properties, propertyColumns(), "No properties yet.")}
      `;
    }
    
    return `
      ${propertyForm()}
      <h3 style="margin-top: 40px;">All Properties</h3>
      ${renderTable(state.dashboard.properties, propertyColumns(), "No properties yet.")}
    `;
  }
  
  // Handle editing other resources
  if (state.editingResource) {
    const { type, item } = state.editingResource;
    return `
      ${renderEditForm(type, item)}
      <h3 style="margin-top: 40px;">All ${capitalize(type)}</h3>
      ${renderTable(state.dashboard[type] || [], getColumnsForResource(type), `No ${type} yet.`)}
    `;
  }

  if (tab === "payments") {
    return `
      ${paymentForm()}
      ${renderTable(state.dashboard.payments, paymentColumns(), "No payments yet.")}
    `;
  }

  if (tab === "inspections") {
    return `
      ${inspectionForm()}
      ${renderTable(state.dashboard.inspections, [
        ["property_title", "Property"],
        ["scheduled_on", "Date"],
        ["status", "Status"],
        ["rating", "Rating"],
        ["summary", "Summary"],
        ["photos_count", "Photos"],
        ["image_urls", "Images", mediaSummary],
        ["actions", "Actions", renderInspectionActions]
      ], "No inspections yet.")}
    `;
  }

  if (tab === "assets") {
    return `
      ${assetForm()}
      ${renderTable(state.dashboard.assets, assetColumns(), "No assets yet.")}
    `;
  }

  if (tab === "maintenance") {
    return renderAdminMaintenance();
  }

  return `
    ${listingForm()}
    ${renderTable(state.dashboard.listings, [
      ["title", "Title"],
      ["locality", "Locality"],
      ["status", "Status"],
      ["rent", "Rent", money],
      ["image_url", "Image", singleImage],
      ["actions", "Actions", renderListingActions]
    ], "No listings yet.")}
  `;
}

function renderAdminMaintenance() {
  const requests = state.dashboard.maintenance_requests || [];
  return `
    <div class="panel-heading">
      <div>
        <h2>Service &amp; Maintenance Requests</h2>
        <p>All service requests submitted by tenants and owners.</p>
      </div>
    </div>
    ${renderTable(requests, [
      ["title", "Issue"],
      ["property_title", "Property"],
      ["priority", "Priority"],
      ["status", "Status", renderMaintenanceStatus],
      ["category", "Category"],
      ["estimated_cost", "Est. Cost", money],
      ["scheduled_date", "Scheduled"],
      ["created_at", "Submitted"],
      ["actions", "Actions", renderMaintenanceActions]
    ], "No service requests yet.")}
  `;
}

function renderMaintenanceStatus(value) {
  const colorMap = { "Open": "#e11d48", "In Progress": "#d97706", "Resolved": "#059669", "Closed": "#64748b" };
  const color = colorMap[value] || "#64748b";
  return `<span style="color:${color};font-weight:600">${value || "Open"}</span>`;
}

function renderMaintenanceActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="maintenance_requests" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="maintenance_requests" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function bindAdminEvents() {
  $$(".portal-tabs button", portalContent).forEach((button) => {
    button.addEventListener("click", () => {
      state.adminTab = button.dataset.tab;
      renderAdmin();
    });
  });

  $$("form[data-create]", portalContent).forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const resource = form.dataset.create;
      const payload = await payloadFromForm(form, resource);
      payload.identifier = state.user?.identifier || state.user?.email || "";

      try {
        await api(`/api/admin/${resource}`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        form.reset();
        showToast(`${capitalize(resource)} saved.`);
        await loadDashboard();
        if (resource === "listings") await loadPublicListings();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  
  // Handle form updates (PUT requests)
  $$("form[data-update]", portalContent).forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const resource = form.dataset.update;
      const id = form.dataset.id || form.dataset.propertyId;
      const payload = await payloadFromForm(form, resource);
      payload.identifier = state.user?.identifier || state.user?.email || "";

      try {
        await api(`/api/admin/${resource}/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        showToast(`${capitalize(resource)} updated.`);
        state.editingProperty = null;
        state.editingResource = null;
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  
  // Handle property action buttons (edit, manage-tenants)
  $$('[data-action="edit"][data-resource="properties"]', portalContent).forEach(btn => {
    btn.addEventListener("click", () => {
      const propertyId = parseInt(btn.dataset.id);
      const property = state.dashboard.properties.find(p => p.id === propertyId);
      if (property) {
        state.editingProperty = property;
        state.editingResource = null;
        renderAdmin();
      }
    });
  });
  
  $$('[data-action="manage-tenants"]', portalContent).forEach(btn => {
    btn.addEventListener("click", () => {
      const propertyId = parseInt(btn.dataset.id);
      const property = state.dashboard.properties.find(p => p.id === propertyId);
      if (property) {
        state.editingProperty = property;
        state.showTenantManagement = true;
        renderAdmin();
      }
    });
  });
  
  // Handle generic edit actions for all resources
  $$('[data-action="edit"]:not([data-resource="properties"])', portalContent).forEach(btn => {
    btn.addEventListener("click", () => {
      const resource = btn.dataset.resource;
      const id = parseInt(btn.dataset.id);
      const collection = state.dashboard[resource] || [];
      const item = collection.find(r => r.id === id);
      if (item) {
        state.editingResource = { type: resource, item, id };
        state.editingProperty = null;
        renderAdmin();
      }
    });
  });
  
  // Handle delete actions
  $$('[data-action="delete"]', portalContent).forEach(btn => {
    btn.addEventListener("click", async () => {
      const resource = btn.dataset.resource;
      const id = parseInt(btn.dataset.id);
      
      if (!confirm(`Are you sure you want to delete this ${resource.singularize()}?`)) {
        return;
      }
      
      try {
        await api(`/api/admin/${resource}/${id}`, {
          method: "DELETE"
        });
        showToast(`${resource.singularize()} deleted.`);
        await loadDashboard();
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  
  // Cancel edit button
  const cancelEditBtn = $("#cancelEditBtn");
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      state.editingProperty = null;
      state.editingResource = null;
      state.showTenantManagement = false;
      renderAdmin();
    });
  }

  // Bind payment form dynamic behavior
  bindPaymentFormEvents();
  
  // Bind room tenant form events
  bindRoomTenantEvents();
}

function bindPaymentFormEvents() {
  const form = $("#paymentForm");
  if (!form) {
    console.log("Payment form not found");
    return;
  }

  console.log("Binding payment form events");

  const propertySelect = $("#paymentProperty");
  const categorySelect = $("#paymentCategory");
  const tenantSelect = $("#paymentTenant");
  const ownerSelect = $("#paymentOwner");

  console.log("Form elements found:", { propertySelect, categorySelect, tenantSelect, ownerSelect });

  // Update tenant and owner options when property changes
  propertySelect?.addEventListener("change", () => {
    console.log("Property changed:", propertySelect.value);
    const propertyId = propertySelect.value;
    
    // Update tenant options
    const tenantOptions = propertyId ? 
      `<option value="">Use property tenant</option>${propertySpecificUserOptions("tenant", propertyId)}` : 
      `<option value="">Use property tenant</option>${userOptions("tenant")}`;
    tenantSelect.innerHTML = tenantOptions;
    
    // Update owner options
    const ownerOptions = propertyId ? 
      `<option value="">Use property owner</option>${propertySpecificUserOptions("owner", propertyId)}` : 
      `<option value="">Use property owner</option>${userOptions("owner")}`;
    ownerSelect.innerHTML = ownerOptions;
    
    // Reset category-based field states
    updatePaymentFieldStates();
  });

  // Update field states when category changes
  categorySelect?.addEventListener("change", updatePaymentFieldStates);

  function updatePaymentFieldStates() {
    const category = categorySelect.value;
    console.log("Category changed:", category);
    
    if (category === "Owner payout") {
      tenantSelect.disabled = true;
      tenantSelect.style.opacity = "0.5";
      ownerSelect.disabled = false;
      ownerSelect.style.opacity = "1";
    } else if (category === "Rent") {
      tenantSelect.disabled = false;
      tenantSelect.style.opacity = "1";
      ownerSelect.disabled = true;
      ownerSelect.style.opacity = "0.5";
    } else {
      tenantSelect.disabled = false;
      tenantSelect.style.opacity = "1";
      ownerSelect.disabled = false;
      ownerSelect.style.opacity = "1";
    }
  }

  // Initialize field states
  updatePaymentFieldStates();
}

function bindRoomTenantEvents() {
  const addRoomBtn = $("#addRoomTenantBtn");
  const container = $("#roomTenantsContainer");
  const form = $("#propertyForm");
  const hiddenInput = $("#roomTenantsData");
  
  if (!addRoomBtn || !container) return;
  
  // Add new room tenant row
  addRoomBtn.addEventListener("click", () => {
    const roomCount = container.querySelectorAll(".room-tenant-row-form").length + 1;
    const roomRow = document.createElement("div");
    roomRow.className = "room-tenant-row-form";
    roomRow.innerHTML = `
      <div class="room-fields">
        <input type="text" name="room_name_${roomCount}" placeholder="Room ${roomCount}" class="room-input" required>
        <select name="room_tenant_${roomCount}" class="tenant-input" required>
          <option value="">Select Tenant</option>
          ${userOptions("tenant")}
        </select>
        <input type="number" name="room_rent_${roomCount}" placeholder="Rent" class="rent-input" required>
        <input type="date" name="room_lease_start_${roomCount}" class="date-input" placeholder="Lease Start">
        <button type="button" class="button button-light remove-room-btn">×</button>
      </div>
    `;
    container.appendChild(roomRow);
    
    // Bind remove button
    roomRow.querySelector(".remove-room-btn").addEventListener("click", () => {
      roomRow.remove();
      updateRoomTenantsData();
    });
    
    // Update hidden input on any change
    roomRow.querySelectorAll("input, select").forEach(field => {
      field.addEventListener("change", updateRoomTenantsData);
    });
  });
  
  // Update hidden input with room tenants data
  function updateRoomTenantsData() {
    const rows = container.querySelectorAll(".room-tenant-row-form");
    const roomTenants = [];
    
    rows.forEach((row, index) => {
      const roomName = row.querySelector(`[name="room_name_${index + 1}"]`).value;
      const tenantId = row.querySelector(`[name="room_tenant_${index + 1}"]`).value;
      const rent = row.querySelector(`[name="room_rent_${index + 1}"]`).value;
      const leaseStart = row.querySelector(`[name="room_lease_start_${index + 1}"]`).value;
      
      if (roomName && tenantId) {
        roomTenants.push({
          room: roomName,
          tenant_id: parseInt(tenantId),
          rent: parseInt(rent) || 0,
          lease_start: leaseStart,
          status: "Active"
        });
      }
    });
    
    hiddenInput.value = JSON.stringify(roomTenants);
  }
  
  // Update before form submission
  if (form) {
    form.addEventListener("submit", () => {
      updateRoomTenantsData();
    });
  }
}

function renderOwner() {
  const active = state.ownerTab || "overview";
  const hasNotifications = (state.dashboard.notifications || []).length > 0;
  const unreadCount = (state.dashboard.notifications || []).filter(n => n.status === "unread").length;
  
  portalContent.innerHTML = `
    ${renderStats(state.dashboard.stats)}
    <div class="portal-tabs" role="tablist">
      ${[
        { id: "overview", label: "Overview" },
        { id: "analytics", label: "Monthly Payouts" },
        { id: "maintenance", label: `Maintenance ${state.dashboard.stats?.open_maintenance > 0 ? `<span class="badge">${state.dashboard.stats.open_maintenance}</span>` : ""}` },
        { id: "notifications", label: `Notifications ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : ""}` }
      ].map(tab => `
        <button type="button" class="${tab.id === active ? "is-active" : ""}" data-tab="${tab.id}">${tab.label}</button>
      `).join("")}
    </div>
    <section class="portal-panel">
      ${renderOwnerPanel(active)}
    </section>
  `;
  
  bindOwnerEvents();
}

function renderOwnerPanel(tab) {
  if (tab === "overview" || !tab) {
    return `
      <div class="panel-heading">
        <div>
          <h2>Your properties</h2>
          <p>Overview of your properties, inspections, and payments. Tenant details are confidential.</p>
        </div>
      </div>
      ${renderPropertyCards(state.dashboard.properties, true)}
      
      <div class="section-divider"></div>
      
      <h2>Inspection details</h2>
      ${renderInspectionCards(state.dashboard.inspections)}
      ${renderTable(state.dashboard.inspections, [
        ["property_title", "Property"],
        ["scheduled_on", "Date"],
        ["status", "Status"],
        ["rating", "Rating"],
        ["summary", "Summary"],
        ["photos_count", "Photos"],
        ["image_urls", "Images", mediaSummary]
      ], "No inspection details yet.")}
      
      <div class="section-divider"></div>
      
      <h2>Payment details</h2>
      ${renderTable(state.dashboard.payments, ownerPaymentColumns(), "No payment records yet.")}
    `;
  }
  
  if (tab === "analytics") {
    return renderOwnerAnalytics();
  }
  
  if (tab === "maintenance") {
    return renderOwnerMaintenance();
  }
  
  if (tab === "notifications") {
    return renderOwnerNotifications();
  }
  
  return "";
}

function renderOwnerAnalytics() {
  const analytics = state.dashboard.monthly_analytics || [];
  
  if (!analytics.length) {
    return `<div class="empty-state">No payment data available yet. Your monthly payout statements will appear here.</div>`;
  }
  
  return `
    <div class="panel-heading">
      <div>
        <h2>Monthly Rental Income</h2>
        <p>Track your rental income and payout status over the last 6 months.</p>
      </div>
    </div>
    <div class="analytics-grid">
      ${analytics.map(month => `
        <article class="analytics-card">
          <h3>${month.month}</h3>
          <div class="analytics-row">
            <span>Rent Collected</span>
            <strong>${money(month.rent_collected)}</strong>
          </div>
          <div class="analytics-row payout">
            <span>Payout Amount</span>
            <strong>${money(month.net_payout)}</strong>
          </div>
          ${month.owner_payout > 0 ? `
            <div class="analytics-status">
              <span class="badge">Paid</span>
              <small>Payout completed</small>
            </div>
          ` : month.rent_collected > 0 ? `
            <div class="analytics-status">
              <span class="badge">Pending</span>
              <small>Scheduled for month-end</small>
            </div>
          ` : `
            <div class="analytics-status">
              <span class="badge">No Rent</span>
              <small>No rental activity</small>
            </div>
          `}
        </article>
      `).join("")}
    </div>
  `;
}

function renderOwnerMaintenance() {
  const requests = state.dashboard.maintenance_requests || [];
  
  return `
    <div class="panel-heading">
      <div>
        <h2>Maintenance Requests</h2>
        <p>Track repair and maintenance requests for your properties.</p>
      </div>
    </div>
    <button type="button" class="button button-primary" id="newMaintenanceBtn" style="margin-bottom: 1rem;">
      + Raise New Request
    </button>
    ${renderTable(requests, [
      ["title", "Issue"],
      ["property_title", "Property"],
      ["priority", "Priority"],
      ["status", "Status"],
      ["estimated_cost", "Est. Cost", money],
      ["scheduled_date", "Scheduled"],
      ["created_at", "Submitted"]
    ], "No maintenance requests yet. Click 'Raise New Request' to submit one.")}
    
    <div id="maintenanceFormModal" class="modal" hidden>
      <div class="modal-content">
        <h3>Submit Maintenance Request</h3>
        <form id="maintenanceRequestForm">
          <label><span>Property</span><select name="property_id" required>${propertyOptions()}</select></label>
          <label><span>Issue Title</span><input name="title" required placeholder="e.g., AC not working"></label>
          <label><span>Category</span>
            <select name="category">
              <option>Plumbing</option>
              <option>Electrical</option>
              <option>Appliance</option>
              <option>Furniture</option>
              <option>Painting</option>
              <option>Cleaning</option>
              <option>Other</option>
            </select>
          </label>
          <label><span>Priority</span>
            <select name="priority" required>
              <option value="Low">Low - Can wait</option>
              <option value="Medium" selected>Medium - Within a week</option>
              <option value="High">High - Urgent</option>
              <option value="Emergency">Emergency - Same day</option>
            </select>
          </label>
          <label><span>Description</span><textarea name="description" rows="4" required placeholder="Describe the issue in detail..."></textarea></label>
          <label><span>Estimated Cost (if known)</span><input name="estimated_cost" type="number" placeholder="₹"></label>
          <div class="form-actions">
            <button type="button" class="button button-light" id="cancelMaintenance">Cancel</button>
            <button type="submit" class="button button-primary">Submit Request</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderOwnerNotifications() {
  const notifications = state.dashboard.notifications || [];
  
  if (!notifications.length) {
    return `<div class="empty-state">No notifications yet. Important updates about your properties will appear here.</div>`;
  }
  
  return `
    <div class="panel-heading">
      <div>
        <h2>Notifications</h2>
        <p>Stay updated on your properties, payments, and maintenance.</p>
      </div>
      ${notifications.some(n => n.status === "unread") ? `
        <button type="button" class="button button-light" id="markAllRead">Mark all as read</button>
      ` : ""}
    </div>
    <div class="notification-list">
      ${notifications.map(notification => `
        <article class="notification-card ${notification.status}">
          <div class="notification-header">
            <span class="badge">${notification.type}</span>
            <small>${new Date(notification.created_at).toLocaleDateString()}</small>
          </div>
          <h3>${notification.title}</h3>
          <p>${notification.message}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function bindOwnerEvents() {
  $$(".portal-tabs button", portalContent).forEach((button) => {
    button.addEventListener("click", () => {
      state.ownerTab = button.dataset.tab;
      renderOwner();
    });
  });
  
  // Maintenance form events
  const newMaintenanceBtn = $("#newMaintenanceBtn");
  const maintenanceModal = $("#maintenanceFormModal");
  const cancelBtn = $("#cancelMaintenance");
  const maintenanceForm = $("#maintenanceRequestForm");
  
  if (newMaintenanceBtn) {
    newMaintenanceBtn.addEventListener("click", () => {
      maintenanceModal.hidden = false;
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      maintenanceModal.hidden = true;
      maintenanceForm?.reset();
    });
  }
  
  if (maintenanceForm) {
    maintenanceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      
      try {
        await api("/api/owner/maintenance-requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        maintenanceModal.hidden = true;
        form.reset();
        showToast("Maintenance request submitted successfully.");
        await loadDashboard(); // Refresh data
        renderOwner(); // Re-render to show updated list
      } catch (error) {
        showToast(error.message);
      }
    });
  }
  
  // Mark all notifications as read
  const markAllReadBtn = $("#markAllRead");
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", async () => {
      const unreadIds = (state.dashboard.notifications || [])
        .filter(n => n.status === "unread")
        .map(n => n.id);
      
      if (unreadIds.length === 0) return;
      
      try {
        await api("/api/owner/notifications/mark-read", {
          method: "POST",
          body: JSON.stringify({ notification_ids: unreadIds })
        });
        showToast("All notifications marked as read");
        await loadDashboard();
        renderOwner();
      } catch (error) {
        showToast(error.message);
      }
    });
  }
}

function renderTenant() {
  const active = state.tenantTab || "overview";
  const unreadCount = (state.dashboard.notifications || []).filter(n => n.status === "unread").length;
  const openMaintenance = state.dashboard.stats?.open_maintenance || 0;
  
  portalContent.innerHTML = `
    ${renderStats(state.dashboard.stats)}
    <div class="portal-tabs" role="tablist">
      ${[
        { id: "overview", label: "Overview" },
        { id: "maintenance", label: `Maintenance ${openMaintenance > 0 ? `<span class="badge">${openMaintenance}</span>` : ""}` },
        { id: "notifications", label: `Notifications ${unreadCount > 0 ? `<span class="badge">${unreadCount}</span>` : ""}` }
      ].map(tab => `
        <button type="button" class="${tab.id === active ? "is-active" : ""}" data-tab="${tab.id}">${tab.label}</button>
      `).join("")}
    </div>
    <section class="portal-panel">
      ${renderTenantPanel(active)}
    </section>
  `;
  
  bindTenantEvents();
}

function renderTenantPanel(tab) {
  if (tab === "overview" || !tab) {
    return `
      <div class="panel-heading">
        <div>
          <h2>Your property</h2>
          <p>Only records assigned to your tenant account are visible here.</p>
        </div>
      </div>
      ${renderPropertyCards(state.dashboard.properties)}
      <h2>Inspection images</h2>
      ${renderInspectionCards(state.dashboard.inspections || [])}
      ${renderTable(state.dashboard.inspections || [], [
        ["property_title", "Property"],
        ["scheduled_on", "Date"],
        ["status", "Status"],
        ["rating", "Rating"],
        ["summary", "Summary"],
        ["photos_count", "Photos"],
        ["image_urls", "Images", mediaSummary]
      ], "No inspection details yet.")}
      <h2>Assets</h2>
      ${renderTable(state.dashboard.assets, [
        ["property_title", "Property"],
        ["name", "Asset"],
        ["condition", "Condition"],
        ["quantity", "Qty"],
        ["last_checked_on", "Last Checked"],
        ["notes", "Notes"]
      ], "No assets assigned yet.")}
      <h2>Payment details</h2>
      ${renderTable(state.dashboard.payments, [
        ["property_title", "Property"],
        ["category", "Category"],
        ["amount", "Amount", money],
        ["due_date", "Due"],
        ["paid_on", "Paid On"],
        ["status", "Status"],
        ["reference", "Reference"]
      ], "No payment records yet.")}
    `;
  }
  
  if (tab === "maintenance") {
    return renderTenantMaintenance();
  }
  
  if (tab === "notifications") {
    return renderTenantNotifications();
  }
  
  return "";
}

function renderTenantMaintenance() {
  const requests = state.dashboard.maintenance_requests || [];
  const hasProperty = (state.dashboard.properties || []).length > 0;
  
  return `
    <div class="panel-heading">
      <div>
        <h2>Maintenance Requests</h2>
        <p>Report issues or track your maintenance requests.</p>
      </div>
    </div>
    ${hasProperty ? `
      <button type="button" class="button button-primary" id="newTenantMaintenanceBtn" style="margin-bottom: 1rem;">
        + Report Issue
      </button>
    ` : `<div class="empty-state">No property assigned yet.</div>`}
    ${renderTable(requests, [
      ["title", "Issue"],
      ["property_title", "Property"],
      ["priority", "Priority"],
      ["status", "Status"],
      ["scheduled_date", "Scheduled"],
      ["created_at", "Reported"]
    ], "No maintenance requests yet. Click 'Report Issue' to submit a request.")}
    
    <div id="tenantMaintenanceFormModal" class="modal" hidden>
      <div class="modal-content">
        <h3>Report Maintenance Issue</h3>
        <form id="tenantMaintenanceRequestForm">
          <label><span>Issue Title</span><input name="title" required placeholder="e.g., AC not working, leak in bathroom"></label>
          <label><span>Category</span>
            <select name="category">
              <option>Plumbing</option>
              <option>Electrical</option>
              <option>Appliance</option>
              <option>Furniture</option>
              <option>Painting</option>
              <option>Cleaning</option>
              <option>Other</option>
            </select>
          </label>
          <label><span>Priority</span>
            <select name="priority" required>
              <option value="Low">Low - Can wait</option>
              <option value="Medium" selected>Medium - Within a week</option>
              <option value="High">High - Urgent</option>
              <option value="Emergency">Emergency - Same day</option>
            </select>
          </label>
          <label><span>Description</span><textarea name="description" rows="4" required placeholder="Describe the issue in detail... When did it start? How severe is it?"></textarea></label>
          <label style="display: none;"><span>Property</span><select name="property_id">${propertyOptions()}</select></label>
          <div class="form-actions">
            <button type="button" class="button button-light" id="cancelTenantMaintenance">Cancel</button>
            <button type="submit" class="button button-primary">Submit Request</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderTenantNotifications() {
  const notifications = state.dashboard.notifications || [];
  
  if (!notifications.length) {
    return `<div class="empty-state">No notifications yet. Important updates will appear here.</div>`;
  }
  
  return `
    <div class="panel-heading">
      <div>
        <h2>Notifications</h2>
        <p>Stay updated on your property, payments, and maintenance.</p>
      </div>
      ${notifications.some(n => n.status === "unread") ? `
        <button type="button" class="button button-light" id="markTenantAllRead">Mark all as read</button>
      ` : ""}
    </div>
    <div class="notification-list">
      ${notifications.map(notification => `
        <article class="notification-card ${notification.status}">
          <div class="notification-header">
            <span class="badge">${notification.type}</span>
            <small>${new Date(notification.created_at).toLocaleDateString()}</small>
          </div>
          <h3>${notification.title}</h3>
          <p>${notification.message}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function bindTenantEvents() {
  $$(".portal-tabs button", portalContent).forEach((button) => {
    button.addEventListener("click", () => {
      state.tenantTab = button.dataset.tab;
      renderTenant();
    });
  });
  
  // Maintenance form events
  const newMaintenanceBtn = $("#newTenantMaintenanceBtn");
  const maintenanceModal = $("#tenantMaintenanceFormModal");
  const cancelBtn = $("#cancelTenantMaintenance");
  const maintenanceForm = $("#tenantMaintenanceRequestForm");
  
  if (newMaintenanceBtn) {
    newMaintenanceBtn.addEventListener("click", () => {
      maintenanceModal.hidden = false;
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      maintenanceModal.hidden = true;
      maintenanceForm?.reset();
    });
  }
  
  if (maintenanceForm) {
    maintenanceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      
      // Auto-assign tenant's property if not specified
      if (!payload.property_id && state.dashboard.properties?.length > 0) {
        payload.property_id = state.dashboard.properties[0].id;
      }
      
      try {
        await api("/api/tenant/maintenance-requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        maintenanceModal.hidden = true;
        form.reset();
        showToast("Maintenance request submitted successfully.");
        await loadDashboard();
        renderTenant();
      } catch (error) {
        showToast(error.message);
      }
    });
  }
  
  // Mark all notifications as read
  const markAllReadBtn = $("#markTenantAllRead");
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", async () => {
      const unreadIds = (state.dashboard.notifications || [])
        .filter(n => n.status === "unread")
        .map(n => n.id);
      
      if (unreadIds.length === 0) return;
      
      try {
        await api("/api/tenant/notifications/mark-read", {
          method: "POST",
          body: JSON.stringify({ notification_ids: unreadIds })
        });
        showToast("All notifications marked as read");
        await loadDashboard();
        renderTenant();
      } catch (error) {
        showToast(error.message);
      }
    });
  }
}

function accountForm() {
  return `
    <form class="admin-form" data-create="users">
      <h3>Create owner or tenant account</h3>
      <label><span>Role</span><select name="role" required><option value="owner">Owner</option><option value="tenant">Tenant</option></select></label>
      <label><span>Status</span><select name="status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label><span>Name</span><input name="name" required></label>
      <label><span>Email</span><input name="email" type="email" required></label>
      <label><span>Phone</span><input name="phone"></label>
      <label><span>Temporary Password</span><input name="password" type="password" required minlength="8"></label>
      <label><span>Occupation</span><input name="occupation"></label>
      <label><span>ID Proof</span><input name="id_proof"></label>
      <label class="wide-field"><span>Emergency Contact</span><input name="emergency_contact"></label>
      <label class="wide-field"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
      <button class="button button-primary" type="submit">Create Account</button>
    </form>
  `;
}

function getColumnsForResource(type) {
  switch(type) {
    case "payments": return paymentColumns();
    case "inspections": return [
      ["property_title", "Property"],
      ["scheduled_on", "Date"],
      ["status", "Status"],
      ["rating", "Rating"],
      ["summary", "Summary"],
      ["photos_count", "Photos"],
      ["image_urls", "Images", mediaSummary],
      ["actions", "Actions", renderInspectionActions]
    ];
    case "assets": return assetColumns();
    case "listings": return [
      ["title", "Title"],
      ["locality", "Locality"],
      ["status", "Status"],
      ["rent", "Rent", money],
      ["image_url", "Image", singleImage],
      ["actions", "Actions", renderListingActions]
    ];
    case "users": return [
      ["name", "Name"],
      ["role", "Role"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["status", "Status"],
      ["actions", "Actions", renderUserActions]
    ];
    case "maintenance_requests": return [
      ["title", "Issue"],
      ["property_title", "Property"],
      ["priority", "Priority"],
      ["status", "Status", renderMaintenanceStatus],
      ["category", "Category"],
      ["estimated_cost", "Est. Cost", money],
      ["scheduled_date", "Scheduled"],
      ["created_at", "Submitted"],
      ["actions", "Actions", renderMaintenanceActions]
    ];
    default: return [];
  }
}

function renderEditForm(type, item) {
  const formConfigs = {
    payments: {
      title: "Edit Payment",
      fields: [
        { name: "property_id", label: "Property", type: "select", options: propertyOptions(), required: true },
        { name: "category", label: "Category", type: "select", options: ["Rent", "Deposit", "Maintenance", "Owner payout", "Repair charge"].map(o => `<option value="${o}" ${item.category === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "amount", label: "Amount", type: "number", required: true, value: item.amount },
        { name: "status", label: "Status", type: "select", options: ["Due", "Paid", "Overdue", "Part paid"].map(o => `<option value="${o}" ${item.status === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "due_date", label: "Due Date", type: "date", value: item.due_date },
        { name: "paid_on", label: "Paid On", type: "date", value: item.paid_on },
        { name: "method", label: "Method", type: "text", value: item.method },
        { name: "reference", label: "Reference", type: "text", value: item.reference },
        { name: "notes", label: "Notes", type: "textarea", value: item.notes }
      ]
    },
    inspections: {
      title: "Edit Inspection",
      fields: [
        { name: "property_id", label: "Property", type: "select", options: propertyOptions(), required: true },
        { name: "scheduled_on", label: "Date", type: "date", required: true, value: item.scheduled_on },
        { name: "inspector", label: "Inspector", type: "text", value: item.inspector },
        { name: "status", label: "Status", type: "select", options: ["Scheduled", "Completed", "Needs repair"].map(o => `<option value="${o}" ${item.status === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "rating", label: "Rating", type: "select", options: ["Excellent", "Good", "Needs attention", "Critical"].map(o => `<option value="${o}" ${item.rating === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "summary", label: "Summary", type: "textarea", required: true, value: item.summary }
      ]
    },
    assets: {
      title: "Edit Asset",
      fields: [
        { name: "property_id", label: "Property", type: "select", options: propertyOptions(), required: true },
        { name: "name", label: "Asset Name", type: "text", required: true, value: item.name },
        { name: "condition", label: "Condition", type: "select", options: ["New", "Good", "Fair", "Poor", "Needs replacement"].map(o => `<option value="${o}" ${item.condition === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "quantity", label: "Quantity", type: "number", value: item.quantity },
        { name: "last_checked_on", label: "Last Checked", type: "date", value: item.last_checked_on },
        { name: "notes", label: "Notes", type: "textarea", value: item.notes }
      ]
    },
    listings: {
      title: "Edit Listing",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, value: item.title },
        { name: "locality", label: "Locality", type: "text", required: true, value: item.locality },
        { name: "status", label: "Status", type: "select", options: ["Available", "Rented", "Reserved"].map(o => `<option value="${o}" ${item.status === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "rent", label: "Rent", type: "number", required: true, value: item.rent },
        { name: "image_url", label: "Image URL", type: "text", value: item.image_url }
      ]
    },
    users: {
      title: "Edit User",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, value: item.name },
        { name: "email", label: "Email", type: "email", required: true, value: item.email },
        { name: "phone", label: "Phone", type: "text", value: item.phone },
        { name: "status", label: "Status", type: "select", options: ["Active", "Inactive", "Suspended"].map(o => `<option value="${o}" ${item.status === o ? 'selected' : ''}>${o}</option>`).join('') },
        { name: "notes", label: "Notes", type: "textarea", value: item.notes }
      ]
    }
  };
  
  const config = formConfigs[type];
  if (!config) return `<div class="empty-state">Edit form not available for ${type}</div>`;
  
  return `
    <form class="admin-form" data-update="${type}" data-id="${item.id}" id="editForm">
      <h3>${config.title}</h3>
      ${config.fields.map(field => `
        <label class="${field.type === 'textarea' ? 'wide-field' : ''}">
          <span>${field.label}${field.required ? ' *' : ''}</span>
          ${field.type === 'textarea' ? 
            `<textarea name="${field.name}" ${field.required ? 'required' : ''} rows="3">${field.value || ''}</textarea>` :
            field.type === 'select' ?
            `<select name="${field.name}" ${field.required ? 'required' : ''}>${field.options}</select>` :
            `<input type="${field.type}" name="${field.name}" value="${field.value || ''}" ${field.required ? 'required' : ''}>`
          }
        </label>
      `).join('')}
      <button class="button button-primary" type="submit">Update ${capitalize(type.singularize())}</button>
      <button type="button" class="button button-light" id="cancelEditBtn">Cancel</button>
    </form>
  `;
}

function propertyForm(isEdit = false, property = null) {
  const formTitle = isEdit ? `Edit Property: ${property?.title || ''}` : "Add flat details";
  const submitLabel = isEdit ? "Update Property" : "Save Property";
  const formData = property || {};
  
  return `
    <form class="admin-form" data-${isEdit ? 'update' : 'create'}="properties" id="propertyForm" ${isEdit ? `data-property-id="${property.id}"` : ''}>
      <h3>${formTitle}</h3>
      ${isEdit ? '<input type="hidden" name="id" value="' + property.id + '">' : ''}
      
      <label><span>Title</span><input name="title" required value="${formData.title || ''}"></label>
      <label><span>Flat No</span><input name="flat_no" required value="${formData.flat_no || ''}"></label>
      <label class="wide-field"><span>Address</span><input name="address" required value="${formData.address || ''}"></label>
      <label><span>Locality</span><input name="locality" required value="${formData.locality || ''}"></label>
      <label><span>City</span><input name="city" value="${formData.city || 'Bangalore'}"></label>
      <label><span>Type</span><select name="type">${selectOptions(["Apartment", "Villa", "Studio", "Independent House"], formData.type)}</select></label>
      <label><span>Bedrooms</span><input name="bedrooms" placeholder="2 BHK" value="${formData.bedrooms || ''}"></label>
      <label><span>Bathrooms</span><input name="bathrooms" inputmode="numeric" value="${formData.bathrooms || ''}"></label>
      <label><span>Furnishing</span><select name="furnishing">${selectOptions(["Fully furnished", "Semi furnished", "Unfurnished"], formData.furnishing)}</select></label>
      
      <div class="agreement-section wide-field">
        <h4>Agreement Terms</h4>
        <div class="agreement-fields">
          <label><span>Base Monthly Rent</span><input name="rent" inputmode="numeric" required value="${formData.rent || ''}"></label>
          <label><span>Deposit</span><input name="deposit" inputmode="numeric" value="${formData.deposit || ''}"></label>
          <label><span>Agreement Start Date</span><input name="lease_start" type="date" value="${formData.lease_start || ''}"></label>
          <label><span>Duration (Years)</span><input name="agreement_duration_years" type="number" min="1" max="5" value="${formData.agreement_duration_years || '1'}"></label>
          <label><span>Annual Hike %</span><input name="annual_hike_percent" type="number" min="0" max="20" value="${formData.annual_hike_percent || '5'}"></label>
        </div>
        ${isEdit ? `
          <div class="rent-calculation">
            <div class="calc-row"><span>Years Completed:</span><strong>${formData.years_completed || 0}</strong></div>
            <div class="calc-row"><span>Current Rent:</span><strong class="current-rent">${money(formData.current_base_rent || formData.rent || 0)}</strong></div>
            <div class="calc-row"><span>Next Hike Date:</span><strong>${formData.next_hike_date ? new Date(formData.next_hike_date).toLocaleDateString() : 'N/A'}</strong></div>
          </div>
        ` : ''}
      </div>
      
      <label><span>Owner</span><select name="owner_id" required>${userOptions("owner", formData.owner_id)}</select></label>
      
      <div class="room-tenants-section wide-field">
        <h4>Room-wise Tenant Assignment ${isEdit ? `<span class="tenant-count">(${formData.room_tenants?.length || 0} rooms)</span>` : ''}</h4>
        <p class="help-text">For shared properties like 3BHK with multiple tenants. Add tenants after property is created.</p>
        <div id="roomTenantsContainer" data-existing='${JSON.stringify(formData.room_tenants || [])}'>
          ${isEdit && formData.room_tenants ? renderExistingRoomTenants(formData.room_tenants) : ''}
        </div>
        <button type="button" class="button button-light" id="addRoomTenantBtn">+ Add Room Tenant</button>
      </div>
      
      <label><span>Primary Tenant (if single tenant)</span><select name="tenant_id">${userOptions("tenant", formData.tenant_id, "Unassigned")}</select></label>
      <label><span>Status</span><select name="status">${selectOptions(["Occupied", "Vacant", "Under maintenance"], formData.status)}</select></label>
      <label class="wide-field"><span>Primary Image URL</span><input name="image_url" placeholder="https://" value="${formData.image_url || ''}"></label>
      <label class="wide-field"><span>Additional Image URLs (up to 9 more)</span><textarea name="image_urls" rows="4" placeholder="https://...&#10;https://...">${(formData.image_urls || []).join('\n')}</textarea></label>
      <label class="wide-field"><span>Upload Property Images (up to 10)</span><input name="property_images" type="file" accept="image/*" multiple></label>
      <input type="hidden" name="room_tenants" id="roomTenantsData">
      <label class="wide-field"><span>Notes</span><textarea name="notes" rows="3">${formData.notes || ''}</textarea></label>
      <button class="button button-primary" type="submit">${submitLabel}</button>
      ${isEdit ? `<button type="button" class="button button-light" id="cancelEditBtn">Cancel Edit</button>` : ''}
    </form>
  `;
}

function selectOptions(options, selected) {
  return options.map(opt => `<option value="${opt}" ${opt === selected ? 'selected' : ''}>${opt}</option>`).join('');
}

function renderExistingRoomTenants(roomTenants) {
  return roomTenants.map((rt, index) => `
    <div class="room-tenant-row-form existing" data-room-index="${index}">
      <div class="room-fields">
        <input type="text" name="room_name_${index + 1}" placeholder="Room ${index + 1}" class="room-input" value="${rt.room}" required>
        <select name="room_tenant_${index + 1}" class="tenant-input" required>
          <option value="">Select Tenant</option>
          ${userOptions("tenant", rt.tenant_id)}
        </select>
        <input type="number" name="room_rent_${index + 1}" placeholder="Rent" class="rent-input" value="${rt.rent}" required>
        <input type="date" name="room_lease_start_${index + 1}" class="date-input" value="${rt.lease_start}">
        <button type="button" class="button button-light remove-room-btn">×</button>
      </div>
    </div>
  `).join('');
}

function paymentForm() {
  return `
    <form class="admin-form" data-create="payments" id="paymentForm">
      <h3>Add payment details</h3>
      <label><span>Property</span><select name="property_id" id="paymentProperty" required>${propertyOptions()}</select></label>
      <label><span>Category</span><select name="category" id="paymentCategory"><option>Rent</option><option>Deposit</option><option>Maintenance</option><option>Owner payout</option><option>Repair charge</option></select></label>
      <label><span>Amount</span><input name="amount" inputmode="numeric" required></label>
      <label><span>Status</span><select name="status"><option>Due</option><option>Paid</option><option>Overdue</option><option>Part paid</option></select></label>
      <label><span>Due Date</span><input name="due_date" type="date" required></label>
      <label><span>Paid On</span><input name="paid_on" type="date"></label>
      <label><span>Tenant</span><select name="tenant_id" id="paymentTenant"><option value="">Use property tenant</option>${userOptions("tenant")}</select></label>
      <label><span>Owner</span><select name="owner_id" id="paymentOwner"><option value="">Use property owner</option>${userOptions("owner")}</select></label>
      <label><span>Method</span><input name="method" placeholder="UPI, bank transfer"></label>
      <label><span>Reference</span><input name="reference"></label>
      <label class="wide-field"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
      <button class="button button-primary" type="submit">Save Payment</button>
    </form>
  `;
}

function inspectionForm() {
  return `
    <form class="admin-form" data-create="inspections">
      <h3>Add inspection details</h3>
      <label><span>Property</span><select name="property_id" required>${propertyOptions()}</select></label>
      <label><span>Date</span><input name="scheduled_on" type="date" required></label>
      <label><span>Inspector</span><input name="inspector" value="EMR Field Team"></label>
      <label><span>Status</span><select name="status"><option>Scheduled</option><option>Completed</option><option>Needs repair</option></select></label>
      <label><span>Rating</span><select name="rating"><option>Excellent</option><option>Good</option><option>Needs attention</option><option>Critical</option></select></label>
      <label><span>Photo Count</span><input name="photos_count" inputmode="numeric"></label>
      <label class="wide-field"><span>Inspection Image URLs</span><textarea name="image_urls" rows="3" placeholder="https://..."></textarea></label>
      <label class="wide-field"><span>Upload Inspection Images</span><input name="inspection_images" type="file" accept="image/*" multiple></label>
      <label class="wide-field"><span>Summary</span><textarea name="summary" rows="3" required></textarea></label>
      <button class="button button-primary" type="submit">Save Inspection</button>
    </form>
  `;
}

function assetForm() {
  return `
    <form class="admin-form" data-create="assets">
      <h3>Add asset details</h3>
      <label><span>Property</span><select name="property_id" required>${propertyOptions()}</select></label>
      <label><span>Tenant</span><select name="tenant_id"><option value="">Use property tenant</option>${userOptions("tenant")}</select></label>
      <label><span>Asset Name</span><input name="name" required></label>
      <label><span>Condition</span><select name="condition" required><option>Excellent</option><option>Good</option><option>Needs repair</option><option>Damaged</option></select></label>
      <label><span>Quantity</span><input name="quantity" inputmode="numeric" value="1" required></label>
      <label><span>Last Checked</span><input name="last_checked_on" type="date"></label>
      <label class="wide-field"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
      <button class="button button-primary" type="submit">Save Asset</button>
    </form>
  `;
}

function listingForm() {
  return `
    <form class="admin-form" data-create="listings">
      <h3>Add rent or ad listing</h3>
      <label><span>Title</span><input name="title" required></label>
      <label><span>Locality</span><input name="locality" required></label>
      <label class="wide-field"><span>Address</span><input name="address"></label>
      <label><span>Type</span><select name="type"><option>Apartment</option><option>Villa</option><option>Ad listing</option><option>Independent House</option></select></label>
      <label><span>Bedrooms</span><input name="bedrooms" placeholder="2 BHK"></label>
      <label><span>Bathrooms</span><input name="bathrooms" inputmode="numeric"></label>
      <label><span>Furnishing</span><select name="furnishing"><option>Fully furnished</option><option>Semi furnished</option><option>Unfurnished</option></select></label>
      <label><span>Monthly Rent</span><input name="rent" inputmode="numeric" required></label>
      <label><span>Deposit</span><input name="deposit" inputmode="numeric"></label>
      <label><span>Available From</span><input name="available_from" type="date"></label>
      <label><span>Status</span><select name="status"><option>Available</option><option>Booked</option><option>Promoted</option><option>Draft</option></select></label>
      <label><span>Publish for Rent</span><select name="for_rent"><option value="true">Yes</option><option value="false">No</option></select></label>
      <label><span>Use as Ad Listing</span><select name="for_ad"><option value="true">Yes</option><option value="false">No</option></select></label>
      <label class="wide-field"><span>Primary Image URL</span><input name="image_url" placeholder="https://"></label>
      <label class="wide-field"><span>Additional Photo URLs</span><textarea name="image_urls" rows="3" placeholder="https://..."></textarea></label>
      <label class="wide-field"><span>Upload Photos</span><input name="listing_images" type="file" accept="image/*" multiple></label>
      <label class="wide-field"><span>Video URL</span><input name="video_url" placeholder="https://"></label>
      <label class="wide-field"><span>Upload Video</span><input name="listing_video" type="file" accept="video/*"></label>
      <label class="wide-field"><span>Description</span><textarea name="description" rows="3" required></textarea></label>
      <button class="button button-primary" type="submit">Publish Listing</button>
    </form>
  `;
}

async function payloadFromForm(form, resource) {
  const formData = new FormData(form);
  const payload = {};

  formData.forEach((value, key) => {
    if (value instanceof File) return;
    payload[key] = value;
  });

  if (resource === "properties") {
    payload.uploaded_image_urls = await filesToDataUrls(form.elements.property_images?.files || []);
  }

  if (resource === "inspections") {
    payload.uploaded_image_urls = await filesToDataUrls(form.elements.inspection_images?.files || []);
  }

  if (resource === "listings") {
    payload.uploaded_image_urls = await filesToDataUrls(form.elements.listing_images?.files || []);
    const videoUrls = await filesToDataUrls(form.elements.listing_video?.files || []);
    payload.uploaded_video_url = videoUrls[0] || "";
  }

  return payload;
}

function filesToDataUrls(files) {
  return Promise.all(Array.from(files).map(fileToDataUrl));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

function renderStats(stats) {
  return `
    <div class="stat-grid">
      ${Object.entries(stats || {}).map(([label, value]) => `
        <article class="stat-card">
          <span>${humanize(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function renderInspectionCards(inspections) {
  const withImages = inspections.filter((inspection) => mediaUrls(inspection).length);
  if (!withImages.length) return `<div class="empty-state">Inspection images will appear here after admin uploads them.</div>`;

  return `
    <div class="inspection-grid">
      ${withImages.map((inspection) => {
        const images = mediaUrls(inspection);
        return `
          <article class="inspection-card">
            <div class="inspection-card-header">
              <div>
                <h3>${escapeHtml(inspection.property_title || "Inspection")}</h3>
                <p>${escapeHtml(inspection.scheduled_on || "")} · ${escapeHtml(inspection.status || "")}</p>
              </div>
              <span class="badge">${images.length} image${images.length === 1 ? "" : "s"}</span>
            </div>
            ${renderMediaGallery(images, inspection.property_title || "Inspection image")}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderPropertyCards(properties, isOwner = false) {
  if (!properties.length) return `<div class="empty-state">No properties assigned yet.</div>`;

  return `
    <div class="card-grid">
      ${properties.map((property) => `
        <article class="data-card">
          <img src="${escapeAttr(property.image_url || fallbackImage())}" alt="${escapeAttr(property.title)}">
          <div class="data-card-body">
            <span class="badge ${property.occupancy_status === 'Occupied' ? 'badge-occupied' : 'badge-vacant'}">${escapeHtml(property.occupancy_status || property.status || "Managed")}</span>
            <h3>${escapeHtml(property.title)}</h3>
            <p>${escapeHtml(property.address || "")}</p>
            <div class="record-meta">
              <span>${escapeHtml(property.locality || "Bangalore")}</span>
              <span>${escapeHtml(property.bedrooms || "Home")}</span>
              <span>${escapeHtml(property.furnishing || "Managed")}</span>
            </div>
            ${isOwner ? `
              <div class="occupancy-row">
                <span class="occupancy-status">${property.occupied_units || 0} unit(s) occupied</span>
                ${property.years_completed > 0 ? `<span class="hike-info">${property.years_completed} year(s) completed</span>` : ''}
              </div>
            ` : ''}
            <div class="price-row">
              <div><small>Base Rent</small><strong>${money(property.rent)}</strong></div>
              <div><small>Current Rent</small><strong class="current-rent">${money(property.total_current_rent || property.current_base_rent || property.rent)}</strong></div>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderMiniGallery(urls, label) {
  const images = urls.slice(1, 4);
  if (!images.length) return "";

  return `
    <div class="mini-gallery">
      ${images.map((url, index) => `<img src="${escapeAttr(url)}" alt="${escapeAttr(label)} photo ${index + 2}">`).join("")}
    </div>
  `;
}

function renderMediaGallery(urls, label) {
  return `
    <div class="media-gallery">
      ${urls.map((url, index) => `
        <a href="${escapeAttr(url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeAttr(label)} ${index + 1}">
          <img src="${escapeAttr(url)}" alt="${escapeAttr(label)} ${index + 1}">
        </a>
      `).join("")}
    </div>
  `;
}

function renderTable(records, columns, emptyMessage) {
  if (!records || !records.length) {
    return `<div class="empty-state">${escapeHtml(emptyMessage || "No records yet.")}</div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column[1])}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              ${columns.map((column) => {
                const key = column[0];
                const formatter = column[2];
                // If formatter is provided, trust it returns safe HTML (don't escape)
                // Otherwise escape the raw value
                if (formatter) {
                  const value = formatter(record[key], record);
                  return `<td>${value}</td>`;
                } else {
                  return `<td>${escapeHtml(record[key])}</td>`;
                }
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function propertyColumns() {
  return [
    ["title", "Property"],
    ["flat_no", "Flat"],
    ["locality", "Locality"],
    ["owner_name", "Owner"],
    ["tenant_summary", "Tenants", formatTenantSummary],
    ["rent", "Base Rent", money],
    ["current_base_rent", "Current Rent", money],
    ["status", "Status"],
    ["actions", "Actions", renderPropertyActions]
  ];
}

function renderPropertyActions(value, record) {
  return `
    <div class="property-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="properties" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-primary" data-action="manage-tenants" data-id="${record.id}">Manage Tenants</button>
    </div>
  `;
}

function renderPaymentActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="payments" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="payments" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function renderInspectionActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="inspections" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="inspections" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function renderAssetActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="assets" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="assets" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function renderListingActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="listings" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="listings" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function renderUserActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-light" data-action="edit" data-resource="users" data-id="${record.id}">Edit</button>
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="users" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function renderTenantManagement(property) {
  const roomTenants = property.room_tenants || [];
  const availableRooms = (property.bedrooms || "1 BHK").match(/(\d+)/)?.[0] || "3";
  
  return `
    <div class="tenant-management-panel">
      <div class="panel-header">
        <div>
          <h3>Manage Tenants for ${property.title} - ${property.flat_no}</h3>
          <p>Add or update tenants for this property. Current: ${roomTenants.length} room(s) occupied.</p>
        </div>
        <button type="button" class="button button-light" id="backToProperties">← Back to Properties</button>
      </div>
      
      <div class="property-summary">
        <div class="summary-card">
          <h4>Property Details</h4>
          <div class="summary-row"><span>Address:</span><span>${property.address}, ${property.locality}</span></div>
          <div class="summary-row"><span>Base Rent:</span><span>${money(property.rent || 0)}</span></div>
          <div class="summary-row"><span>Current Rent:</span><span class="highlight">${money(property.current_base_rent || property.rent || 0)}</span></div>
          <div class="summary-row"><span>Agreement Start:</span><span>${property.lease_start ? new Date(property.lease_start).toLocaleDateString() : 'Not set'}</span></div>
          <div class="summary-row"><span>Years Completed:</span><span>${property.years_completed || 0}</span></div>
          <div class="summary-row"><span>Annual Hike:</span><span>${property.annual_hike_percent || 5}%</span></div>
        </div>
      </div>
      
      <div class="tenant-assignments">
        <h4>Room-wise Tenant Assignments</h4>
        <form id="tenantManagementForm" data-property-id="${property.id}">
          <div id="manageRoomTenantsContainer">
            ${roomTenants.map((rt, index) => `
              <div class="room-tenant-assignment" data-room-index="${index}">
                <div class="room-header">
                  <h5>${rt.room}</h5>
                  <button type="button" class="button button-small button-light remove-room-btn" data-room="${rt.room}">Remove</button>
                </div>
                <div class="assignment-fields">
                  <label><span>Room Name</span><input type="text" name="room_${index}_name" value="${rt.room}" required></label>
                  <label><span>Tenant</span>
                    <select name="room_${index}_tenant" required>
                      <option value="">Select Tenant</option>
                      ${userOptions("tenant", rt.tenant_id)}
                    </select>
                  </label>
                  <label><span>Base Rent</span><input type="number" name="room_${index}_rent" value="${rt.rent}" required></label>
                  <label><span>Current Rent</span><input type="text" readonly value="${money(rt.current_rent || rt.rent)}" class="calculated-rent"></label>
                  <label><span>Lease Start</span><input type="date" name="room_${index}_lease_start" value="${rt.lease_start || property.lease_start || ''}"></label>
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="add-new-room">
            <h5>Add New Room Tenant</h5>
            <div class="new-room-fields">
              <label><span>Room Name</span><input type="text" id="newRoomName" placeholder="e.g., Master Bedroom"></label>
              <label><span>Tenant</span>
                <select id="newRoomTenant">
                  <option value="">Select Tenant</option>
                  ${userOptions("tenant")}
                </select>
              </label>
              <label><span>Base Rent</span><input type="number" id="newRoomRent" placeholder="Amount"></label>
              <label><span>Lease Start</span><input type="date" id="newRoomLeaseStart" value="${property.lease_start || ''}"></label>
              <button type="button" class="button button-light" id="addNewRoomBtn">+ Add Room Tenant</button>
            </div>
          </div>
          
          <input type="hidden" name="room_tenants" id="manageRoomTenantsData">
          <div class="form-actions">
            <button type="button" class="button button-light" id="cancelTenantManagement">Cancel</button>
            <button type="submit" class="button button-primary">Save Tenant Assignments</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function formatTenantSummary(value, record) {
  if (!value) return "Vacant";
  
  // Check if this is a room-wise property
  const roomTenants = record.room_tenants || [];
  if (roomTenants.length > 0) {
    // Return expandable room details
    const roomDetails = roomTenants.map(rt => 
      `<div class="room-tenant-row">
        <span class="room-name">${rt.room}</span>
        <span class="room-tenant">${rt.tenant_name}</span>
        <span class="room-rent">${money(rt.rent)}</span>
      </div>`
    ).join("");
    
    return `
      <div class="room-tenant-summary">
        <span class="tenant-count">${roomTenants.length} rooms</span>
        <div class="room-details">${roomDetails}</div>
      </div>
    `;
  }
  
  return value;
}

function paymentColumns() {
  return [
    ["property_title", "Property"],
    ["category", "Category"],
    ["tenant_name", "Tenant"],
    ["owner_name", "Owner"],
    ["amount", "Amount", money],
    ["due_date", "Due"],
    ["paid_on", "Paid On"],
    ["status", "Status"],
    ["reference", "Reference"],
    ["actions", "Actions", renderPaymentActions]
  ];
}

function ownerPaymentColumns() {
  return [
    ["property_title", "Property"],
    ["category", "Category"],
    ["amount", "Amount", money],
    ["due_date", "Due"],
    ["paid_on", "Paid On"],
    ["status", "Status"],
    ["reference", "Reference"]
    // Note: tenant_name and owner_name removed for owner view
  ];
}

function assetColumns() {
  return [
    ["property_title", "Property"],
    ["name", "Asset"],
    ["condition", "Condition"],
    ["quantity", "Qty"],
    ["last_checked_on", "Last Checked"],
    ["notes", "Notes"],
    ["actions", "Actions", renderAssetActions]
  ];
}

function inquiryColumns() {
  return [
    ["name", "Name"],
    ["phone", "Phone"],
    ["interest", "Type", formatInquiryType],
    ["details", "Details", formatInquiryDetails],
    ["created_at", "Received"],
    ["actions", "Actions", renderInquiryActions]
  ];
}

function renderInquiryActions(value, record) {
  return `
    <div class="table-actions">
      <button type="button" class="button button-small button-danger" data-action="delete" data-resource="inquiries" data-id="${record.id}">Delete</button>
    </div>
  `;
}

function formatInquiryType(value, record) {
  const typeMap = {
    "owner": "Property Owner",
    "tenant": "Looking for Home",
    "ad": "Ad Listing",
    "renovation": "Renovation"
  };
  return typeMap[value] || value;
}

function formatInquiryDetails(value, record) {
  if (record.interest === "owner") {
    const parts = [];
    if (record.property_type) parts.push(record.property_type);
    if (record.property_size) parts.push(record.property_size);
    if (record.area) parts.push(record.area);
    if (record.expected_rent) parts.push(`₹${record.expected_rent}`);
    return parts.join(" • ") || record.message?.substring(0, 50) || "-";
  }
  if (record.interest === "tenant") {
    const parts = [];
    if (record.looking_for) parts.push(record.looking_for);
    if (record.preferred_area) parts.push(record.preferred_area);
    if (record.budget) parts.push(`Budget: ₹${record.budget}`);
    return parts.join(" • ") || record.message?.substring(0, 50) || "-";
  }
  return record.message?.substring(0, 50) || "-";
}

function mediaUrls(record) {
  const urls = [
    ...(Array.isArray(record?.photo_urls) ? record.photo_urls : []),
    ...(Array.isArray(record?.image_urls) ? record.image_urls : []),
    record?.image_url
  ];

  return [...new Set(urls.map((url) => String(url || "").trim()).filter(Boolean))];
}

function mediaSummary(value, record) {
  const count = mediaUrls(record || { image_urls: value, photo_urls: value }).length;
  return count ? `${count} image${count === 1 ? "" : "s"}` : "No images";
}

function videoSummary(value) {
  return value ? "Video attached" : "No video";
}

function userOptions(role) {
  return (state.dashboard.users || [])
    .filter((user) => user.role === role)
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} - ${escapeHtml(user.email)}</option>`)
    .join("");
}

function propertySpecificUserOptions(role, propertyId) {
  if (!propertyId) return userOptions(role);
  
  const property = (state.dashboard.properties || []).find(p => p.id == propertyId);
  if (!property) return userOptions(role);
  
  if (role === "owner") {
    const owner = (state.dashboard.users || []).find(u => u.id == property.owner_id);
    return owner ? `<option value="${owner.id}">${escapeHtml(owner.name)} - ${escapeHtml(owner.email)}</option>` : "";
  } else if (role === "tenant") {
    const tenants = [];
    
    // Add single tenant if assigned
    if (property.tenant_id) {
      const tenant = (state.dashboard.users || []).find(u => u.id == property.tenant_id);
      if (tenant) {
        tenants.push(`<option value="${tenant.id}">${escapeHtml(tenant.name)} - ${escapeHtml(tenant.email)}</option>`);
      }
    }
    
    // Add room-wise tenants
    if (property.room_tenants && property.room_tenants.length > 0) {
      property.room_tenants.forEach(rt => {
        if (rt.tenant_id) {
          const tenant = (state.dashboard.users || []).find(u => u.id == rt.tenant_id);
          if (tenant) {
            tenants.push(`<option value="${tenant.id}">${escapeHtml(tenant.name)} (${rt.room}) - ${escapeHtml(tenant.email)}</option>`);
          }
        }
      });
    }
    
    return tenants.join("");
  }
  
  return userOptions(role);
}

function propertyOptions() {
  return (state.dashboard.properties || [])
    .map((property) => `<option value="${property.id}">${escapeHtml(property.title)}</option>`)
    .join("");
}

function openLogin() {
  loginOverlay.hidden = false;
  loginStatus.textContent = "";
  setTimeout(() => loginForm.email.focus(), 0);
}

function closeLogin() {
  loginOverlay.hidden = true;
}

function loadSession() {
  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (_error) {
    return null;
  }
}

function saveSession(user) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    identifier: user.identifier || user.email,
    isAdmin: user.isAdmin || user.role === "admin"
  }));
}

function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function roleSubtitle(role) {
  if (role === "admin") return "Create accounts, enter property details, assign tenants, record inspections, manage assets, and publish rent listings.";
  if (role === "owner") return "View your managed properties, inspections, and payment records.";
  return "View your assigned property, inventory assets, and payment records.";
}

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(number);
}

function humanize(value) {
  return value.toString().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capitalize(value) {
  return value.toString().charAt(0).toUpperCase() + value.toString().slice(1);
}

String.prototype.singularize = function() {
  const plural = this.toString();
  if (plural.endsWith("ies")) return plural.slice(0, -3) + "y";
  if (plural.endsWith("es")) return plural.slice(0, -2);
  if (plural.endsWith("s") && plural.length > 1) return plural.slice(0, -1);
  return plural;
};

function fallbackImage() {
  return "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1200&q=80";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// Initialize the application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
