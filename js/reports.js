import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;
const setText = (id, value) => {
  const node = el(id);
  if (node) node.textContent = value;
};

let currentUser = null;
let currentRole = "";

async function requireAuth() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    window.location.href = "./index.html";
    return null;
  }
  return data.user;
}

async function getRole(userId) {
  const cachedRole = String(localStorage.getItem("kairo_role") || "").trim().toLowerCase();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) return cachedRole || "staff";
  return String(data?.role || cachedRole || "staff").trim().toLowerCase();
}

function toRange(startDateStr, endDateStr) {
  const start = new Date(startDateStr + "T00:00:00");
  const end = new Date(endDateStr + "T00:00:00");
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateShort(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(dt = new Date()) {
  return dt.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function updatePrintMeta() {
  const startDate = el("startDate")?.value || "";
  const endDate = el("endDate")?.value || "";
  const range = `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
  setText("printRange", range);
  setText("printGenerated", formatDateTime(new Date()));
  const email = currentUser?.email || "(no email)";
  const role = currentRole || "user";
  setText("printPreparedBy", `${email} (${role})`);
}

function resetReportView() {
  el("orders").textContent = "0";
  el("itemsSold").textContent = "0";
  el("revenue").textContent = peso(0);
  el("avgOrder").textContent = peso(0);

  el("fastNote").textContent = "No sales in this range.";
  el("fastBody").innerHTML = "";

  el("slowNote").textContent = "No products found.";
  el("slowBody").innerHTML = "";
}

async function loadTransactionHistoryData(userId, role, start, end) {
  let salesQuery = supabase
    .from("sales")
    .select("id,total,user_id,created_at")
    .gte("created_at", start)
    .lt("created_at", end);

  if (role !== "admin") {
    salesQuery = salesQuery.eq("user_id", userId);
  }

  const { data: salesRows, error: salesErr } = await salesQuery;
  if (salesErr) {
    throw new Error("Transaction read error (sales): " + salesErr.message);
  }

  const saleIds = (salesRows || []).map((row) => row.id).filter(Boolean);
  if (!saleIds.length) {
    return { salesRows: salesRows || [], itemRows: [] };
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from("sale_items")
    .select("sale_id, product_id, qty, products:product_id(name,price)")
    .in("sale_id", saleIds);

  if (itemErr) {
    throw new Error("Transaction read error (sale_items): " + itemErr.message);
  }

  return { salesRows: salesRows || [], itemRows: itemRows || [] };
}

function computeSummaryFromTransactions(salesRows, itemRows) {
  const orders = (salesRows || []).length;
  const revenue = (salesRows || []).reduce((sum, row) => sum + asNumber(row.total), 0);
  const itemsSold = (itemRows || []).reduce((sum, row) => sum + asNumber(row.qty), 0);
  const avgOrder = orders > 0 ? revenue / orders : 0;

  return {
    orders,
    items_sold: itemsSold,
    revenue,
    avg_order: avgOrder,
  };
}

function computeProductRanking(itemRows, sortDir = "desc") {
  const aggregate = new Map();

  for (const row of itemRows || []) {
    const name = String(row.products?.name || "Unknown");
    const qty = asNumber(row.qty, 0);
    const price = asNumber(row.products?.price, 0);

    const current = aggregate.get(name) || { name, qty: 0, revenue: 0 };
    current.qty += qty;
    current.revenue += qty * price;
    aggregate.set(name, current);
  }

  const rows = [...aggregate.values()];
  rows.sort((a, b) => {
    if (sortDir === "asc") return (a.qty - b.qty) || (a.revenue - b.revenue);
    return (b.qty - a.qty) || (b.revenue - a.revenue);
  });

  return rows;
}

async function loadAll(userId, role) {
  el("err").textContent = "";
  resetReportView();

  const startDate = el("startDate").value;
  const endDate = el("endDate").value;
  const { start, end } = toRange(startDate, endDate);

  let txData;
  try {
    txData = await loadTransactionHistoryData(userId, role, start, end);
  } catch (txErr) {
    el("err").textContent = String(txErr.message || txErr);
    el("lowNote").textContent = "";
    el("lowBody").innerHTML = "";
    return;
  }

  console.group("[REPORT TX DEBUG]");
  console.log("range:", { start, end, role, userId });
  console.log("sales rows:", (txData.salesRows || []).length);
  console.log("item rows:", (txData.itemRows || []).length);
  console.groupEnd();

  if ((txData.salesRows || []).length > 0 && (txData.itemRows || []).length === 0) {
    el("err").textContent = "Sales exist, but transaction item rows are empty. Check sale_items data/RLS for this account.";
  }

  const summary = computeSummaryFromTransactions(txData.salesRows, txData.itemRows);
  el("orders").textContent = summary.orders;
  el("itemsSold").textContent = summary.items_sold;
  el("revenue").textContent = peso(summary.revenue);
  el("avgOrder").textContent = peso(summary.avg_order);

  const fastRows = computeProductRanking(txData.itemRows, "desc").slice(0, 10);
  el("fastNote").textContent = fastRows.length
    ? ""
    : ((txData.salesRows || []).length ? "No transaction item details found." : "No sales in this range.");
  el("fastBody").innerHTML = fastRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.qty}</td>
        <td>${peso(row.revenue)}</td>
      </tr>
    `
    )
    .join("");

  const slowRows = computeProductRanking(txData.itemRows, "asc").slice(0, 10);
  el("slowNote").textContent = slowRows.length
    ? ""
    : ((txData.salesRows || []).length ? "No transaction item details found." : "No products found.");
  el("slowBody").innerHTML = slowRows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.qty}</td>
        <td>${peso(row.revenue)}</td>
      </tr>
    `
    )
    .join("");

  el("lowNote").textContent = "Loading…";
  const low = await supabase.rpc("report_low_stock");
  if (low.error) {
    el("lowNote").textContent = "Error: " + low.error.message;
    el("lowBody").innerHTML = "";
  } else {
    const rows = low.data || [];
    el("lowNote").textContent = rows.length ? "" : "No low-stock items 🎉";
    el("lowBody").innerHTML = rows
      .map(
        (row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.stock}</td>
        <td>${row.min_stock}</td>
        <td>
          <span class="badge ${row.status === "OUT" ? "out" : "low"}">${row.status}</span>
        </td>
      </tr>
    `
      )
      .join("");
  }

  updatePrintMeta();
}

async function main() {
  const user = await requireAuth();
  if (!user) return;
  currentUser = user;

  el("userEmail").textContent = user.email || "(no email)";

  const role = await getRole(user.id);
  currentRole = role;
  localStorage.setItem("kairo_role", role);
  el("userRole").textContent = role;

  if (role === "staff") {
    window.location.href = "./sales.html";
    return;
  }

  if (role !== "admin") el("navAdmin").style.display = "none";

  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(start.getDate() - 30);

  el("startDate").value = start.toISOString().slice(0, 10);
  el("endDate").value = end.toISOString().slice(0, 10);

  el("applyBtn").addEventListener("click", () => loadAll(user.id, role));
  el("printBtn").addEventListener("click", () => {
    updatePrintMeta();
    window.print();
  });

  el("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("kairo_role");
    window.location.href = "./index.html";
  });

  await loadAll(user.id, role);
}

main();


