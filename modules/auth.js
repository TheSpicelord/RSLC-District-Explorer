const STORAGE_KEY = "rslc_auth_expires";

function isSessionValid() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  return Date.now() < Number(raw);
}

function injectOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "auth-overlay";
  overlay.innerHTML = `
    <div class="auth-card">
      <h2 class="auth-title">Districts RSLC</h2>
      <p class="auth-subtitle">Enter the access password to continue.</p>
      <form id="auth-form" autocomplete="off">
        <input
          id="auth-password"
          class="auth-input"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          required
        />
        <button class="auth-btn" type="submit">Access</button>
        <p id="auth-error" class="auth-error" hidden>Incorrect password. Please try again.</p>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById("auth-password")?.focus(), 50);
  return overlay;
}

export async function requireAuth(workerUrl) {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    document.documentElement.classList.remove("auth-pending");
    return;
  }
  if (isSessionValid()) return;

  document.documentElement.classList.add("auth-pending");
  const overlay = injectOverlay();

  await new Promise((resolve) => {
    const form = document.getElementById("auth-form");
    const errorEl = document.getElementById("auth-error");
    const btn = overlay.querySelector(".auth-btn");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = document.getElementById("auth-password").value;

      btn.disabled = true;
      btn.textContent = "Checking…";
      errorEl.hidden = true;

      try {
        const res = await fetch(`${workerUrl}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });

        if (res.ok) {
          const { expires } = await res.json();
          localStorage.setItem(STORAGE_KEY, String(expires));
          overlay.remove();
          document.documentElement.classList.remove("auth-pending");
          resolve();
        } else {
          errorEl.hidden = false;
          btn.disabled = false;
          btn.textContent = "Access";
          document.getElementById("auth-password").value = "";
          document.getElementById("auth-password").focus();
        }
      } catch {
        errorEl.textContent = "Could not reach the auth server. Please try again.";
        errorEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Access";
      }
    });
  });
}
