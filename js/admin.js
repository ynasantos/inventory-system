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

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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
  // NOTE: your profiles table may NOT have "email" column, so we only select role
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

let allUsers = [];
let editingRoleUserId = null;

function closeAllActionMenus() {
  document.querySelectorAll(".action-dropdown.show").forEach((menu) => {
    menu.classList.remove("show");
  });
}

function openRoleModal(userId) {
  const user = allUsers.find((u) => u.id === userId);
  if (!user) return;

  editingRoleUserId = userId;

  const currentRole = user.role === "admin" ? "admin" : "staff";
  const emailText = user.email ? `User: ${user.email}` : "User account";

  const emailEl = el("roleModalEmail");
  const selectEl = el("roleModalSelect");
  const backdropEl = el("roleModalBackdrop");

  if (emailEl) emailEl.textContent = emailText;
  if (selectEl) selectEl.value = currentRole;
  if (backdropEl) {
    backdropEl.classList.add("show");
    backdropEl.setAttribute("aria-hidden", "false");
  }
}

function closeRoleModal() {
  editingRoleUserId = null;
  const backdropEl = el("roleModalBackdrop");
  if (backdropEl) {
    backdropEl.classList.remove("show");
    backdropEl.setAttribute("aria-hidden", "true");
  }
}

async function saveRoleFromModal() {
  if (!editingRoleUserId) return;

  setErr("");
  setMsg("Saving role…");

  const selectEl = el("roleModalSelect");
  const newRole = selectEl?.value || "staff";

  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: editingRoleUserId,
    p_role: newRole,
  });

  if (error) {
    setErr(error.message);
    setMsg("");
    return;
  }

  closeRoleModal();
  setMsg("✅ Updated role!");
  await loadUsers();
}

function renderUsers() {
  const q = (el("search")?.value || "").trim().toLowerCase();
  const filtered = allUsers.filter((u) =>
    String(u.email || "").toLowerCase().includes(q)
  );

  el("note").textContent = filtered.length ? "" : "No matching users.";

  el("userBody").innerHTML = filtered
    .map((u) => {
      const role = u.role === "admin" ? "admin" : "staff";
      return `
        <tr>
          <td>${escapeHtml(u.email || "")}</td>
          <td>
            <div class="role-inline">
              <span class="pill ${role}">${role.toUpperCase()}</span>
              <button class="icon-btn" data-edit-role="${u.id}" title="Edit role" aria-label="Edit role">⋮</button>
            </div>
          </td>
          <td>
            <div class="action-menu">
              <button class="icon-btn" data-actions-toggle="${u.id}" title="Actions" aria-label="Actions">⋮</button>
              <div class="action-dropdown" data-actions-menu="${u.id}">
                <button class="menu-btn-danger" data-delete-action="${u.id}">Delete</button>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  // Open role modal buttons
  document.querySelectorAll("button[data-edit-role]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.getAttribute("data-edit-role");
      if (!userId) return;
      openRoleModal(userId);
    });
  });

  // Actions menu toggles
  document.querySelectorAll("button[data-actions-toggle]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const userId = btn.getAttribute("data-actions-toggle");
      if (!userId) return;

      const menu = document.querySelector(`[data-actions-menu="${userId}"]`);
      const shouldOpen = !menu?.classList.contains("show");

      closeAllActionMenus();
      if (shouldOpen && menu) menu.classList.add("show");
    });
  });

  // Delete action buttons
  document.querySelectorAll("button[data-delete-action]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    closeAllActionMenus();
    setErr("");
    setMsg("");

    const userId = btn.getAttribute("data-delete-action");

    console.log("Attempting to delete user with ID:", userId);

    if (!confirm("Are you sure you want to delete this user?")) return;

    setMsg("Deleting user…");

   const { error } = await supabase.rpc("admin_delete_user", {
  p_user_id: userId,
});

    console.log("Delete user RPC completed. Error:", error);

    if (error) {
      setErr("Delete failed: " + error.message);
      setMsg("");
      return;
    }

    setMsg("✅ User deleted!");
    loadUsers();
  });
});

  document.addEventListener("click", closeAllActionMenus, { once: true });
}

async function loadUsers() {
  setErr("");
  setMsg("");
  el("note").textContent = "Loading users…";

  const { data, error } = await supabase.rpc("admin_list_users");

  if (error) {
    el("note").textContent = "";
    setErr(error.message);
    el("userBody").innerHTML = "";
    return;
  }

  allUsers = data || [];
  renderUsers();
}

/* =========================
   CREATE USER (CLIENT SIDE)
   - Uses auth.signUp + insert into profiles(role)
   - Restores current admin session (so you don't get logged out)
========================= */
async function createUser() {
  setErr("");
  setMsg("");

  const email = (el("newEmail")?.value || "").trim().toLowerCase();
  const password = el("newPassword")?.value || "";
  const role = el("newRole")?.value || "staff";

  if (!email || !email.includes("@")) {
    setErr("Please enter a valid email.");
    return;
  }
  if (password.length < 6) {
    setErr("Password must be at least 6 characters.");
    return;
  }

  setMsg("Creating user…");

  // Save current admin session so we can restore it
  const { data: sessWrap } = await supabase.auth.getSession();
  const adminSession = sessWrap?.session;

  // Create user (this may switch session if email confirmations are OFF)
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    setErr("Create failed: " + error.message);
    setMsg("");
    // restore session just in case
    if (adminSession?.access_token && adminSession?.refresh_token) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }
    return;
  }

  const newUserId = data?.user?.id;
  if (!newUserId) {
    setErr("User created but no user id returned.");
    setMsg("");
    // restore admin session
    if (adminSession?.access_token && adminSession?.refresh_token) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }
    return;
  }

  // Insert profile role (ONLY id + role — avoids missing columns like "email")
  const { error: profErr } = await supabase
    .from("profiles")
    .insert([{ id: newUserId, role }]);

  // Restore admin session (important)
  if (adminSession?.access_token && adminSession?.refresh_token) {
    await supabase.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token,
    });
  }

  if (profErr) {
    setErr("Created user, but profile insert failed: " + profErr.message);
    setMsg("");
    return;
  }

  setMsg("✅ User created!");

  if (el("newEmail")) el("newEmail").value = "";
  if (el("newPassword")) el("newPassword").value = "";
  if (el("newRole")) el("newRole").value = "staff";

  await loadUsers();
}

async function main() {
  const user = await requireAuth();
  if (!user) return;

  el("userEmail").textContent = user.email || "(no email)";

  const myRole = await getMyRole(user.id);
  localStorage.setItem("kairo_role", myRole);
  el("userRole").textContent = myRole;

  if (myRole !== "admin") {
    window.location.href = "./dashboard.html";
    return;
  }

  el("search")?.addEventListener("input", renderUsers);
  el("refreshBtn")?.addEventListener("click", loadUsers);
  el("roleModalCancel")?.addEventListener("click", closeRoleModal);
  el("roleModalSave")?.addEventListener("click", saveRoleFromModal);

  el("roleModalBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeRoleModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRoleModal();
  });

  // ✅ THIS is the missing wiring:
  el("createUserBtn")?.addEventListener("click", createUser);

  el("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("kairo_role");
    window.location.href = "./index.html";
  });

  await loadUsers();
}

main();
