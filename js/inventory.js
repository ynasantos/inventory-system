import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusBadge(stock, min) {
  const s = Number(stock);
  const m = Number(min);
  if (s <= 0) return `<span class="status out">OUT</span>`;
  if (s <= m) return `<span class="status low">LOW</span>`;
  return `<span class="status ok">OK</span>`;
}

function setMsg(text = "") {
  const m = el("msg");
  if (m) m.textContent = text;
}
function setErr(text = "") {
  const e = el("err");
  if (e) e.textContent = text;
}

async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error) console.error("getUser error:", error);

  if (!data?.user) {
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
    console.error("getMyRole error:", error);
    return "staff";
  }
  return String(data?.role || "staff").trim().toLowerCase();
}

let isAdmin = false;
let allRows = [];
let editingProductId = null;
let editingStockProductId = null;
let archivingRow = null;

function openEditModal(row) {
  editingProductId = row.id;
  if (el("editName")) el("editName").value = row.name || "";
  if (el("editPrice")) el("editPrice").value = String(row.price ?? "");
  el("editModal")?.classList.add("show");
  el("editName")?.focus();
}

function closeEditModal() {
  editingProductId = null;
  el("editModal")?.classList.remove("show");
}

function openStockModal(row) {
  editingStockProductId = row.invProductId;
  if (el("stockValue")) el("stockValue").value = String(row.stock ?? 0);
  el("stockModal")?.classList.add("show");
  el("stockValue")?.focus();
  el("stockValue")?.select();
}

function closeStockModal() {
  editingStockProductId = null;
  el("stockModal")?.classList.remove("show");
}

function openArchiveModal(row) {
  archivingRow = row;
  const text = el("archiveModalText");
  if (text) text.textContent = `Archive ${row.name}?`;
  el("archiveModal")?.classList.add("show");
}

function closeArchiveModal() {
  archivingRow = null;
  el("archiveModal")?.classList.remove("show");
}

async function saveStockModal() {
  if (!editingStockProductId) return;

  const newStock = Number(el("stockValue")?.value);
  if (!Number.isFinite(newStock) || newStock < 0) {
    alert("Invalid stock value.");
    return;
  }

  const { error } = await supabase
    .from("inventory")
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq("product_id", editingStockProductId);

  if (error) {
    alert("Stock update failed: " + error.message);
    return;
  }

  closeStockModal();
  await loadInventory();
}

async function saveEditModal() {
  if (!editingProductId) return;

  const name = String(el("editName")?.value || "").trim();
  const price = Number(el("editPrice")?.value);

  if (!name) {
    alert("Invalid product name.");
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    alert("Invalid price.");
    return;
  }

  const { error } = await supabase
    .from("products")
    .update({ name, price })
    .eq("id", editingProductId);

  if (error) {
    alert("Edit failed: " + error.message);
    return;
  }

  closeEditModal();
  await loadInventory();
}

function closeAllActionMenus() {
  document.querySelectorAll(".action-dropdown.show").forEach((menu) => {
    menu.classList.remove("show");
  });
}

/* =========================
   LOAD INVENTORY
========================= */
async function loadInventory() {
  el("tableNote").textContent = "Loading inventory…";

  const { data, error } = await supabase
    .from("inventory")
    .select("product_id, stock, products:product_id(id, name, price, min_stock)")
    .order("updated_at", { ascending: false });

  if (error) {
    el("tableNote").textContent = "Cannot load inventory: " + error.message;
    return;
  }

  allRows = (data || []).map((r) => ({
    id: r.products?.id || r.product_id,
    invProductId: r.product_id,
    name: r.products?.name ?? "Unknown",
    price: Number(r.products?.price ?? 0),
    min: Number(r.products?.min_stock ?? 0),
    stock: Number(r.stock ?? 0),
  }));

  el("tableNote").textContent = allRows.length ? "" : "No products yet.";
  renderTable(allRows);
}

/* =========================
  ARCHIVE
========================= */
async function archiveProduct(row) {
  setErr("");
  setMsg("Archiving…");

  const { error: invErr } = await supabase
    .from("inventory")
    .delete()
    .eq("product_id", row.invProductId);

  if (invErr) {
    setErr("Archive failed (inventory): " + invErr.message);
    setMsg("");
    return;
  }

  closeArchiveModal();
  setMsg("✅ Archived!");
  await loadInventory();
}

/* =========================
   RENDER TABLE
========================= */
function renderTable(rows) {
  const q = (el("search")?.value || "").trim().toLowerCase();
  const filtered = rows.filter((r) => (r.name || "").toLowerCase().includes(q));

  el("invBody").innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>₱${r.price.toFixed(2)}</td>
        <td>${r.stock}</td>
        <td>${r.min}</td>
        <td>${statusBadge(r.stock, r.min)}</td>
        ${
          isAdmin
            ? `
          <td>
            <div class="action-menu">
              <button class="dot-btn" type="button" aria-label="Actions" data-menu-toggle="${r.id}">⋮</button>
              <div class="action-dropdown" data-menu="${r.id}">
                <button class="menu-item" type="button" data-upstock="${r.invProductId}">Stock</button>
                <button class="menu-item" type="button" data-edit="${r.id}">Edit</button>
                <button class="menu-item danger" type="button" data-archive="${r.id}">Archive</button>
              </div>
            </div>
          </td>`
            : ""
        }
      </tr>
    `
    )
    .join("");

  if (!isAdmin) return;

  // ACTION MENU TOGGLE
  document.querySelectorAll("[data-menu-toggle]").forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      const menuId = btn.dataset.menuToggle;
      const menu = document.querySelector(`[data-menu="${menuId}"]`);
      if (!menu) return;

      const isOpen = menu.classList.contains("show");
      closeAllActionMenus();
      if (!isOpen) menu.classList.add("show");
    };
  });

  // STOCK
  document.querySelectorAll("[data-upstock]").forEach((btn) => {
    btn.onclick = async () => {
      closeAllActionMenus();
      const invId = btn.dataset.upstock;
      const row = allRows.find((x) => String(x.invProductId) === String(invId));
      if (!row) return;
      openStockModal(row);
    };
  });

  // EDIT (name + price)
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => {
      closeAllActionMenus();
      const productId = btn.dataset.edit;
      const row = allRows.find((x) => String(x.id) === String(productId));
      if (!row) return;
      openEditModal(row);
    };
  });

  // ARCHIVE
  document.querySelectorAll("[data-archive]").forEach((btn) => {
    btn.onclick = () => {
      closeAllActionMenus();
      const row = allRows.find((x) => String(x.id) === String(btn.dataset.archive));
      if (row) openArchiveModal(row);
    };
  });
}

/* =========================
   ADD PRODUCT
========================= */
async function addProduct() {
  setErr("");
  setMsg("");

  const name = (el("pName")?.value || "").trim();
  const price = Number(el("pPrice")?.value);
  const min = 50;
  const stock = Number(el("pStock")?.value || 0);

  if (!name) return setErr("Product name required.");
  if (!Number.isFinite(price) || price < 0) return setErr("Invalid price.");
  if (!Number.isFinite(stock) || stock < 0) return setErr("Invalid initial stock.");

  setMsg("Adding product…");

  const { data: prod, error: pErr } = await supabase
    .from("products")
    .insert([{ name, price, min_stock: min }])
    .select("id")
    .single();

  if (pErr) return setErr("Add product failed: " + pErr.message);

  const { error: iErr } = await supabase
    .from("inventory")
    .insert([{ product_id: prod.id, stock }]);

  if (iErr) return setErr("Inventory create failed: " + iErr.message);

  setMsg("✅ Product added!");

  el("pName").value = "";
  el("pPrice").value = "";
  el("pStock").value = "";

  await loadInventory();
}

/* =========================
   MAIN
========================= */
async function main() {
  const user = await requireAuth();
  if (!user) return;

  // ✅ show signed in info
  if (el("userEmail")) el("userEmail").textContent = user.email || "(no email)";

  const role = await getMyRole(user.id);
  localStorage.setItem("kairo_role", role);
  if (el("userRole")) el("userRole").textContent = role;

  if (role === "staff") {
    window.location.href = "./sales.html";
    return;
  }

  isAdmin = role === "admin";

  // ✅ hide admin stuff if not admin
  if (!isAdmin) {
    if (el("adminTools")) el("adminTools").style.display = "none";
    if (el("thAction")) el("thAction").style.display = "none";
    if (el("navAdmin")) el("navAdmin").style.display = "none";
  } else {
    if (el("navAdmin")) el("navAdmin").style.display = "block";
  }

  // ✅ logout works
  el("logoutBtn")?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem("kairo_role");
    } finally {
      window.location.href = "./index.html";
    }
  });

  el("refreshBtn")?.addEventListener("click", loadInventory);
  el("search")?.addEventListener("input", () => renderTable(allRows));
  el("addProductBtn")?.addEventListener("click", addProduct);
  el("editCancelBtn")?.addEventListener("click", closeEditModal);
  el("editSaveBtn")?.addEventListener("click", saveEditModal);
  el("editModal")?.addEventListener("click", (event) => {
    if (event.target === el("editModal")) closeEditModal();
  });
  el("stockCancelBtn")?.addEventListener("click", closeStockModal);
  el("stockSaveBtn")?.addEventListener("click", saveStockModal);
  el("stockModal")?.addEventListener("click", (event) => {
    if (event.target === el("stockModal")) closeStockModal();
  });
  el("archiveCancelBtn")?.addEventListener("click", closeArchiveModal);
  el("archiveConfirmBtn")?.addEventListener("click", async () => {
    if (!archivingRow) return;
    await archiveProduct(archivingRow);
  });
  el("archiveModal")?.addEventListener("click", (event) => {
    if (event.target === el("archiveModal")) closeArchiveModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeEditModal();
      closeStockModal();
      closeArchiveModal();
    }
  });
  document.addEventListener("click", closeAllActionMenus);

  await loadInventory();
}

main();
