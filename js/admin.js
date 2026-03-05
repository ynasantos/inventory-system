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
  return data?.role || "staff";
}

let allUsers = [];

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
            <span class="pill ${role}">${role.toUpperCase()}</span>
            <div style="height:8px"></div>
            <select data-role="${u.id}">
              <option value="staff" ${role === "staff" ? "selected" : ""}>staff</option>
              <option value="admin" ${role === "admin" ? "selected" : ""}>admin</option>
            </select>
          </td>
          <td>${fmtDate(u.created_at)}</td>
          <td>
            <div class="row-actions">
              <button class="btn mini save" data-save="${u.id}">Save</button>
              <button class="btn mini copy" data-copy="${u.id}">Copy ID</button>
              <button class="btn mini delete" data-delete="${u.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  // Save role buttons
  document.querySelectorAll("button[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setErr("");
      setMsg("");

      const userId = btn.getAttribute("data-save");
      const sel = document.querySelector(`select[data-role="${userId}"]`);
      const newRole = sel?.value || "staff";

      setMsg("Saving role…");

      const { error } = await supabase.rpc("admin_set_user_role", {
        p_user_id: userId,
        p_role: newRole,
      });

      if (error) {
        setErr(error.message);
        setMsg("");
        return;
      }

      setMsg("✅ Updated role!");
      await loadUsers();
    });
  });

  // Copy ID buttons
  document.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(userId);
        setMsg("Copied user ID ✅");
      } catch {
        alert("Copy failed. User ID:\n" + userId);
      }
    });
  });
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
  el("userRole").textContent = myRole;

  if (myRole !== "admin") {
    window.location.href = "./dashboard.html";
    return;
  }

  el("search")?.addEventListener("input", renderUsers);
  el("refreshBtn")?.addEventListener("click", loadUsers);

  // ✅ THIS is the missing wiring:
  el("createUserBtn")?.addEventListener("click", createUser);

  el("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "./index.html";
  });

  await loadUsers();
}

main();
