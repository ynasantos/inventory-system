import { supabase } from "./supabase.js";

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;
const el = (id) => document.getElementById(id);

function showFatal(msg) {
  // show in sidebar instead of staying Loading…
  const who = el("who");
  const role = el("role");
  if (who) who.textContent = "Error";
  if (role) role.textContent = msg;
  console.error("DASHBOARD FATAL:", msg);
}

async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("getUser error:", error);
    showFatal("Auth error: " + error.message);
    return null;
  }
  if (!data?.user) {
    window.location.href = "./index.html";
    return null;
  }
  return data.user;
}

async function getMyRole(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role,full_name")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Role read failed:", error);
    // show it on UI so you see why it’s stuck
    showFatal("Role read failed: " + error.message);
    return { role: "staff", full_name: "" };
  }

  return {
    role: String(data?.role || "staff").trim().toLowerCase(),
    full_name: data?.full_name || "",
  };
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadCounts(userId) {
  // Products count
  const { count: productCount, error: prodErr } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true });

  if (prodErr) console.error("Products count error:", prodErr);
  el("productCount").textContent = productCount ?? 0;

  // Low stock list
  const { data: lowList, error: lowErr } = await supabase
    .from("inventory")
    .select("stock, products:product_id(id,name,min_stock)")
    .order("updated_at", { ascending: true });

  if (lowErr) {
    console.error("Low stock error:", lowErr);
    el("lowStockNote").textContent = "Cannot load low stock: " + lowErr.message;
    el("lowStockList").innerHTML = "";
    el("lowStockCount").textContent = "0";
  } else {
    const lows = (lowList || [])
      .map((row) => ({
        name: row.products?.name ?? "Unknown",
        stock: row.stock ?? 0,
        min: row.products?.min_stock ?? 0,
      }))
      .filter((x) => x.stock <= x.min);

    el("lowStockCount").textContent = lows.length;

    if (lows.length === 0) {
      el("lowStockNote").textContent = "No low-stock items 🎉";
      el("lowStockList").innerHTML = "";
    } else {
      el("lowStockNote").textContent = "Items that need restocking:";
      el("lowStockList").innerHTML = lows
        .map((x) => {
          const isOut = x.stock <= 0;
          return `
            <div class="list-item">
              <div>
                <div class="li-title">${escapeHtml(x.name)}</div>
                <div class="li-sub">Stock: ${x.stock} • Min: ${x.min}</div>
              </div>
              <div class="badge">${isOut ? "OUT" : "LOW"}</div>
            </div>
          `;
        })
        .join("");
    }
  }

  // Sales totals (timezone-safe)
  const now = new Date();
  const startOfTodayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfTodayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const startOfMonthLocal = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

  const startTodayISO = startOfTodayLocal.toISOString();
  const endTodayISO = endOfTodayLocal.toISOString();
  const startMonthISO = startOfMonthLocal.toISOString();

  const { data: todaySales, error: todayErr } = await supabase
    .from("sales")
    .select("total,created_at")
    .eq("user_id", userId)
    .gte("created_at", startTodayISO)
    .lt("created_at", endTodayISO);

  if (todayErr) console.error("Today sales error:", todayErr);

  const { data: monthSales, error: monthErr } = await supabase
    .from("sales")
    .select("total,created_at")
    .eq("user_id", userId)
    .gte("created_at", startMonthISO);

  if (monthErr) console.error("Month sales error:", monthErr);

  const todayTotal = (todaySales || []).reduce((a, r) => a + Number(r.total || 0), 0);
  const monthTotal = (monthSales || []).reduce((a, r) => a + Number(r.total || 0), 0);

  el("todaySales").textContent = peso(todayTotal);
  el("todayOrders").textContent = `${(todaySales || []).length} orders`;

  el("monthSales").textContent = peso(monthTotal);
  el("monthOrders").textContent = `${(monthSales || []).length} orders`;
}

async function main() {
  try {
    const user = await requireAuth();
    if (!user) return;

    const { role, full_name } = await getMyRole(user.id);
    localStorage.setItem("kairo_role", role);

    document.documentElement.classList.remove("role-admin", "role-staff", "role-user");
    if (role === "admin") {
      document.documentElement.classList.add("role-admin");
    } else if (role === "staff") {
      document.documentElement.classList.add("role-staff");
    } else {
      document.documentElement.classList.add("role-user");
    }

    if (role === "staff") {
      window.location.href = "./sales.html";
      return;
    }

    el("who").textContent = full_name ? full_name : (user.email || "User");
    el("role").textContent = role;

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await supabase.auth.signOut();
        localStorage.removeItem("kairo_role");
        window.location.href = "./index.html";
      });
    }

    await loadCounts(user.id);
  } catch (e) {
    showFatal("Crash: " + String(e));
  }
}

main();
