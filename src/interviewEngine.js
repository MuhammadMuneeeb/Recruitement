import { chatJson, isAiConfigured } from "./llm.js";

const SPEED_PROFILES = {
  balanced: {
    maxTokens: 90,
    llmTimeoutMs: 3800,
    contextTurns: 8
  },
  ultra_fast: {
    maxTokens: 70,
    llmTimeoutMs: 2600,
    contextTurns: 6
  },
  accuracy_first: {
    maxTokens: 130,
    llmTimeoutMs: 6000,
    contextTurns: 10
  }
};

const ACTIVE_SPEED_PROFILE = SPEED_PROFILES[process.env.INTERVIEW_SPEED_PROFILE || "balanced"]
  ? process.env.INTERVIEW_SPEED_PROFILE || "balanced"
  : "balanced";

function activeSpeed() {
  return SPEED_PROFILES[ACTIVE_SPEED_PROFILE];
}

const MAIN_QUESTIONS_EN = [
  "Tell me about yourself and why you are interested in this role.",
  "Describe one project you built recently. What was your contribution and impact?",
  "Share one difficult technical decision you made and the tradeoffs involved.",
  "Tell me about a disagreement with a teammate and how you handled it.",
  "If selected, what would your first 30 days in this role look like?"
];

const MAIN_QUESTIONS_UR = [
  "Ø§Ù¾Ù†Ø§ ØªØ¹Ø§Ø±Ù Ú©Ø±ÙˆØ§Ø¦ÛŒÚº Ø§ÙˆØ± Ø¨ØªØ§Ø¦ÛŒÚº Ú©Û Ø¢Ù¾ Ø§Ø³ Ø±ÙˆÙ„ Ù…ÛŒÚº Ø¯Ù„Ú†Ø³Ù¾ÛŒ Ú©ÛŒÙˆÚº Ø±Ú©Ú¾ØªÛ’ ÛÛŒÚºÛ”",
  "Ú©Ø³ÛŒ Ø­Ø§Ù„ÛŒÛ Ù¾Ø±ÙˆØ¬ÛŒÚ©Ù¹ Ú©Û’ Ø¨Ø§Ø±Û’ Ù…ÛŒÚº Ø¨ØªØ§Ø¦ÛŒÚº Ø¬Ùˆ Ø¢Ù¾ Ù†Û’ Ø¨Ù†Ø§ÛŒØ§ ÛÙˆÛ” Ø¢Ù¾ Ú©Ø§ Ú©Ø±Ø¯Ø§Ø± Ø§ÙˆØ± Ø§Ø³ Ú©Ø§ Ø§Ø«Ø± Ú©ÛŒØ§ ØªÚ¾Ø§ØŸ",
  "Ú©ÙˆØ¦ÛŒ Ù…Ø´Ú©Ù„ ØªÚ©Ù†ÛŒÚ©ÛŒ ÙÛŒØµÙ„Û Ø¨ÛŒØ§Ù† Ú©Ø±ÛŒÚº Ø§ÙˆØ± Ø¨ØªØ§Ø¦ÛŒÚº Ú©Û Ø¢Ù¾ Ù†Û’ Ú©Ù† Ù¹Ø±ÛŒÚˆ Ø¢ÙØ² Ú©Ùˆ Ù…Ø¯Ù†Ø¸Ø± Ø±Ú©Ú¾Ø§Û”",
  "Ø§ÛŒØ³ÛŒ ØµÙˆØ±ØªØ­Ø§Ù„ Ø¨ØªØ§Ø¦ÛŒÚº Ø¬ÛØ§Úº Ø¢Ù¾ Ú©ÛŒ Ù¹ÛŒÙ… Ù…Ù…Ø¨Ø± Ø³Û’ Ø§Ø®ØªÙ„Ø§Ù ÛÙˆØ§ ÛÙˆØŒ Ø¢Ù¾ Ù†Û’ Ø§Ø³Û’ Ú©ÛŒØ³Û’ ÛÛŒÙ†ÚˆÙ„ Ú©ÛŒØ§ØŸ",
  "Ø§Ú¯Ø± Ø¢Ù¾ Ù…Ù†ØªØ®Ø¨ ÛÙˆ Ø¬Ø§Ø¦ÛŒÚº ØªÙˆ Ù¾ÛÙ„Û’ 30 Ø¯Ù† Ù…ÛŒÚº Ø¢Ù¾ Ú©Ø§ Ù¾Ù„Ø§Ù† Ú©ÛŒØ§ ÛÙˆÚ¯Ø§ØŸ"
];

const ORG_DEV_QUESTIONS_EN = [
  "As an Organizational Development Lead, how do you assess organization-wide capability gaps?",
  "Describe one organizational change initiative you led and its measurable impact.",
  "How do you align leadership development with business strategy?",
  "How do you handle resistance to change from senior stakeholders?",
  "What would your first 90 days look like in this Organizational Development Lead role?"
];

const ORG_DEV_QUESTIONS_UR = [
  "Ø¨Ø·ÙˆØ± Organizational Development Lead Ø¢Ù¾ organization-wide capability gaps Ú©Ùˆ Ú©ÛŒØ³Û’ assess Ú©Ø±ØªÛ’ ÛÛŒÚºØŸ",
  "Ú©ÙˆØ¦ÛŒ Ø§ÛŒÚ© organizational change initiative Ø¨ÛŒØ§Ù† Ú©Ø±ÛŒÚº Ø¬Ùˆ Ø¢Ù¾ Ù†Û’ lead Ú©ÛŒØ§ ÛÙˆ Ø§ÙˆØ± Ø§Ø³ Ú©Ø§ measurable Ø§Ø«Ø± Ú©ÛŒØ§ ØªÚ¾Ø§ØŸ",
  "Ø¢Ù¾ leadership development Ú©Ùˆ business strategy Ú©Û’ Ø³Ø§ØªÚ¾ Ú©ÛŒØ³Û’ align Ú©Ø±ØªÛ’ ÛÛŒÚºØŸ",
  "Senior stakeholders Ú©ÛŒ resistance to change Ú©Ùˆ Ø¢Ù¾ Ú©ÛŒØ³Û’ handle Ú©Ø±ØªÛ’ ÛÛŒÚºØŸ",
  "Ø§Ø³ Organizational Development Lead Ø±ÙˆÙ„ Ù…ÛŒÚº Ø¢Ù¾ Ú©Û’ Ù¾ÛÙ„Û’ 90 Ø¯Ù† Ú©Ø§ Ù¾Ù„Ø§Ù† Ú©ÛŒØ§ ÛÙˆÚ¯Ø§ØŸ"
];

const FRONTEND_COMMON_QUESTIONS_EN = [
  "Please briefly introduce yourself and your frontend development experience.",
  "Which frontend technologies are you currently working with?",
  "What type of project are you currently working on (product, service, or freelance)?",
  "What are your exact responsibilities in the current project?",
  "What is the most challenging frontend issue you recently solved?",
  "What is the difference between == and === in JavaScript?",
  "What is a closure in JavaScript?",
  "What is event bubbling?",
  "If a feature breaks in production, what steps do you take?",
  "Have you owned any feature end-to-end?",
  "What is your current salary?",
  "What is your expected salary?",
  "What is your notice period?",
  "Are you currently interviewing elsewhere or holding any offers?"
];

const FRONTEND_FRAMEWORK_QUESTIONS_EN = {
  react: [
    "What causes unnecessary re-renders in React?",
    "How do you optimize performance in a React app?"
  ],
  angular: [
    "What is change detection in Angular?",
    "What is the difference between Observables and Promises?"
  ]
};

function hasUrduScript(text) {
  return /[\u0600-\u06FF]/.test(text || "");
}

function detectLang(text) {
  return hasUrduScript(text) ? "ur-PK" : "en-PK";
}

function isOrgDevelopmentRole(roleTitle = "") {
  const t = (roleTitle || "").toLowerCase();
  return (
    t.includes("organizational development") ||
    t.includes("organization development") ||
    t.includes("org development") ||
    t.includes("organizational lead") ||
    t.includes("od lead")
  );
}

function isFrontendRole(roleTitle = "") {
  const t = (roleTitle || "").toLowerCase();
  return (
    t.includes("frontend") ||
    t.includes("front-end") ||
    t.includes("front end") ||
    t.includes("react") ||
    t.includes("angular") ||
    t.includes("ui engineer") ||
    t.includes("web developer") ||
    t.includes("javascript")
  );
}

function detectFrontendFrameworkFromText(text = "") {
  const t = String(text || "").toLowerCase();
  if (/\bangular\b|rxjs|ngrx|typescript/.test(t)) return "angular";
  if (/\breact\b|next\.?js|redux|jsx|hooks/.test(t)) return "react";
  return null;
}

function detectFrontendFramework(conversation = [], candidateAnswer = "") {
  const direct = detectFrontendFrameworkFromText(candidateAnswer);
  if (direct) return direct;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const msg = conversation[i];
    if (msg?.type !== "candidate") continue;
    const found = detectFrontendFrameworkFromText(msg.text || "");
    if (found) return found;
  }
  return "react";
}

function frontendQuestionBank(lang, framework = "react") {
  const fw = framework === "angular" ? "angular" : "react";
  const questions = [
    FRONTEND_COMMON_QUESTIONS_EN[0],
    FRONTEND_COMMON_QUESTIONS_EN[1],
    FRONTEND_COMMON_QUESTIONS_EN[2],
    FRONTEND_COMMON_QUESTIONS_EN[3],
    FRONTEND_COMMON_QUESTIONS_EN[4],
    FRONTEND_COMMON_QUESTIONS_EN[5],
    FRONTEND_COMMON_QUESTIONS_EN[6],
    FRONTEND_COMMON_QUESTIONS_EN[7],
    FRONTEND_FRAMEWORK_QUESTIONS_EN[fw][0],
    FRONTEND_FRAMEWORK_QUESTIONS_EN[fw][1],
    FRONTEND_COMMON_QUESTIONS_EN[8],
    FRONTEND_COMMON_QUESTIONS_EN[9],
    FRONTEND_COMMON_QUESTIONS_EN[10],
    FRONTEND_COMMON_QUESTIONS_EN[11],
    FRONTEND_COMMON_QUESTIONS_EN[12],
    FRONTEND_COMMON_QUESTIONS_EN[13]
  ];
  return questions;
}

function bankFor(lang, roleTitle = "", conversation = [], candidateAnswer = "") {
  if (isFrontendRole(roleTitle)) {
    const framework = detectFrontendFramework(conversation, candidateAnswer);
    return frontendQuestionBank(lang, framework);
  }
  const org = isOrgDevelopmentRole(roleTitle);
  if (org) return lang === "ur-PK" ? ORG_DEV_QUESTIONS_UR : ORG_DEV_QUESTIONS_EN;
  return lang === "ur-PK" ? MAIN_QUESTIONS_UR : MAIN_QUESTIONS_EN;
}

function countMainQuestionsAsked(conversation) {
  return (conversation || []).filter((m) => m.type === "ai" && m.kind === "question").length;
}

function followupsSinceLastMain(conversation) {
  let count = 0;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const item = conversation[i];
    if (item.type === "ai" && item.kind === "question") break;
    if (item.type === "ai" && item.kind === "followup") count += 1;
  }
  return count;
}

function lastAiMessage(conversation) {
  const items = conversation || [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].type === "ai") return items[i];
  }
  return null;
}

function depthScore(answerText) {
  const text = (answerText || "").toLowerCase();
  const words = (answerText || "").trim().split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (words >= 25) score += 2;
  if (/\d/.test(text)) score += 1;
  if (/impact|result|tradeoff|metric|because|learned|improved|measured/.test(text)) score += 1;
  if (/Ù†ØªÛŒØ¬Û|Ø§Ø«Ø±|Ù¾ÛŒÙ…Ø§Ù†Û|Ø¨ÛØªØ±ÛŒ|Ø³ÛŒÚ©Ú¾Ø§/.test(answerText || "")) score += 1;
  return score;
}

function answerSatisfiesMeasurementProbe(answerText) {
  const text = (answerText || "").toLowerCase();
  return /measured|metric|tracking|before and after|p95|weekly|kpi|dashboard/.test(text);
}

function seemsRepeatedPrompt(a, b) {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  return x && y && x === y;
}

function snippet(answerText) {
  const words = (answerText || "").trim().split(/\s+/).filter(Boolean).slice(0, 10);
  return words.join(" ");
}

function isGenericFollowup(text) {
  const t = (text || "").trim().toLowerCase();
  const generic = [
    "can you give one concrete example with a measurable outcome?",
    "can you provide more detail?",
    "please elaborate.",
    "please share more details."
  ];
  return generic.includes(t);
}

function trimText(text, max = 280) {
  const t = String(text || "").trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

function extractContextKeywords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .filter((w) => !["with", "from", "that", "this", "your", "about", "have", "what", "when", "which"].includes(w))
    .slice(0, 5);
}

function refineFollowupTone(text, lang) {
  const t = (text || "").trim();
  if (!t) return t;
  if (lang === "ur-PK" || lang === "mix-PK") {
    return t
      .replace(/Can you give one concrete example with a measurable outcome\?/gi, "Ø§Ø³ Ú©Ø§ quantified outcome Ú©ÛŒØ§ ØªÚ¾Ø§ØŸ")
      .replace(/Please give one concrete example and the measurable result\./gi, "Ø§ÛŒÚ© specific example Ø¯ÛŒÚº Ø§ÙˆØ± quantified result Ø¨ØªØ§Ø¦ÛŒÚºÛ”");
  }
  return t
    .replace(/Can you give one concrete example with a measurable outcome\?/gi, "What was the quantified outcome, and how did you validate it?")
    .replace(/Please give one concrete example and the measurable result\./gi, "Share one concrete case with numbers and validation.");
}

function fallbackFollowup(answerText, roleTitle, lang) {
  const text = (answerText || "").toLowerCase();
  const ack = snippet(answerText);

  if (lang === "ur-PK") {
    if (/\d/.test(answerText || "")) {
      return `Ø¢Ù¾ Ù†Û’ "${ack}" Ú©Ø§ Ø°Ú©Ø± Ú©ÛŒØ§ØŒ Ø§Ø³ Ù†ØªÛŒØ¬Û’ Ú©Ùˆ Ø¢Ù¾ Ù†Û’ Ú©Ø³ Ù¾ÛŒÙ…Ø§Ù†Û’ Ù¾Ø± measure Ú©ÛŒØ§ØŸ`;
    }
    if (text.includes("Ù¹ÛŒÙ…")) {
      return `Ø¢Ù¾ Ù†Û’ "${ack}" Ú©ÛØ§ØŒ Ø§Ø³ Ù…ÛŒÚº Ø¨Ø·ÙˆØ± ${roleTitle} Ø¢Ù¾ Ú©Ø§ Ø°Ø§ØªÛŒ Ú©Ø±Ø¯Ø§Ø± Ú©ÛŒØ§ ØªÚ¾Ø§ØŸ`;
    }
    return `Ø¢Ù¾ Ù†Û’ "${ack}" Ø¨ÛŒØ§Ù† Ú©ÛŒØ§ØŒ Ú©ÛŒØ§ Ø¢Ù¾ Ø§ÛŒÚ© Ù…Ø®ØµÙˆØµ Ù…Ø«Ø§Ù„ Ø§ÙˆØ± measurable outcome Ø¯Û’ Ø³Ú©ØªÛ’ ÛÛŒÚºØŸ`;
  }

  if (/\d/.test(text)) return `You mentioned "${ack}". How did you measure that result in practice?`;
  if (text.includes("team")) return `You mentioned "${ack}". What specifically was your own contribution as a ${roleTitle}?`;
  return `You mentioned "${ack}". Can you give one concrete example with a measurable outcome?`;
}

function fallbackNextTurn({ conversation, candidateAnswer, roleTitle, preferredLang }) {
  const lang =
    preferredLang === "ur-PK" || preferredLang === "en-PK" || preferredLang === "mix-PK"
      ? preferredLang
      : detectLang(candidateAnswer);
  const bank = bankFor(lang, roleTitle, conversation, candidateAnswer);
  const asked = countMainQuestionsAsked(conversation);
  const followups = followupsSinceLastMain(conversation);
  let depth = depthScore(candidateAnswer);
  const lastAi = lastAiMessage(conversation);

  if (
    lastAi &&
    lastAi.kind === "followup" &&
    /measure|metric|measured|Ù¾ÛŒÙ…Ø§Ù†Û|Ù…ÛŒÚ˜Ø±/.test(lastAi.text || "") &&
    answerSatisfiesMeasurementProbe(candidateAnswer)
  ) {
    depth = Math.max(depth, 3);
  }

  if (asked >= bank.length) {
    return {
      done: true,
      kind: "closing",
      lang,
      text:
        lang === "ur-PK"
          ? "Ø´Ú©Ø±ÛŒÛÛ” Ø§Ù†Ù¹Ø±ÙˆÛŒÙˆ Ù…Ú©Ù…Ù„ ÛÙˆ Ú¯ÛŒØ§ ÛÛ’Û” Ø¨Ø±Ø§ÛÙ Ú©Ø±Ù… Ø§Ù¾Ù†Ø§ Ø³ÛŒØ´Ù† submit Ú©Ø± Ø¯ÛŒÚºÛ”"
          : lang === "mix-PK"
            ? "Thank you, interview complete ho gaya hai. Ø¨Ø±Ø§ÛÙ Ú©Ø±Ù… Ø§Ù¾Ù†Ø§ Ø³ÛŒØ´Ù† submit Ú©Ø± Ø¯ÛŒÚºÛ”"
            : "Thank you. The interview is complete. Please submit your session."
    };
  }

  if (isFrontendRole(roleTitle)) {
    return {
      done: false,
      kind: "question",
      lang,
      text: bank[asked]
    };
  }

  if (depth < 3 && followups < 2) {
    const followupText = fallbackFollowup(candidateAnswer, roleTitle, lang);
    if (lastAi && seemsRepeatedPrompt(lastAi.text, followupText)) {
      return {
        done: false,
        kind: "question",
        lang,
        text: bank[asked]
      };
    }
    return {
      done: false,
      kind: "followup",
      lang,
      text: followupText
    };
  }

  return {
    done: false,
    kind: "question",
    lang,
    text: bank[asked]
  };
}

export function openingPrompt(candidateName, roleTitle) {
  return openingPromptWithLang(candidateName, roleTitle, "en-PK");
}

export function openingPromptWithLang(candidateName, roleTitle, preferredLang = "en-PK") {
  const firstEn = bankFor("en-PK", roleTitle)[0];
  const firstUr = bankFor("ur-PK", roleTitle)[0];

  if (preferredLang === "mix-PK") {
    return {
      greeting:
        `${candidateName}, welcome to your interview. ` +
        `Ø¢Ù¾ Ú©Ø§ ${roleTitle} Ø±ÙˆÙ„ Ú©Û’ Ù„ÛŒÛ’ Ø§Ø¨ØªØ¯Ø§Ø¦ÛŒ Ø§Ù†Ù¹Ø±ÙˆÛŒÙˆ Ø´Ø±ÙˆØ¹ ÛÙˆ Ø±ÛØ§ ÛÛ’Û”`,
      question:
        isOrgDevelopmentRole(roleTitle)
          ? "As Organizational Development Lead, capability gaps Ø¢Ù¾ Ú©ÛŒØ³Û’ assess Ú©Ø±ØªÛ’ ÛÛŒÚºØŸ"
          : "Please introduce yourself briefly, Ø§ÙˆØ± Ø¨ØªØ§Ø¦ÛŒÚº Ú©Û Ø¢Ù¾ Ø§Ø³ Ø±ÙˆÙ„ Ù…ÛŒÚº Ø¯Ù„Ú†Ø³Ù¾ÛŒ Ú©ÛŒÙˆÚº Ø±Ú©Ú¾ØªÛ’ ÛÛŒÚºÛ”",
      lang: "mix-PK"
    };
  }

  if (preferredLang === "ur-PK") {
    return {
      greeting:
        `${candidateName} ØµØ§Ø­Ø¨/ØµØ§Ø­Ø¨ÛØŒ Ø®ÙˆØ´ Ø¢Ù…Ø¯ÛŒØ¯Û” ` +
        `${roleTitle} Ø±ÙˆÙ„ Ú©Û’ Ø§Ø¨ØªØ¯Ø§Ø¦ÛŒ Ø§Ù†Ù¹Ø±ÙˆÛŒÙˆ Ù…ÛŒÚº Ø¢Ù¾ Ú©Ø§ Ø§Ø³ØªÙ‚Ø¨Ø§Ù„ ÛÛ’Û” ` +
        "Ù…ÛŒÚº Ø¢Ù¾ Ø³Û’ Ù¾Ø±ÙˆÙÛŒØ´Ù†Ù„ Ø§Ù†Ø¯Ø§Ø² Ù…ÛŒÚº Ø³ÙˆØ§Ù„Ø§Øª Ú©Ø±ÙˆÚº Ú¯Ø§Û”",
      question: firstUr,
      lang: "ur-PK"
    };
  }

  return {
    greeting:
      `Welcome ${candidateName}. We will have a structured conversation for the ${roleTitle} role. ` +
      "You can answer in English or Urdu.",
    question: firstEn,
    lang: "en-PK"
  };
}

function withTimeout(promise, timeoutMs, timeoutError = "Operation timed out") {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
    })
  ]);
}

export async function nextTurnSmart(args) {
  const { conversation, candidateAnswer, roleTitle, preferredLang } = args;
  const frontendRole = isFrontendRole(roleTitle);
  if (!isAiConfigured("gemini")) {
    throw new Error("Gemini is required for interview generation. Set GEMINI_API_KEY.");
  }

  const lang =
    preferredLang === "ur-PK" || preferredLang === "en-PK" || preferredLang === "mix-PK"
      ? preferredLang
      : detectLang(candidateAnswer);
  const bank = bankFor(lang, roleTitle, conversation, candidateAnswer);
  const asked = countMainQuestionsAsked(conversation);
  const followups = followupsSinceLastMain(conversation);
  const depth = depthScore(candidateAnswer);
  const lastAi = lastAiMessage(conversation);
  const answerSnippet = snippet(candidateAnswer);

  if (asked >= bank.length) {
    return {
      done: true,
      kind: "closing",
      lang,
      text:
        lang === "ur-PK"
          ? "Ø´Ú©Ø±ÛŒÛÛ” Ø§Ù†Ù¹Ø±ÙˆÛŒÙˆ Ù…Ú©Ù…Ù„ ÛÙˆ Ú¯ÛŒØ§ ÛÛ’Û” Ø¨Ø±Ø§ÛÙ Ú©Ø±Ù… Ø§Ù¾Ù†Ø§ Ø³ÛŒØ´Ù† submit Ú©Ø± Ø¯ÛŒÚºÛ”"
          : lang === "mix-PK"
            ? "Thank you, interview complete ho gaya hai. Ø¨Ø±Ø§ÛÙ Ú©Ø±Ù… Ø§Ù¾Ù†Ø§ Ø³ÛŒØ´Ù† submit Ú©Ø± Ø¯ÛŒÚºÛ”"
            : "Thank you. The interview is complete. Please submit your session."
    };
  }

  const speed = activeSpeed();
  const convo = (conversation || []).slice(-speed.contextTurns).map((m) => ({
    speaker: m.type,
    kind: m.kind,
    text: trimText(m.text, 220)
  }));

  const system = `
You are a live interviewer. Build true dialogue, not monologue.
Output exactly one next turn in strict JSON.
Hard requirements:
- Explicitly reference at least one detail from latest candidate answer.
- If answer lacks detail and followupsOnCurrentQuestion < 2, ask a targeted follow-up.
- If answer is sufficient OR followupsOnCurrentQuestion >= 2, ask the next main question.
- Keep to one short-turn prompt (max 2 sentences).
- Do not repeat previous question wording.
- If all main questions are complete, close interview.
- If lang is ur-PK, use formal Pakistani Urdu vocabulary and tone.
- If lang is mix-PK, produce natural Pakistani code-mixed speech (English + Urdu).
- For followup questions, you MUST reference candidate's latest answer detail explicitly.
- Avoid generic followups such as "give one concrete example" unless tied to a specific detail.
JSON schema:
{
  "done": boolean,
  "kind": "question" | "followup" | "closing",
  "text": string,
  "lang": "en-PK" | "ur-PK" | "mix-PK"
}
`.trim();

  const user = JSON.stringify({
    roleTitle,
    preferredLang: lang,
    answerDepthScore: depth,
    followupsOnCurrentQuestion: followups,
    mainQuestionIndex: asked,
    latestCandidateAnswer: trimText(candidateAnswer, 500),
    latestAnswerSnippet: answerSnippet,
    nextMainQuestion: bank[asked] || null,
    conversation: convo,
    speedProfile: ACTIVE_SPEED_PROFILE,
    interviewMode: frontendRole ? "frontend_structured" : "general"
  });

  const out = await withTimeout(
    chatJson({
      system,
      user,
      temperature: 0.08,
      maxTokens: speed.maxTokens,
      providerOverride: "gemini"
    }),
    speed.llmTimeoutMs,
    "Interviewer generation timeout"
  );

  const validKind = out?.kind === "question" || out?.kind === "followup" || out?.kind === "closing";
  const validLang = out?.lang === "en-PK" || out?.lang === "ur-PK" || out?.lang === "mix-PK";
  const text = typeof out?.text === "string" ? out.text.trim() : "";
  const done = Boolean(out?.done);
  const enforcedLang = lang === "mix-PK" ? "mix-PK" : out?.lang;

  if (!validKind || !validLang || !text) {
    throw new Error("Gemini returned an invalid interview turn payload.");
  }
  if (lastAi && seemsRepeatedPrompt(lastAi.text, text)) {
    throw new Error("Gemini repeated a previous prompt.");
  }
  if (frontendRole && out.kind !== "question" && !done) {
    return {
      done: false,
      kind: "question",
      text: bank[asked],
      lang: enforcedLang
    };
  }
  if (out.kind === "followup") {
    const contextWords = extractContextKeywords(candidateAnswer);
    const mentionsContext =
      contextWords.some((w) => text.toLowerCase().includes(w)) ||
      text.includes("You mentioned") ||
      text.includes("Ø¢Ù¾ Ù†Û’");
    if (!mentionsContext || isGenericFollowup(text)) {
      throw new Error("Gemini returned a low-context follow-up.");
    }
  }

  return {
    done,
    kind: out.kind,
    text: out.kind === "followup" ? refineFollowupTone(text, enforcedLang) : text,
    lang: enforcedLang
  };
}
export function buildTranscriptFromConversation(conversation) {
  return (conversation || [])
    .map((e) => `${e.type === "ai" ? "Interviewer" : "Candidate"}: ${e.text}`)
    .join("\n");
}

