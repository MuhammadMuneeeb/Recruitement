let recruiterAccessKey = "";

function escapeHtml(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAccessKeyFromUrl() {
  const qs = new URLSearchParams(window.location.search);
  return (qs.get("accessKey") || "").trim();
}

function getStoredAccessKey() {
  return localStorage.getItem("recruiter_access_key") || "";
}

function setStoredAccessKey(value) {
  if (!value) return;
  localStorage.setItem("recruiter_access_key", value);
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (recruiterAccessKey) headers["x-access-key"] = recruiterAccessKey;
  const res = await fetch(url, { ...options, headers });
  return res;
}

async function loadAiStatus() {
  const badge = document.getElementById("aiStatusBadge");
  const meta = document.getElementById("aiStatusMeta");
  if (!badge || !meta) return;

  try {
    const res = await apiFetch("/api/ai/status");
    const data = await res.json();
    const ai = data?.ai || {};
    if (!res.ok || !ai.provider) throw new Error("AI status unavailable");

    if (ai.configured) {
      badge.textContent = `AI Brain: ${String(ai.provider).toUpperCase()} live`;
      badge.classList.remove("pending", "offline");
      badge.classList.add("online");
      meta.textContent = `Model: ${ai.model || "configured"}`;
      return;
    }

    badge.textContent = "AI Brain: offline";
    badge.classList.remove("pending", "online");
    badge.classList.add("offline");
    meta.textContent = "Configure GEMINI_API_KEY to enable dynamic interviews.";
  } catch (_err) {
    badge.textContent = "AI Brain: unavailable";
    badge.classList.remove("pending", "online");
    badge.classList.add("offline");
    meta.textContent = "Could not load AI status.";
  }
}

async function bootstrapRecruiterAccess() {
  recruiterAccessKey = getAccessKeyFromUrl() || getStoredAccessKey();
  if (recruiterAccessKey) setStoredAccessKey(recruiterAccessKey);

  const cfgRes = await apiFetch("/api/config/public");
  const cfg = await cfgRes.json().catch(() => ({}));
  if (!cfgRes.ok || !cfg?.recruiterAuthRequired) return;

  if (!recruiterAccessKey) {
    const entered = window.prompt("Enter recruiter access key");
    if (entered && entered.trim()) {
      recruiterAccessKey = entered.trim();
      setStoredAccessKey(recruiterAccessKey);
    }
  }
}

async function createInterview() {
  const candidateName = document.getElementById("candidateName").value.trim();
  const candidateEmail = document.getElementById("candidateEmail").value.trim();
  const roleTitle = document.getElementById("roleTitle").value.trim();
  const linkOut = document.getElementById("linkOut");

  if (!candidateName || !candidateEmail || !roleTitle) {
    linkOut.textContent = "All fields are required.";
    return;
  }

  const res = await apiFetch("/api/interviews/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateName, candidateEmail, roleTitle })
  });
  const data = await res.json();
  if (!res.ok) {
    linkOut.textContent = data.error || "Could not create interview.";
    return;
  }

  const absolute = `${window.location.origin}${data.interviewUrl}`;
  const safeAbsolute = escapeHtml(absolute);
  linkOut.innerHTML = `Interview link: <a href="${safeAbsolute}" target="_blank">${safeAbsolute}</a>`;
  await loadInterviews();
}

async function deleteInterview(id) {
  const confirmDelete = window.confirm("Delete this interview entry permanently?");
  if (!confirmDelete) return;

  const res = await apiFetch(`/api/recruiter/interviews/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    window.alert(data.error || "Could not delete interview.");
    return;
  }
  await loadInterviews();
}

async function loadInterviews() {
  const list = document.getElementById("list");
  const res = await apiFetch("/api/recruiter/interviews");
  const data = await res.json();
  if (res.status === 401) {
    list.innerHTML = `<tr><td colspan="6" class="muted">Unauthorized. Reload with valid access key.</td></tr>`;
    return;
  }
  const items = data.interviews || [];

  if (!items.length) {
    list.innerHTML = `
      <tr>
        <td colspan="6" class="muted">No interviews yet.</td>
      </tr>
    `;
    return;
  }

  list.innerHTML = items
    .map((it) => {
      const reviewUrl = `/review.html?id=${it.id}`;
      const created = new Date(it.created_at).toLocaleString();
      return `
        <tr>
          <td>
            <strong>${escapeHtml(it.candidate_name)}</strong><br />
            <span class="muted small">${escapeHtml(it.candidate_email)}</span>
          </td>
          <td>${escapeHtml(it.role_title)}</td>
          <td><span class="status ${it.status}">${it.status.replace("_", " ")}</span></td>
          <td class="small">${created}</td>
          <td><a href="${reviewUrl}${recruiterAccessKey ? `&accessKey=${encodeURIComponent(recruiterAccessKey)}` : ""}" target="_blank">Open Review</a></td>
          <td><button type="button" class="danger small-btn delete-btn" data-id="${it.id}">Delete</button></td>
        </tr>
      `;
    })
    .join("");

  list.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteInterview(btn.dataset.id).catch((err) => {
        window.alert(err?.message || "Could not delete interview.");
      });
    });
  });
}

document.getElementById("createBtn").addEventListener("click", () => {
  createInterview().catch((err) => {
    document.getElementById("linkOut").textContent = err.message || "Unexpected error";
  });
});

document.getElementById("refreshBtn")?.addEventListener("click", () => {
  loadInterviews().catch(() => {});
});

bootstrapRecruiterAccess()
  .then(() => loadAiStatus())
  .then(() => loadInterviews())
  .catch(() => {});
