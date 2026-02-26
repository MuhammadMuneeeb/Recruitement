const provider = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "groq");

function parseJsonText(raw) {
  const text = (raw || "").trim();
  if (!text) throw new Error("No LLM content received");
  try {
    return JSON.parse(text);
  } catch (_err) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const sliced = text.slice(first, last + 1);
      return JSON.parse(sliced);
    }
    throw new Error("Could not parse JSON from model response");
  }
}

function getProviderConfig() {
  if (provider === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta",
      key: process.env.GEMINI_API_KEY,
      model: process.env.AI_MODEL || "gemini-1.5-flash"
    };
  }

  if (provider === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY,
      model: process.env.AI_MODEL || "openai/gpt-4o-mini"
    };
  }

  return {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY,
    model: process.env.AI_MODEL || "llama-3.1-8b-instant"
  };
}

export function isAiConfigured() {
  const cfg = getProviderConfig();
  return Boolean(cfg.key && cfg.model && cfg.url);
}

export function getAiRuntimeInfo() {
  const cfg = getProviderConfig();
  return {
    provider,
    model: cfg.model || "",
    configured: Boolean(cfg.key && cfg.model && cfg.url)
  };
}

export async function chatJson({ system, user, temperature = 0.2, maxTokens = 350 }) {
  const cfg = getProviderConfig();
  if (!cfg.key) throw new Error("AI key not configured");

  if (provider === "gemini") {
    const endpoint =
      `${cfg.url}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          role: "system",
          parts: [{ text: system }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: user }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM call failed (${res.status}): ${text.slice(0, 240)}`);
    }

    const json = await res.json();
    const content = json?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim();
    return parseJsonText(content);
  }

  const headers = {
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json"
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "AI Recruitment MVP";
  }

  const res = await fetch(cfg.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM call failed (${res.status}): ${text.slice(0, 240)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  return parseJsonText(content);
}
