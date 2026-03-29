import { supabase } from "./supabase.js";

export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  return supabase.auth.getSession();
}

export async function getCurrentUser() {
  return supabase.auth.getUser();
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

let appBootstrapped = false;

/**
 * Gates the main app: shows auth UI until signed in, then runs startApp once.
 * @param {() => void | Promise<void>} startApp
 */
export function initAuth(startApp) {
  const run = () => setupAuthShell(startApp);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
}

function setupAuthShell(startApp) {
  const authScreen = document.getElementById("auth-screen");
  const appRoot = document.getElementById("app-root");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const btnSignIn = document.getElementById("auth-sign-in");
  const btnSignUp = document.getElementById("auth-sign-up");
  const authError = document.getElementById("auth-error");
  const authSuccess = document.getElementById("auth-success");
  const btnSignOut = document.getElementById("btn-sign-out");
  const userEmailEl = document.getElementById("user-email");

  function setAuthError(msg) {
    if (!authError) return;
    authError.textContent = msg || "";
    authError.classList.toggle("hidden", !msg);
  }

  function setAuthSuccess(msg) {
    if (!authSuccess) return;
    authSuccess.textContent = msg || "";
    authSuccess.classList.toggle("hidden", !msg);
  }

  function setUserEmailDisplay(email) {
    if (userEmailEl) userEmailEl.textContent = email ? email : "";
  }

  function showLoginScreen() {
    if (appRoot) appRoot.classList.add("hidden");
    if (authScreen) authScreen.classList.remove("hidden");
    setUserEmailDisplay("");
  }

  async function showMainApp(session) {
    setAuthError("");
    setAuthSuccess("");
    if (authScreen) authScreen.classList.add("hidden");
    if (appRoot) appRoot.classList.remove("hidden");
    setUserEmailDisplay(session?.user?.email ?? "");
    if (!appBootstrapped) {
      appBootstrapped = true;
      await startApp();
    }
  }

  btnSignIn?.addEventListener("click", async () => {
    setAuthError("");
    setAuthSuccess("");
    const email = (emailInput?.value || "").trim();
    const password = passwordInput?.value || "";
    if (!email || !password) {
      setAuthError("Please enter your email and password.");
      return;
    }
    const { error } = await signIn(email, password);
    if (error) setAuthError(error.message);
  });

  btnSignUp?.addEventListener("click", async () => {
    setAuthError("");
    setAuthSuccess("");
    const email = (emailInput?.value || "").trim();
    const password = passwordInput?.value || "";
    if (!email || !password) {
      setAuthError("Please enter your email and password.");
      return;
    }
    const { data, error } = await signUp(email, password);
    if (error) {
      setAuthError(error.message);
      return;
    }
    if (data.user && !data.session) {
      setAuthSuccess(
        "Please verify your email before signing in. Check your inbox for a confirmation link."
      );
    }
  });

  btnSignOut?.addEventListener("click", async () => {
    const { error } = await signOut();
    if (error) console.error("Sign out:", error);
  });

  onAuthStateChange((_event, session) => {
    if (session) {
      void showMainApp(session);
    } else {
      showLoginScreen();
    }
  });
}
