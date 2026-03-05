import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

let rows = [];

async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    window.location.href = "./index.html";
    return null;
  }
  return data.user;
}

async function getMyRole(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Role read failed:", error);
    return "staff";
  }
  return String(data?.role || "staff").trim().toLowerCase();
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

  const attempts = ["sale_items", "sales_items"];

  for (const table of attempts) {
    const { data, error } = await supabase
      .from(table)
      .select("sale_id, qty, products:product_id(name)")
      .in("sale_id", saleIds);

    if (error) continue;

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

  return {};
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
    el("note").textContent = "Admin loaded all sales, but item names are restricted by DB policy (sale_items/sales_items).";
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

  el("search")?.addEventListener("input", renderTable);
  el("refreshBtn")?.addEventListener("click", () => loadHistory(user.id, role));

  el("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("kairo_role");
    document.documentElement.classList.remove("role-admin", "role-staff", "role-user");
    window.location.href = "./index.html";
  });

  await loadHistory(user.id, role);
}

main();
