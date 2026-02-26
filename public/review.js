const params = new URLSearchParams(window.location.search);
const id = params.get("id");
const accessKey = params.get("accessKey") || localStorage.getItem("recruiter_access_key") || "";
if (accessKey) localStorage.setItem("recruiter_access_key", accessKey);

function escapeHtml(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (accessKey) headers["x-access-key"] = accessKey;
  return fetch(url, { ...options, headers });
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
    meta.textContent = "Configure GEMINI_API_KEY to enable dynamic reviews.";
  } catch (_err) {
    badge.textContent = "AI Brain: unavailable";
    badge.classList.remove("pending", "online");
    badge.classList.add("offline");
    meta.textContent = "Could not load AI status.";
  }
}

async function loadReview() {
  if (!id) {
    document.getElementById("meta").textContent = "Missing interview id.";
    return;
  }

  const res = await apiFetch(`/api/recruiter/interviews/${id}`);
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("meta").textContent = data.error || "Could not load interview.";
    return;
  }

  const it = data.interview;
  document.getElementById("meta").textContent =
    `${it.candidate_name} (${it.candidate_email}) | ${it.role_title} | ${it.status}`;

  if (!it.aiFeedback) {
    document.getElementById("score").textContent = "No AI feedback yet";
    document.getElementById("rec").textContent = "-";
    document.getElementById("transcript").textContent = it.transcript || "";
    return;
  }

  document.getElementById("score").textContent = `${it.aiFeedback.score}/100`;
  document.getElementById("rec").textContent = it.aiFeedback.recommendation;
  const rubric = it.aiFeedback.rubric || {};
  const entries = [
    `Communication: ${rubric.communication ?? "-"}/5`,
    `Problem Solving: ${rubric.problemSolving ?? "-"}/5`,
    `Role Fit: ${rubric.roleFit ?? "-"}/5`,
    `Clarity: ${rubric.clarity ?? "-"}/5`
  ];
  document.getElementById("rubric").innerHTML = entries
    .map((r) => `<div class="pill">${escapeHtml(r)}</div>`)
    .join("");

  document.getElementById("strengths").innerHTML = (it.aiFeedback.strengths || [])
    .map((s) => `<div class="pill">${escapeHtml(s)}</div>`)
    .join("");
  document.getElementById("risks").innerHTML = (it.aiFeedback.risks || [])
    .map((r) => `<div class="pill">${escapeHtml(r)}</div>`)
    .join("");

  document.getElementById("transcript").textContent = it.transcript || "";
}

loadReview().catch(() => {
  document.getElementById("meta").textContent = "Unexpected load error.";
});
loadAiStatus().catch(() => {});
