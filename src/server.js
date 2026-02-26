import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import db from "./db.js";
import { generateAiFeedback } from "./scoring.js";
import { isVoiceAiConfigured, synthesizeSpeech } from "./voice.js";
import { getAiRuntimeInfo } from "./llm.js";
import {
  openingPrompt,
  openingPromptWithLang,
  nextTurnSmart,
  buildTranscriptFromConversation
} from "./interviewEngine.js";

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const recruiterAccessKey = process.env.RECRUITER_ACCESS_KEY || "";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const rateWindowMs = Number(process.env.RATE_WINDOW_MS || 60_000);
const rateMaxByRoute = {
  default: Number(process.env.RATE_MAX_DEFAULT || 160),
  respond: Number(process.env.RATE_MAX_RESPOND || 90),
  tts: Number(process.env.RATE_MAX_TTS || 90),
  create: Number(process.env.RATE_MAX_CREATE || 24)
};
const rateStore = new Map();

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed"), false);
  }
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  return next();
});
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  if (req.url.startsWith("/assets/recruiter.jpg%20(200)") || req.url.startsWith("/assets/recruiter.jpg (200)")) {
    return res.redirect(302, "/assets/recruiter.jpg");
  }
  return next();
});
app.use(express.static(path.join(__dirname, "../public")));

function cleanRateStore(now) {
  if (rateStore.size < 1500) return;
  for (const [key, bucket] of rateStore.entries()) {
    if (now > bucket.resetAt) rateStore.delete(key);
  }
}

function routeLimitFor(req) {
  if (req.path.includes("/api/interviews/") && req.path.endsWith("/respond")) return rateMaxByRoute.respond;
  if (req.path === "/api/voice/tts") return rateMaxByRoute.tts;
  if (req.path === "/api/interviews/create") return rateMaxByRoute.create;
  return rateMaxByRoute.default;
}

function clientKey(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

function enforceRateLimit(req, res) {
  const now = Date.now();
  cleanRateStore(now);
  const key = `${clientKey(req)}:${req.path}`;
  const limit = routeLimitFor(req);
  const bucket = rateStore.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateStore.set(key, { count: 1, resetAt: now + rateWindowMs });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return false;
  }
  return true;
}

function ensureRecruiterAccess(req, res) {
  if (!recruiterAccessKey) return true;
  const token = req.headers["x-access-key"] || req.query.accessKey;
  if (token !== recruiterAccessKey) {
    res.status(401).json({ error: "Unauthorized recruiter access" });
    return false;
  }
  return true;
}

function normalizeText(value, maxLen = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

const createInterviewStmt = db.prepare(`
  INSERT INTO interviews (
    token,
    candidate_name,
    candidate_email,
    role_title,
    status,
    created_at
  ) VALUES (?, ?, ?, ?, 'invited', ?)
`);

const getInterviewByTokenStmt = db.prepare(`
  SELECT * FROM interviews WHERE token = ?
`);

const getInterviewByIdStmt = db.prepare(`
  SELECT * FROM interviews WHERE id = ?
`);

const listInterviewsStmt = db.prepare(`
  SELECT id, token, candidate_name, candidate_email, role_title, status, created_at, started_at, completed_at
  FROM interviews
  ORDER BY id DESC
`);

const markStartedStmt = db.prepare(`
  UPDATE interviews
  SET status = 'in_progress', started_at = ?, checks_json = ?, conversation_json = ?
  WHERE token = ?
`);

const updateConversationStmt = db.prepare(`
  UPDATE interviews
  SET conversation_json = ?
  WHERE token = ?
`);

const submitInterviewStmt = db.prepare(`
  UPDATE interviews
  SET status = 'completed',
      completed_at = ?,
      transcript = ?,
      ai_feedback_json = ?
  WHERE token = ?
`);

function parseInterviewRow(row) {
  if (!row) return null;
  return {
    ...row,
    checks: row.checks_json ? JSON.parse(row.checks_json) : null,
    conversation: row.conversation_json ? JSON.parse(row.conversation_json) : [],
    aiFeedback: row.ai_feedback_json ? JSON.parse(row.ai_feedback_json) : null
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/ready", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    return res.json({ ok: true, ai: getAiRuntimeInfo().configured });
  } catch (_err) {
    return res.status(503).json({ ok: false });
  }
});

app.get("/api/ai/status", (_req, res) => {
  const ai = getAiRuntimeInfo();
  return res.json({ ai });
});

app.post("/api/telemetry/turn-latency", (req, res) => {
  const isEnabled = process.env.ENABLE_LATENCY_TELEMETRY !== "0";
  if (isEnabled) {
    const payload = req.body || {};
    console.log("[telemetry.turn-latency]", JSON.stringify({
      token: payload.interviewToken || "",
      turnIndex: payload.turnIndex,
      mode: payload.mode || "balanced",
      listenMs: payload.listenMs,
      llmMs: payload.llmMs,
      ttsMs: payload.ttsMs,
      totalMs: payload.totalMs,
      ts: new Date().toISOString()
    }));
  }
  return res.json({ ok: true });
});

app.post("/api/voice/tts", async (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  const startedAt = Date.now();
  try {
    if (!isVoiceAiConfigured()) {
      return res.status(400).json({ error: "Voice AI is not configured" });
    }
    const text = normalizeText(req.body?.text || "", 600);
    const lang = req.body?.lang || "en-PK";
    if (!text) return res.status(400).json({ error: "text is required" });

    const result = await synthesizeSpeech({ text, lang });
    console.log(`[voice.tts] lang=${lang} chars=${text.length} tookMs=${Date.now() - startedAt}`);
    res.setHeader("Content-Type", result.mimeType || "audio/mpeg");
    res.setHeader("Content-Length", String(result.audio.byteLength));
    return res.send(result.audio);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not synthesize voice" });
  }
});

app.post("/api/interviews/create", (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  if (!ensureRecruiterAccess(req, res)) return;
  const candidateName = normalizeText(req.body?.candidateName, 120);
  const candidateEmail = normalizeText(req.body?.candidateEmail, 160).toLowerCase();
  const roleTitle = normalizeText(req.body?.roleTitle, 120);
  if (!candidateName || !candidateEmail || !roleTitle) {
    return res.status(400).json({ error: "candidateName, candidateEmail, roleTitle are required" });
  }
  if (!isValidEmail(candidateEmail)) {
    return res.status(400).json({ error: "candidateEmail must be valid" });
  }

  const token = nanoid(18);
  const createdAt = new Date().toISOString();
  createInterviewStmt.run(token, candidateName, candidateEmail, roleTitle, createdAt);

  return res.status(201).json({
    token,
    interviewUrl: `/candidate.html?token=${token}`
  });
});

app.get("/api/interviews/:token", (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  const row = getInterviewByTokenStmt.get(req.params.token);
  if (!row) return res.status(404).json({ error: "Interview not found" });
  return res.json(parseInterviewRow(row));
});

app.post("/api/interviews/:token/start", (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  const row = getInterviewByTokenStmt.get(req.params.token);
  if (!row) return res.status(404).json({ error: "Interview not found" });
  if (row.status === "completed") return res.status(409).json({ error: "Interview already completed" });

  const checks = req.body?.checks || {};
  const startedAt = new Date().toISOString();
  const preferredLang =
    req.body?.preferredLang === "ur-PK" || req.body?.preferredLang === "mix-PK"
      ? req.body.preferredLang
      : "en-PK";
  const open =
    preferredLang === "ur-PK" || preferredLang === "mix-PK"
      ? openingPromptWithLang(row.candidate_name, row.role_title, preferredLang)
      : openingPrompt(row.candidate_name, row.role_title);
  const conversation = [
    {
      type: "ai",
      kind: "greeting",
      text: open.greeting,
      lang: open.lang,
      ts: startedAt
    },
    {
      type: "ai",
      kind: "question",
      text: open.question,
      lang: open.lang,
      ts: startedAt
    }
  ];
  markStartedStmt.run(
    startedAt,
    JSON.stringify(checks),
    JSON.stringify(conversation),
    req.params.token
  );

  return res.json({
    ok: true,
    startedAt,
    opening: open.greeting,
    question: open.question,
    lang: open.lang
  });
});

app.post("/api/interviews/:token/respond", async (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  try {
    const row = getInterviewByTokenStmt.get(req.params.token);
    if (!row) return res.status(404).json({ error: "Interview not found" });
    if (row.status !== "in_progress") return res.status(409).json({ error: "Interview is not in progress" });

    const answerText = normalizeText(req.body?.answerText || "", 2000);
    if (!answerText) return res.status(400).json({ error: "answerText is required" });

    const current = parseInterviewRow(row);
    const now = new Date().toISOString();
    const conversation = current.conversation || [];
    conversation.push({
      type: "candidate",
      kind: "answer",
      text: answerText,
      lang: req.body?.lang || null,
      ts: now
    });

    const llmStart = Date.now();
    const turn = await nextTurnSmart({
      conversation,
      candidateAnswer: answerText,
      roleTitle: row.role_title,
      preferredLang: req.body?.lang
    });
    const llmMs = Date.now() - llmStart;
    console.log(`[interview.respond] token=${req.params.token} kind=${turn.kind} llmMs=${llmMs}`);

    conversation.push({
      type: "ai",
      kind: turn.kind,
      text: turn.text,
      lang: turn.lang,
      ts: now
    });

    updateConversationStmt.run(JSON.stringify(conversation), req.params.token);
    return res.json({
      ok: true,
      done: turn.done,
      nextPrompt: turn.text,
      kind: turn.kind,
      lang: turn.lang
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not process interview response" });
  }
});

app.post("/api/interviews/:token/submit", async (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  try {
    const row = getInterviewByTokenStmt.get(req.params.token);
    if (!row) return res.status(404).json({ error: "Interview not found" });

    const parsed = parseInterviewRow(row);
    const transcriptFromConversation = buildTranscriptFromConversation(parsed.conversation);
    const transcript = normalizeText(req.body?.transcript || transcriptFromConversation || "", 24000);
    if (!transcript) {
      return res.status(400).json({ error: "transcript is required" });
    }

    const completedAt = new Date().toISOString();
    const aiFeedback = await generateAiFeedback({
      roleTitle: row.role_title,
      transcript
    });

    submitInterviewStmt.run(
      completedAt,
      transcript,
      JSON.stringify(aiFeedback),
      req.params.token
    );

    return res.json({ ok: true, aiFeedback });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not submit interview" });
  }
});

app.get("/api/recruiter/interviews", (_req, res) => {
  if (!enforceRateLimit(_req, res)) return;
  if (!ensureRecruiterAccess(_req, res)) return;
  res.json({ interviews: listInterviewsStmt.all() });
});

app.get("/api/recruiter/interviews/:id", (req, res) => {
  if (!enforceRateLimit(req, res)) return;
  if (!ensureRecruiterAccess(req, res)) return;
  const row = getInterviewByIdStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Interview not found" });
  return res.json({ interview: parseInterviewRow(row) });
});

app.get("/api/config/public", (_req, res) => {
  return res.json({
    recruiterAuthRequired: Boolean(recruiterAccessKey),
    appBaseUrl
  });
});

app.listen(port, () => {
  console.log(`MVP running on http://localhost:${port}`);
});
