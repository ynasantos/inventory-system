import { supabase } from "./supabase.js";

const form = document.getElementById("registerForm");
const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const errEl = document.getElementById("error");
const msgEl = document.getElementById("msg");

function isAlreadyRegisteredError(error) {
  const text = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return text.includes("already") || text.includes("registered") || text.includes("user_already_exists");
}

function logRegisterDebug(error, email) {
  console.group("[REGISTER DEBUG]");
  console.log("email:", email);
  console.log("message:", error?.message || "");
  console.log("code:", error?.code || "");
  console.log("status:", error?.status || "");
  console.log("details:", error?.details || "");
  console.log("hint:", error?.hint || "");
  console.groupEnd();
}

async function ensureProfile(userId) {
  if (!userId) return;

  const { error } = await supabase
    .from("profiles")
    .upsert([{ id: userId, role: "staff" }], { onConflict: "id" });

  if (error) {
    console.error("[REGISTER DEBUG] ensureProfile failed:", error);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";
  msgEl.textContent = "";

  const email = (emailEl.value || "").trim().toLowerCase();
  const password = passEl.value || "";

  if (!email || !email.includes("@")) {
    errEl.textContent = "Please enter a valid email.";
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  const oldBtnText = submitBtn?.textContent || "Create account";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
  }

  try {
    msgEl.textContent = "Creating account…";

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      logRegisterDebug(error, email);

      if (isAlreadyRegisteredError(error)) {
        msgEl.textContent = "Account already exists. Checking login/confirmation status…";

        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (!loginError && loginData?.user) {
          await ensureProfile(loginData.user.id);
          msgEl.textContent = "✅ Account exists and login works. Redirecting…";
          setTimeout(() => (window.location.href = "./dashboard.html"), 800);
          return;
        }

        const loginMsg = String(loginError?.message || "").toLowerCase();
        const needsConfirm = loginMsg.includes("confirm") || loginMsg.includes("email") || loginMsg.includes("verified");

        if (needsConfirm) {
          const { error: resendError } = await supabase.auth.resend({
            type: "signup",
            email,
          });

          if (resendError) {
            console.error("[REGISTER DEBUG] resend signup email failed:", resendError);
            errEl.textContent = "This account already exists but is not confirmed. Please sign in or reset password.";
            msgEl.textContent = "Debug: account exists in Supabase Auth (not always visible in your app tables).";
          } else {
            errEl.textContent = "This account already exists but is not confirmed yet.";
            msgEl.textContent = "✅ Confirmation email re-sent. Check your inbox/spam, then sign in.";
          }
          return;
        }

        errEl.textContent = "This email is already registered. Try Sign in or reset password.";
        msgEl.textContent = "Debug: this usually means account exists in Supabase Auth even if missing in your profiles table.";
      } else {
        errEl.textContent = error.message;
        msgEl.textContent = "Debug: registration failed. Open browser console (F12) for full Supabase error details.";
      }
      return;
    }

    // If email confirmation is ON, user must confirm via email.
    // If OFF, they can login right away.
    if (data?.user && !data?.session) {
      msgEl.textContent = "✅ Account created! Please check your email to confirm, then sign in.";
    } else {
      await ensureProfile(data?.user?.id);
      msgEl.textContent = "✅ Account created! Redirecting…";
      setTimeout(() => (window.location.href = "./dashboard.html"), 800);
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = oldBtnText;
    }
  }
});
