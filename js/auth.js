import { supabase } from "./supabase.js";

/*
  This file handles login for index.html on GitHub Pages.
  Requirements in index.html:
    - form id="loginForm"
    - input id="email"
    - input id="password"
    - div id="error"
*/

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("error");

function setError(message) {
  errorBox.textContent = message || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  localStorage.removeItem("kairo_role");

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");

  const email = (emailInput.value || "").trim();
  const password = passwordInput.value || "";

  // Basic validation
  if (!email) {
    setError("Please enter your email.");
    emailInput.focus();
    return;
  }

  if (!password) {
    setError("Please enter your password.");
    passwordInput.focus();
    return;
  }

  // Show loading state
  const submitBtn = form.querySelector('button[type="submit"]');
  const oldText = submitBtn.textContent;
  submitBtn.textContent = "Signing in...";
  submitBtn.disabled = true;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Login error:", error);
      setError(error.message);
      return;
    }

    // Confirm session exists
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      console.error("Session error:", sessionErr);
      setError(sessionErr.message);
      return;
    }

    if (!sessionData.session) {
      setError("Login succeeded but no session was found. Please try again.");
      return;
    }

    try {
      const userId = sessionData.session.user?.id;
      if (userId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();

        const role = String(profile?.role || "").trim().toLowerCase();
        if (role) localStorage.setItem("kairo_role", role);
      }
    } catch (roleErr) {
      console.error("Role prefetch failed:", roleErr);
    }

    // Success: redirect
    // Use relative path for GitHub Pages
    window.location.href = "./dashboard.html";
  } catch (err) {
    console.error("Unexpected error:", err);
    setError("Something went wrong. Check console for details.");
  } finally {
    submitBtn.textContent = oldText;
    submitBtn.disabled = false;
  }
});
