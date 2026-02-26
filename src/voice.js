function getVoiceConfig() {
  return {
    key: process.env.ELEVENLABS_API_KEY || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "",
    voiceIdEn: process.env.ELEVENLABS_VOICE_ID_EN || "",
    voiceIdUr: process.env.ELEVENLABS_VOICE_ID_UR || "",
    voiceName: process.env.ELEVENLABS_VOICE_NAME || "rabz test voice",
    voiceNameEn: process.env.ELEVENLABS_VOICE_NAME_EN || "",
    voiceNameUr: process.env.ELEVENLABS_VOICE_NAME_UR || "",
    modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2"
  };
}

const DEFAULT_ELEVEN_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

let elevenVoicesCache = {
  expiresAt: 0,
  byName: new Map()
};

const voiceAudioCache = new Map();
const VOICE_CACHE_TTL_MS = 10 * 60 * 1000;
const VOICE_CACHE_MAX_ITEMS = 160;

function buildVoiceCacheKey(text, lang) {
  return `${lang}::${String(text || "").trim().toLowerCase()}`;
}

function getCachedVoice(text, lang) {
  const key = buildVoiceCacheKey(text, lang);
  const hit = voiceAudioCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    voiceAudioCache.delete(key);
    return null;
  }
  return {
    audio: Buffer.from(hit.audio),
    mimeType: hit.mimeType
  };
}

function setCachedVoice(text, lang, result) {
  const plain = String(text || "").trim();
  if (!plain || plain.length > 170) return;
  const key = buildVoiceCacheKey(plain, lang);
  if (voiceAudioCache.size >= VOICE_CACHE_MAX_ITEMS) {
    const first = voiceAudioCache.keys().next().value;
    if (first) voiceAudioCache.delete(first);
  }
  voiceAudioCache.set(key, {
    audio: Buffer.from(result.audio),
    mimeType: result.mimeType || "audio/mpeg",
    expiresAt: Date.now() + VOICE_CACHE_TTL_MS
  });
}

async function loadElevenVoiceMap(apiKey) {
  if (Date.now() < elevenVoicesCache.expiresAt && elevenVoicesCache.byName.size) {
    return elevenVoicesCache.byName;
  }

  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Could not list ElevenLabs voices (${res.status}): ${err.slice(0, 180)}`);
  }

  const json = await res.json();
  const byName = new Map();
  const voices = Array.isArray(json?.voices) ? json.voices : [];
  for (const voice of voices) {
    const name = String(voice?.name || "").trim().toLowerCase();
    const id = String(voice?.voice_id || "").trim();
    if (name && id && !byName.has(name)) byName.set(name, id);
  }

  elevenVoicesCache = {
    expiresAt: Date.now() + 10 * 60 * 1000,
    byName
  };
  return byName;
}

async function resolveElevenVoiceId(cfg, lang) {
  if (lang === "ur-PK" || lang === "mix-PK") {
    if (cfg.voiceIdUr) return cfg.voiceIdUr;
  } else if (cfg.voiceIdEn) {
    return cfg.voiceIdEn;
  }
  if (cfg.voiceId) return cfg.voiceId;

  const byName = await loadElevenVoiceMap(cfg.key);
  const preferredName =
    (lang === "ur-PK" || lang === "mix-PK" ? cfg.voiceNameUr : cfg.voiceNameEn) || cfg.voiceName;
  const resolved = byName.get(String(preferredName || "").trim().toLowerCase());
  if (resolved) return resolved;

  return DEFAULT_ELEVEN_VOICE_ID;
}

function getGeminiTtsConfig() {
  return {
    key: process.env.GEMINI_API_KEY || "",
    modelId: process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts",
    voiceEn: process.env.GEMINI_TTS_VOICE_EN || "Kore",
    voiceUr: process.env.GEMINI_TTS_VOICE_UR || "Kore"
  };
}

function pcm16leToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const blockAlign = channels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);
  return buffer;
}

export function isVoiceAiConfigured() {
  const eleven = getVoiceConfig();
  const gemini = getGeminiTtsConfig();
  return Boolean(eleven.key || gemini.key);
}

async function synthesizeWithElevenLabs({ text, lang = "en-PK" }) {
  const cfg = getVoiceConfig();
  if (!cfg.key) throw new Error("Voice AI not configured");
  const selectedVoiceId = await resolveElevenVoiceId(cfg, lang);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": cfg.key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: cfg.modelId,
      text,
      voice_settings: {
        stability: lang === "ur-PK" ? 0.6 : 0.5,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voice synthesis failed (${res.status}): ${err.slice(0, 220)}`);
  }
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    mimeType: "audio/mpeg"
  };
}

async function synthesizeWithGemini({ text, lang = "en-PK" }) {
  const cfg = getGeminiTtsConfig();
  if (!cfg.key) throw new Error("Gemini TTS key not configured");

  const voiceName = lang === "ur-PK" || lang === "mix-PK" ? cfg.voiceUr : cfg.voiceEn;
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelId)}:generateContent?key=${encodeURIComponent(cfg.key)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text }]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName
            }
          }
        }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini TTS failed (${res.status}): ${err.slice(0, 220)}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((p) => p?.inlineData?.data);
  if (!audioPart?.inlineData?.data) {
    throw new Error("Gemini TTS returned no audio data");
  }

  const mimeType = audioPart.inlineData.mimeType || "audio/wav";
  const rawAudio = Buffer.from(audioPart.inlineData.data, "base64");

  // Gemini often returns raw PCM (audio/L16). Wrap it in WAV for browser compatibility.
  if (/^audio\/l16/i.test(mimeType)) {
    const wav = pcm16leToWav(rawAudio, 24000, 1, 16);
    return {
      audio: wav,
      mimeType: "audio/wav"
    };
  }

  return {
    audio: rawAudio,
    mimeType
  };
}

export async function synthesizeSpeech({ text, lang = "en-PK" }) {
  const eleven = getVoiceConfig();
  const gemini = getGeminiTtsConfig();
  const strictEleven = process.env.ELEVENLABS_STRICT !== "0";
  const cached = getCachedVoice(text, lang);
  if (cached) return cached;

  if (eleven.key) {
    try {
      const out = await synthesizeWithElevenLabs({ text, lang });
      setCachedVoice(text, lang, out);
      return out;
    } catch (err) {
      // One retry for transient provider/network errors.
      try {
        const out = await synthesizeWithElevenLabs({ text, lang });
        setCachedVoice(text, lang, out);
        return out;
      } catch (_err2) {
        if (strictEleven || !gemini.key) throw err;
      }
    }
  }

  if (gemini.key) {
    const out = await synthesizeWithGemini({ text, lang });
    setCachedVoice(text, lang, out);
    return out;
  }

  throw new Error("Voice AI not configured");
}
