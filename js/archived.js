import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);

let archivedRows = [];
let restoreTarget = null;
let deleteTarget = null;

function closeAllActionMenus() {
  document.querySelectorAll(".action-dropdown.show").forEach((menu) => {
    menu.classList.remove("show");
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMsg(text = "") {
  const m = el("msg");
  if (m) m.textContent = text;
}

function setErr(text = "") {
  const e = el("err");
  if (e) e.textContent = text;
}

function openRestoreModal(product) {
  restoreTarget = product;
  const textEl = el("restoreModalText");
  if (textEl) textEl.textContent = `Restore ${product.name} with initial stock:`;
  if (el("restoreStockValue")) el("restoreStockValue").value = "0";
  el("restoreModal")?.classList.add("show");
  el("restoreStockValue")?.focus();
  el("restoreStockValue")?.select();
}

function closeRestoreModal() {
  restoreTarget = null;
  el("restoreModal")?.classList.remove("show");
}

function openDeleteModal(product) {
  deleteTarget = product;
  const textEl = el("deleteModalText");
  if (textEl) textEl.textContent = `Permanently delete ${product.name}? This cannot be undone.`;
  el("deleteModal")?.classList.add("show");
}

function closeDeleteModal() {
  deleteTarget = null;
  el("deleteModal")?.classList.remove("show");
}

async function confirmRestore() {
  if (!restoreTarget) return;

  const productId = restoreTarget.id;
  const stock = Number(el("restoreStockValue")?.value);
  if (!Number.isFinite(stock) || stock < 0) {
    alert("Invalid stock value.");
    return;
  }

  setErr("");
  setMsg("Restoring item…");

  const { error } = await supabase
    .from("inventory")
    .insert([{ product_id: productId, stock, updated_at: new Date().toISOString() }]);

  if (error) {
    setErr("Restore failed: " + error.message);
    setMsg("");
    return;
  }

  closeRestoreModal();
  setMsg("✅ Restored!");
  await loadArchivedItems();
}

async function confirmDelete() {
  if (!deleteTarget) return;

  const productId = deleteTarget.id;
  setErr("");
  setMsg("Deleting item…");

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId);

  if (error) {
    setErr("Delete failed: " + error.message);
    setMsg("");
    return;
  }

  closeDeleteModal();
  setMsg("✅ Deleted permanently!");
  await loadArchivedItems();
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

async function loadArchivedItems() {
  setErr("");
  setMsg("");
  el("tableNote").textContent = "Loading archived items…";

  const [{ data: products, error: prodErr }, { data: invRows, error: invErr }] = await Promise.all([
    supabase.from("products").select("id,name,price,min_stock").order("name", { ascending: true }),
    supabase.from("inventory").select("product_id"),
  ]);

  if (prodErr) {
    el("tableNote").textContent = "Cannot load products: " + prodErr.message;
    el("archivedBody").innerHTML = "";
    return;
  }

  if (invErr) {
    el("tableNote").textContent = "Cannot load inventory: " + invErr.message;
    el("archivedBody").innerHTML = "";
    return;
  }

  const activeIds = new Set((invRows || []).map((x) => String(x.product_id)));
  archivedRows = (products || []).filter((p) => !activeIds.has(String(p.id)));

  renderArchivedTable();
}

function renderArchivedTable() {
  const q = (el("search")?.value || "").trim().toLowerCase();
  const filtered = archivedRows.filter((r) => String(r.name || "").toLowerCase().includes(q));

  el("tableNote").textContent = filtered.length ? "" : "No archived items.";

  el("archivedBody").innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>₱${Number(r.price || 0).toFixed(2)}</td>
        <td>${Number(r.min_stock || 0)}</td>
        <td>
          <div class="action-menu">
            <button class="dot-btn" type="button" aria-label="Actions" data-menu-toggle="${r.id}">⋮</button>
            <div class="action-dropdown" data-menu="${r.id}">
              <button class="menu-item" type="button" data-restore="${r.id}">Restore</button>
              <button class="menu-item danger" type="button" data-delete="${r.id}">Delete</button>
            </div>
          </div>
        </td>
      </tr>
    `
    )
    .join("");

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

  document.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.onclick = () => {
      closeAllActionMenus();
      const productId = btn.dataset.restore;
      const product = archivedRows.find((x) => String(x.id) === String(productId));
      if (!product) return;
      openRestoreModal(product);
    };
  });

  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.onclick = () => {
      closeAllActionMenus();
      const productId = btn.dataset.delete;
      const product = archivedRows.find((x) => String(x.id) === String(productId));
      if (!product) return;
      openDeleteModal(product);
    };
  });
}

async function main() {
  const user = await requireAuth();
  if (!user) return;

  if (el("userEmail")) el("userEmail").textContent = user.email || "(no email)";

  const role = await getMyRole(user.id);
  localStorage.setItem("kairo_role", role);
  if (el("userRole")) el("userRole").textContent = role;

  if (role === "staff") {
    window.location.href = "./sales.html";
    return;
  }

  if (el("navAdmin")) el("navAdmin").style.display = role === "admin" ? "block" : "none";

  el("logoutBtn")?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem("kairo_role");
    } finally {
      window.location.href = "./index.html";
    }
  });

  el("refreshBtn")?.addEventListener("click", loadArchivedItems);
  el("search")?.addEventListener("input", renderArchivedTable);
  document.addEventListener("click", closeAllActionMenus);
  el("restoreCancelBtn")?.addEventListener("click", closeRestoreModal);
  el("restoreConfirmBtn")?.addEventListener("click", confirmRestore);
  el("restoreModal")?.addEventListener("click", (event) => {
    if (event.target === el("restoreModal")) closeRestoreModal();
  });
  el("deleteCancelBtn")?.addEventListener("click", closeDeleteModal);
  el("deleteConfirmBtn")?.addEventListener("click", confirmDelete);
  el("deleteModal")?.addEventListener("click", (event) => {
    if (event.target === el("deleteModal")) closeDeleteModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRestoreModal();
      closeDeleteModal();
    }
  });

  await loadArchivedItems();
}

main();
