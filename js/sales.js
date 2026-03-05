import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

let products = [];
let cart = []; // {product_id, name, price, stock, qty}

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

function applyNavByRole(role) {
  const navDashboard = document.getElementById("navDashboard");
  const navInventory = document.getElementById("navInventory");
  const navReports = document.getElementById("navReports");
  const navAdmin = document.getElementById("navAdmin");

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

function renderProducts() {
  const q = el("search").value.trim().toLowerCase();
  const filtered = products.filter((p) => p.name.toLowerCase().includes(q));

  el("productNote").textContent = filtered.length ? "" : "No matching products.";

  el("productBody").innerHTML = filtered
    .map(
      (p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${peso(p.price)}</td>
      <td>${p.stock}</td>
      <td>
        <button class="btn rowbtn" data-add="${p.id}" aria-label="Add to cart" title="Add" ${p.stock <= 0 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
        </button>
      </td>
    </tr>
  `
    )
    .join("");

  document.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => addToCart(btn.getAttribute("data-add")));
  });
}

function renderCart() {
  el("cartEmpty").style.display = cart.length ? "none" : "block";

  const total = cart.reduce((a, x) => a + x.price * x.qty, 0);
  el("total").textContent = peso(total);

  el("cartBody").innerHTML = cart
    .map(
      (x) => `
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>
        <input data-qty="${x.product_id}" type="number" min="1" value="${x.qty}"
               style="width:70px" />
      </td>
      <td>${peso(x.price * x.qty)}</td>
      <td>
        <button class="btn rowbtn2" data-remove="${x.product_id}">X</button>
      </td>
    </tr>
  `
    )
    .join("");

  document.querySelectorAll("input[data-qty]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const pid = inp.getAttribute("data-qty");
      const item = cart.find((c) => c.product_id === pid);
      if (!item) return;

      if (!Number.isFinite(Number(inp.value)) || Number(inp.value) < 1) inp.value = "1";
      const newQty = Math.max(1, Number(inp.value));

      if (newQty > item.stock) {
        inp.value = String(item.stock);
        item.qty = item.stock;
      } else {
        item.qty = newQty;
      }
      renderCart();
    });
  });

  document.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-remove");
      cart = cart.filter((c) => c.product_id !== pid);
      renderCart();
    });
  });
}

function addToCart(productId) {
  const p = products.find((x) => x.id === productId);
  if (!p) return;

  const existing = cart.find((c) => c.product_id === productId);
  if (existing) {
    if (existing.qty + 1 > existing.stock) return;
    existing.qty += 1;
  } else {
    if (p.stock <= 0) return;
    cart.push({ product_id: p.id, name: p.name, price: p.price, stock: p.stock, qty: 1 });
  }
  renderCart();
}

async function loadProducts() {
  el("productNote").textContent = "Loading products…";

  const { data, error } = await supabase
    .from("inventory")
    .select("stock, products:product_id(id, name, price)")
    .order("updated_at", { ascending: false });

  if (error) {
    el("productNote").textContent = "Cannot load products: " + error.message;
    el("productBody").innerHTML = "";
    return;
  }

  products = (data || [])
    .map((r) => ({
      id: r.products?.id,
      name: r.products?.name ?? "Unknown",
      price: Number(r.products?.price ?? 0),
      stock: Number(r.stock ?? 0),
    }))
    .filter((p) => p.id);

  renderProducts();
}

async function checkout() {
  el("err").textContent = "";
  el("msg").textContent = "";

  if (!cart.length) {
    el("err").textContent = "Cart is empty.";
    return;
  }

  const payload = cart.map((x) => ({ product_id: x.product_id, qty: x.qty }));

  el("msg").textContent = "Processing sale…";

  const { data, error } = await supabase.rpc("record_sale", { items: payload });

  if (error) {
    el("err").textContent = error.message;
    el("msg").textContent = "";
    return;
  }

  cart = [];
  renderCart();
  await loadProducts();
  el("msg").textContent = "✅ Sale saved! Sale ID: " + data;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  const user = await requireAuth();
  if (!user) return;

  el("userEmail").textContent = user.email || "(no email)";

  const cachedRole = normalizeRole(localStorage.getItem("kairo_role"));
  if (cachedRole) applyNavByRole(cachedRole);

  // ✅ role + hide admin tab for staff
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

  const userRoleEl = document.getElementById("userRole");
  if (userRoleEl) userRoleEl.textContent = role;
  applyNavByRole(role);

  el("search").addEventListener("input", renderProducts);

  el("clearBtn").addEventListener("click", () => {
    cart = [];
    renderCart();
    el("err").textContent = "";
    el("msg").textContent = "";
  });

  el("checkoutBtn").addEventListener("click", checkout);

  el("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("kairo_role");
    document.documentElement.classList.remove("role-admin", "role-staff", "role-user");
    window.location.href = "./index.html";
  });

  renderCart();
  await loadProducts();
}

main();
