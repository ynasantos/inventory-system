import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

let rows = [];
let clearContext = null;

async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    window.location.href = "./index.html";
    return null;
  }
  return data.user;
}

async function getMyRole(userId) {
  const cachedRole = String(localStorage.getItem("kairo_role") || "").trim().toLowerCase();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Role read failed:", error);
    return cachedRole || "staff";
  }
  return String(data?.role || cachedRole || "staff").trim().toLowerCase();
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

function isForeignKeyError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "23503" || message.includes("foreign key");
}

function isPolicyError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "").toLowerCase();
  return code === "42501" || message.includes("policy") || message.includes("permission denied");
}

function renderTable() {
  const query = (el("search")?.value || "").trim().toLowerCase();
  const filtered = rows.filter((r) => String(r.product_names || "").toLowerCase().includes(query));

  el("note").textContent = filtered.length ? "" : "No transactions found.";

  el("historyBody").innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.product_names || "-")}</td>
        <td>${peso(r.total)}</td>
        <td>${fmtDate(r.created_at)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadSaleItemNames(saleIds) {
  if (!saleIds.length) return {};

  const { data, error } = await supabase
    .from("sale_items")
    .select("sale_id, qty, products:product_id(name)")
    .in("sale_id", saleIds);

  if (error) return {};

  const map = {};
  (data || []).forEach((row) => {
    const saleId = String(row.sale_id || "");
    if (!saleId) return;
    const name = String(row.products?.name || "Unknown");
    const qty = Number(row.qty || 0);
    const label = qty > 0 ? `${name} x${qty}` : name;

    if (!map[saleId]) map[saleId] = [];
    map[saleId].push(label);
  });

  return map;
}

async function loadHistory(userId, role) {
  el("note").textContent = "Loading transactions…";
  const isAdmin = role === "admin";

  let query = supabase
    .from("sales")
    .select("id,total,created_at,user_id")
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    el("note").textContent = "Cannot load transactions: " + error.message;
    el("historyBody").innerHTML = "";
    return;
  }

  const sales = data || [];
  const saleIds = sales.map((s) => s.id).filter(Boolean);
  const itemNameMap = await loadSaleItemNames(saleIds);

  if (isAdmin && sales.length > 0 && Object.keys(itemNameMap).length === 0) {
    el("note").textContent = "Admin loaded all sales, but item names are restricted by DB policy (sale_items).";
  }

  rows = sales.map((sale) => {
    const names = itemNameMap[String(sale.id)] || [];
    return {
      ...sale,
      product_names: names.length ? names.join(", ") : "(No item data)",
    };
  });

  renderTable();
}

function openClearModal(userId, role) {
  if (role !== "admin") return;
  clearContext = { userId, role };
  const isAdmin = role === "admin";
  const text = el("clearModalText");
  if (text) {
    text.textContent = isAdmin
      ? "Clear all transaction history? This cannot be undone."
      : "Clear your transaction history? This cannot be undone.";
  }
  el("clearModal")?.classList.add("show");
}

function closeClearModal() {
  clearContext = null;
  el("clearModal")?.classList.remove("show");
}

async function clearHistory(userId, role) {
  if (role !== "admin") {
    el("note").textContent = "Only admin can clear transaction history.";
    return;
  }
  const isAdmin = role === "admin";

  el("note").textContent = "Clearing history…";

  let salesQuery = supabase.from("sales").select("id");
  if (!isAdmin) salesQuery = salesQuery.eq("user_id", userId);

  const { data: salesRows, error: salesReadErr } = await salesQuery;
  if (salesReadErr) {
    el("note").textContent = "Cannot clear history: " + salesReadErr.message;
    return;
  }

  const saleIds = (salesRows || []).map((row) => row.id).filter(Boolean);
  if (!saleIds.length) {
    el("note").textContent = "No transactions found to clear.";
    return;
  }

  const deleteSales = async () => {
    let query = supabase.from("sales").delete().in("id", saleIds);
    if (!isAdmin) query = query.eq("user_id", userId);
    return query;
  };

  let { error: salesDeleteErr } = await deleteSales();

  if (salesDeleteErr && isForeignKeyError(salesDeleteErr)) {
    const { error: itemDeleteErr } = await supabase
      .from("sale_items")
      .delete()
      .in("sale_id", saleIds);

    if (itemDeleteErr && !isMissingTableError(itemDeleteErr)) {
      el("note").textContent = "Cannot clear history (sale_items): " + itemDeleteErr.message;
      return;
    }

    const retry = await deleteSales();
    salesDeleteErr = retry.error;
  }

  if (salesDeleteErr) {
    if (isPolicyError(salesDeleteErr)) {
      el("note").textContent = "Cannot clear history: delete blocked by RLS policy for this account.";
      return;
    }
    el("note").textContent = "Cannot clear history: " + salesDeleteErr.message;
    return;
  }

  closeClearModal();
  await loadHistory(userId, role);
}

function applyNavByRole(role) {
  const navDashboard = el("navDashboard");
  const navInventory = el("navInventory");
  const navReports = el("navReports");
  const navAdmin = el("navAdmin");

  if (role === "admin") {
    if (navDashboard) navDashboard.style.display = "block";
    if (navInventory) navInventory.style.display = "block";
    if (navReports) navReports.style.display = "block";
    if (navAdmin) navAdmin.style.display = "block";
    return;
  }

  if (role !== "staff") {
    if (navDashboard) navDashboard.style.display = "block";
    if (navInventory) navInventory.style.display = "block";
    if (navReports) navReports.style.display = "block";
    if (navAdmin) navAdmin.style.display = "none";
    return;
  }

  if (navDashboard) navDashboard.style.display = "none";
  if (navInventory) navInventory.style.display = "none";
  if (navReports) navReports.style.display = "none";
  if (navAdmin) navAdmin.style.display = "none";
}

async function main() {
  const user = await requireAuth();
  if (!user) return;

  el("userEmail").textContent = user.email || "(no email)";

  const cachedRole = normalizeRole(localStorage.getItem("kairo_role"));
  if (cachedRole) applyNavByRole(cachedRole);

  const role = await getMyRole(user.id);
  localStorage.setItem("kairo_role", role);
  document.documentElement.classList.remove("role-admin", "role-staff", "role-user");
  if (role === "admin") {
    document.documentElement.classList.add("role-admin");
  } else if (role === "staff") {
    document.documentElement.classList.add("role-staff");
  } else {
    document.documentElement.classList.add("role-user");
  }
  el("userRole").textContent = role;

  applyNavByRole(role);

  if (role !== "admin" && el("clearBtn")) {
    el("clearBtn").style.display = "none";
  }

  el("search")?.addEventListener("input", renderTable);
  el("clearBtn")?.addEventListener("click", () => openClearModal(user.id, role));
  el("clearCancelBtn")?.addEventListener("click", closeClearModal);
  el("clearConfirmBtn")?.addEventListener("click", async () => {
    if (!clearContext) return;
    await clearHistory(clearContext.userId, clearContext.role);
  });
  el("clearModal")?.addEventListener("click", (event) => {
    if (event.target === el("clearModal")) closeClearModal();
  });
  el("refreshBtn")?.addEventListener("click", () => loadHistory(user.id, role));

  el("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("kairo_role");
    document.documentElement.classList.remove("role-admin", "role-staff", "role-user");
    window.location.href = "./index.html";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeClearModal();
  });

  await loadHistory(user.id, role);
}

main();
