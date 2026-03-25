import { supabase } from "./supabase.js";

const el = (id) => document.getElementById(id);
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

let products = [];
let cart = []; // {product_id, name, price, stock, qty}
let currentUser = null;
let lastReceipt = null;
let bookIdMap = new Map();

function formatBookId(n) {
  return `B${String(n).padStart(3, "0")}`;
}

function buildBookIdMap(items) {
  const sorted = [...items].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  bookIdMap = new Map();
  sorted.forEach((p, idx) => {
    bookIdMap.set(p.id, formatBookId(idx + 1));
  });
  items.forEach((p) => {
    p.book_id = bookIdMap.get(p.id) || "B000";
  });
  cart.forEach((c) => {
    c.book_id = bookIdMap.get(c.product_id) || c.book_id || "B000";
  });
}

function getBookId(productId) {
  return bookIdMap.get(productId) || "B000";
}

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
    cart.push({
      product_id: p.id,
      book_id: getBookId(p.id),
      name: p.name,
      price: p.price,
      stock: p.stock,
      qty: 1,
    });
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

  buildBookIdMap(products);
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
  const receiptItems = cart.map((x) => ({
    bookId: x.book_id || getBookId(x.product_id),
    name: x.name,
    qty: x.qty,
    price: x.price,
  }));

  el("msg").textContent = "Processing sale…";

  const { data, error } = await supabase.rpc("record_sale", { items: payload });

  if (error) {
    el("err").textContent = error.message;
    el("msg").textContent = "";
    return;
  }

  const saleId = getSaleId(data);
  openReceipt({
    saleId,
    items: receiptItems,
    cashierEmail: currentUser?.email || "",
  });

  cart = [];
  renderCart();
  await loadProducts();
  el("msg").textContent = "✅ Sale saved! Sale ID: " + saleId;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(d) {
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pdfSafeText(str) {
  return String(str ?? "").replace(/[^\x00-\x7F]/g, "?");
}

function pdfMoney(n) {
  return `PHP ${Number(n || 0).toFixed(2)}`;
}

function buildReceiptLines({ saleId, items, cashierEmail, receiptNo, createdAt }) {
  const width = 42;
  const line = "-".repeat(width);
  const now = createdAt || new Date();
  const cashierName = cashierEmail ? cashierEmail.split("@")[0] : "Staff";
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = 0;
  const total = subtotal - discount;

  const center = (text) => {
    const t = pdfSafeText(text);
    const pad = Math.max(0, Math.floor((width - t.length) / 2));
    return " ".repeat(pad) + t;
  };

  const labelValue = (label, value) => {
    const left = pdfSafeText(label);
    let right = pdfSafeText(value);
    const maxRight = Math.max(0, width - left.length - 1);
    if (right.length > maxRight) {
      right = maxRight <= 3 ? right.slice(0, maxRight) : right.slice(0, maxRight - 3) + "...";
    }
    const space = Math.max(1, width - left.length - right.length);
    return left + " ".repeat(space) + right;
  };

  const itemLine = (bookId, name, qty, amount) => {
    const col1 = pdfSafeText(name);
    const idWidth = 5;
    const nameWidth = 20;
    const qtyWidth = 3;
    const amtWidth = 12;
    const idCol = pdfSafeText(bookId || "B000").padEnd(idWidth);
    const nameCol = col1.length > nameWidth ? col1.slice(0, nameWidth - 3) + "..." : col1.padEnd(nameWidth);
    const qtyCol = String(qty).padStart(qtyWidth);
    const amtCol = pdfMoney(amount).padStart(amtWidth);
    return `${idCol} ${nameCol} ${qtyCol} ${amtCol}`;
  };

  const lines = [];
  lines.push(center("KAIROS"));
  lines.push(center("Official Sales Receipt"));
  lines.push(center(formatDateTime(now)));
  lines.push(line);
  lines.push(labelValue("Receipt No", receiptNo));
  lines.push(labelValue("Sale ID", saleId ? String(saleId) : "N/A"));
  lines.push(labelValue("Cashier", cashierName));
  lines.push(labelValue("Email", cashierEmail || "N/A"));
  lines.push(labelValue("Payment", "CASH"));
  lines.push(labelValue("Status", "Completed"));
  lines.push(line);
  const header = `${"ID".padEnd(5)} ${"Item".padEnd(20)} ${"Qty".padStart(3)} ${"Amount".padStart(12)}`;
  lines.push(header);
  items.forEach((i) => {
    lines.push(itemLine(i.bookId, i.name, i.qty, i.price * i.qty));
  });
  lines.push(line);
  lines.push(labelValue("Subtotal", pdfMoney(subtotal)));
  lines.push(labelValue("Discount", pdfMoney(discount)));
  lines.push(labelValue("TOTAL", pdfMoney(total)));
  lines.push(line);
  lines.push(center("Printed: " + formatDateTime(now)));
  lines.push(center("Generated by Kairos Publishing House"));
  lines.push(center("THANK YOU"));
  return lines;
}

function buildPdfFromLines(lines) {
  const pageWidth = 260;
  const pageHeight = 650;
  const marginLeft = 14;
  const startY = pageHeight - 24;
  const content = [
    "BT",
    "/F1 9 Tf",
    `1 0 0 1 ${marginLeft} ${startY} Tm`,
    "12 TL",
    ...lines.map((l) => `(${pdfSafeText(l).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj\nT*`),
    "ET",
  ].join("\n");

  const objects = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj`
  );
  objects.push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj");
  objects.push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`);

  let pdf = "%PDF-1.3\n";
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += obj + "\n";
  });

  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return pdf;
}

function downloadReceiptPdf() {
  if (!lastReceipt) return;
  const lines = buildReceiptLines(lastReceipt);
  const pdf = buildPdfFromLines(lines);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Kairos-Receipt-${lastReceipt.receiptNo}.pdf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function makeReceiptNo(saleId, d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const tail = String(saleId ?? "")
    .replace(/\D/g, "")
    .slice(-4)
    .padStart(4, "0");
  const fallback = String(Math.floor(Math.random() * 9000) + 1000);
  return `KPH-${yyyy}${mm}${dd}-${tail || fallback}`;
}

function openReceipt({ saleId, items, cashierEmail }) {
  const now = new Date();
  const cashierName = cashierEmail ? cashierEmail.split("@")[0] : "Staff";
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discount = 0;
  const total = subtotal - discount;
  const receiptNo = makeReceiptNo(saleId, now);

  const receiptModal = el("receiptModal");
  if (!receiptModal) return;

  el("receiptDate").textContent = formatDateTime(now);
  el("receiptNo").textContent = receiptNo;
  el("receiptSaleId").textContent = saleId ? String(saleId) : "N/A";
  el("receiptCashier").textContent = cashierName;
  el("receiptEmail").textContent = cashierEmail || "N/A";
  el("receiptPayment").textContent = "CASH";
  el("receiptStatus").textContent = "Completed";
  el("receiptPrinted").textContent = "Printed: " + formatDateTime(now);

  el("receiptItems").innerHTML = items
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.bookId || "B000")}</td>
        <td>${escapeHtml(i.name)}</td>
        <td>${i.qty}</td>
        <td>${peso(i.price * i.qty)}</td>
      </tr>
    `
    )
    .join("");

  el("receiptSubtotal").textContent = peso(subtotal);
  el("receiptDiscount").textContent = peso(discount);
  el("receiptTotal").textContent = peso(total);

  lastReceipt = {
    saleId,
    items,
    cashierEmail,
    createdAt: now,
    receiptNo,
  };

  receiptModal.classList.add("show");
  receiptModal.setAttribute("aria-hidden", "false");
}

function closeReceipt() {
  const receiptModal = el("receiptModal");
  if (!receiptModal) return;
  receiptModal.classList.remove("show");
  receiptModal.setAttribute("aria-hidden", "true");
}

function getSaleId(data) {
  if (data == null) return "";
  if (typeof data === "object") {
    return data.sale_id ?? data.id ?? data;
  }
  return data;
}

function printReceipt() {
  const receiptModal = el("receiptModal");
  if (!receiptModal || !receiptModal.classList.contains("show")) return;
  window.print();
}

async function main() {
  const user = await requireAuth();
  if (!user) return;
  currentUser = user;

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

  const receiptModal = el("receiptModal");
  const receiptPrintBtn = el("receiptPrint");
  const receiptDownloadBtn = el("receiptDownload");

  if (receiptModal) {
    receiptModal.addEventListener("click", (e) => {
      if (e.target === receiptModal) closeReceipt();
    });
  }
  if (receiptPrintBtn) receiptPrintBtn.addEventListener("click", printReceipt);
  if (receiptDownloadBtn) receiptDownloadBtn.addEventListener("click", downloadReceiptPdf);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReceipt();
  });

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
