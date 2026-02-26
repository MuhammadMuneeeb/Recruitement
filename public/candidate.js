const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const preview = document.getElementById("preview");
const camStatus = document.getElementById("camStatus");
const micStatus = document.getElementById("micStatus");
const flowStatus = document.getElementById("flowStatus");
const outMsg = document.getElementById("outMsg");
const submitBtn = document.getElementById("submitBtn");
const liveTranscript = document.getElementById("liveTranscript");
const speechSupport = document.getElementById("speechSupport");
const checkBtn = document.getElementById("checkBtn");
const dialogueFeed = document.getElementById("dialogueFeed");
const interviewerState = document.getElementById("interviewerState");
const interviewerOrb = document.getElementById("interviewerOrb");
const interviewerEmotion = document.getElementById("interviewerEmotion");
const promptLine = document.getElementById("promptLine");
const recruiter3d = document.getElementById("recruiter3d");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEED_PROFILES = {
  balanced: {
    silenceMs: 1400,
    minSpeechMs: 1200,
    minWords: 2,
    noResponseMs: 15000,
    aiTtsTimeoutMs: 6000,
    finalDropMs: 650
  },
  ultra_fast: {
    silenceMs: 1000,
    minSpeechMs: 800,
    minWords: 2,
    noResponseMs: 13000,
    aiTtsTimeoutMs: 2700,
    finalDropMs: 450
  },
  accuracy_first: {
    silenceMs: 1900,
    minSpeechMs: 1700,
    minWords: 3,
    noResponseMs: 17000,
    aiTtsTimeoutMs: 3600,
    finalDropMs: 900
  }
};
const ACTIVE_SPEED_PROFILE_NAME = "balanced";
const ACTIVE_SPEED_PROFILE = SPEED_PROFILES[ACTIVE_SPEED_PROFILE_NAME];
const DEFAULT_INTERVIEW_LANG = "mix-PK";

let stream = null;
let checks = { camera: false, microphone: false };
let interviewStarted = false;
let interviewDone = false;
let recognition = null;
let isListening = false;
let recognizedText = "";
let hasFinalSegment = false;
let silenceTimer = null;
let sendingAnswer = false;
let activePromptLang = "en-PK";
let listenStartedAt = 0;
let lastSpeechAt = 0;
let autoStoppedForSubmission = false;
let aiAudio = null;
let preferredVoice = null;
let currentEmotion = "calm";
let currentMode = "idle";
let threeCtx = null;
let canvasCtx = null;
let recognitionFallbackTried = false;
let mixLangProbeState = "ur-first";
let awaitingStartConfirmation = false;
let noResponseTimer = null;
let noResponseCount = 0;
let audioContext = null;
let analyserNode = null;
let micSourceNode = null;
let audioMonitorRaf = 0;
let audioDetectedAt = 0;
let turnCounter = 0;
let lastSilenceDetectedAt = 0;
let activeTurnLatency = null;
let recognitionHealthTimer = null;
let lastResultAt = 0;
let forcedRecognitionLang = "";

async function loadAiStatus() {
  const badge = document.getElementById("aiStatusBadge");
  if (!badge) return;
  try {
    const res = await fetch("/api/ai/status");
    const data = await res.json();
    const ai = data?.ai || {};
    if (!res.ok || !ai.provider) throw new Error("status unavailable");
    if (ai.configured) {
      badge.textContent = `AI Brain: ${String(ai.provider).toUpperCase()} live`;
      badge.classList.remove("pending", "offline");
      badge.classList.add("online");
      return;
    }
    badge.textContent = "AI Brain: offline";
    badge.classList.remove("pending", "online");
    badge.classList.add("offline");
  } catch (_err) {
    badge.textContent = "AI Brain: unavailable";
    badge.classList.remove("pending", "online");
    badge.classList.add("offline");
  }
}

function beginTurnLatency() {
  turnCounter += 1;
  activeTurnLatency = {
    turnIndex: turnCounter,
    mode: ACTIVE_SPEED_PROFILE_NAME,
    listenStartAt: listenStartedAt || Date.now(),
    silenceDetectedAt: lastSilenceDetectedAt || Date.now(),
    respondStartAt: 0,
    respondEndAt: 0,
    ttsFetchStartAt: 0,
    ttsFetchEndAt: 0,
    aiAudioStartAt: 0
  };
}

function finalizeTurnLatency() {
  if (!activeTurnLatency || !activeTurnLatency.aiAudioStartAt) return;
  const t = activeTurnLatency;
  const payload = {
    interviewToken: token || "",
    turnIndex: t.turnIndex,
    mode: t.mode,
    listenMs: t.silenceDetectedAt - t.listenStartAt,
    llmMs: t.respondEndAt > t.respondStartAt ? (t.respondEndAt - t.respondStartAt) : 0,
    ttsMs: t.ttsFetchEndAt > t.ttsFetchStartAt ? (t.ttsFetchEndAt - t.ttsFetchStartAt) : 0,
    totalMs: t.aiAudioStartAt - t.silenceDetectedAt
  };
  console.log("[turn-latency]", payload);
  fetch("/api/telemetry/turn-latency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {});
  activeTurnLatency = null;
}

function stopStreamTracks(targetStream) {
  if (!targetStream) return;
  for (const track of targetStream.getTracks()) {
    try {
      track.stop();
    } catch (_err) {}
  }
}

function startAudioMonitor(targetStream) {
  if (!targetStream) return;
  const track = targetStream.getAudioTracks()[0];
  if (!track) return;

  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});

    if (micSourceNode) {
      try { micSourceNode.disconnect(); } catch (_err) {}
      micSourceNode = null;
    }
    if (!analyserNode) {
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.8;
    }

    const probeStream = new MediaStream([track]);
    micSourceNode = audioContext.createMediaStreamSource(probeStream);
    micSourceNode.connect(analyserNode);

    const buf = new Uint8Array(analyserNode.fftSize);
    const loop = () => {
      if (!analyserNode) return;
      analyserNode.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.01) audioDetectedAt = Date.now();
      audioMonitorRaf = requestAnimationFrame(loop);
    };
    if (audioMonitorRaf) cancelAnimationFrame(audioMonitorRaf);
    audioMonitorRaf = requestAnimationFrame(loop);
  } catch (_err) {}
}

function splitIntoSpeechChunks(text) {
  const clean = (text || "").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?۔؟])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rankVoice(voice, lang) {
  const id = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;

  if (lang === "ur-PK") {
    if (id.includes("ur-pk") || id.includes("urdu")) score += 140;
  } else {
    if (id.includes("en-pk")) score += 180;
    if (id.includes("en-in")) score += 130;
    if (id.includes("en-gb")) score += 110;
    if (id.includes("en-us")) score += 90;
  }

  if (id.includes("natural")) score += 80;
  if (id.includes("neural")) score += 70;
  if (id.includes("online")) score += 55;
  if (id.includes("microsoft")) score += 45;
  if (id.includes("google")) score += 35;
  if (voice.default) score += 20;
  return score;
}

function chooseBestVoice(lang = "en-PK") {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  const sameLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  const englishFallback = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = sameLanguage.length ? sameLanguage : englishFallback.length ? englishFallback : voices;
  return [...pool].sort((a, b) => rankVoice(b, lang) - rankVoice(a, lang))[0] || null;
}

function initThreeRecruiter() {
  if (!recruiter3d) return;
  if (!window.THREE || !window.THREE.GLTFLoader) {
    initCanvasRecruiter();
    return;
  }

  const THREE = window.THREE;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9eff7);
  scene.fog = new THREE.Fog(0xe9eff7, 6, 16);

  const camera = new THREE.PerspectiveCamera(
    34,
    Math.max(1, recruiter3d.clientWidth) / Math.max(1, recruiter3d.clientHeight),
    0.1,
    100
  );
  camera.position.set(0, 0.15, 3.8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(1, recruiter3d.clientWidth), Math.max(1, recruiter3d.clientHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  recruiter3d.innerHTML = "";
  recruiter3d.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xf3f7ff, 0xb8cadf, 0.95);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(2.2, 2.6, 3.2);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9bc4ff, 0.55);
  rim.position.set(-2.1, 1.4, -1.2);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 64),
    new THREE.MeshStandardMaterial({ color: 0xdbe5f2, roughness: 0.9, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.18;
  floor.receiveShadow = true;
  scene.add(floor);

  const root = new THREE.Group();
  scene.add(root);

  const jacket = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.6, 1.18, 10, 22),
    new THREE.MeshStandardMaterial({ color: 0x25384d, roughness: 0.66, metalness: 0.04 })
  );
  jacket.position.y = -1.02;
  jacket.castShadow = true;
  root.add(jacket);

  const shirt = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.76, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xeaf2ff, roughness: 0.45 })
  );
  shirt.position.set(0, -1.0, 0.37);
  root.add(shirt);

  const tie = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.66, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x2a4c68, roughness: 0.52 })
  );
  tie.position.set(0, -1.02, 0.52);
  root.add(tie);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.98, 0.01, 10, 120),
    new THREE.MeshBasicMaterial({ color: 0x7ea6d2, transparent: true, opacity: 0.26 })
  );
  halo.position.y = -0.03;
  halo.rotation.x = Math.PI / 2;
  scene.add(halo);

  const pointer = { x: 0, y: 0 };
  recruiter3d.addEventListener("pointermove", (e) => {
    const rect = recruiter3d.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  });

  const emotionColors = {
    calm: 0x8bb0d5,
    curious: 0xd79a58,
    encouraging: 0x58b58a,
    serious: 0x6f8197,
    closing: 0x63b590
  };

  let headModel = null;
  let mouthMorphRefs = [];
  const loader = new THREE.GLTFLoader();
  const modelUrl =
    "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb";

  loader.load(
    modelUrl,
    (gltf) => {
      headModel = gltf.scene;
      headModel.scale.setScalar(1.25);
      headModel.position.set(0, -0.08, 0);
      headModel.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (obj.material && obj.material.isMeshStandardMaterial) {
            obj.material.roughness = Math.min(1, obj.material.roughness + 0.08);
            obj.material.metalness = Math.max(0, obj.material.metalness - 0.02);
          }
          if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
            const dict = obj.morphTargetDictionary;
            const names = ["jawOpen", "mouthOpen", "viseme_aa", "AA"];
            for (const name of names) {
              if (dict[name] !== undefined) {
                mouthMorphRefs.push({ mesh: obj, index: dict[name] });
              }
            }
          }
        }
      });
      root.add(headModel);
    },
    undefined,
    () => {
      initCanvasRecruiter();
    }
  );

  function resize() {
    const w = Math.max(1, recruiter3d.clientWidth);
    const h = Math.max(1, recruiter3d.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  function animate() {
    const t = clock.getElapsedTime();
    const speaking = currentMode === "speaking";
    const emotion = currentEmotion;

    const targetY = pointer.x * 0.12;
    const targetX = -pointer.y * 0.05;
    root.rotation.y += (targetY - root.rotation.y) * 0.07;
    root.rotation.x += (targetX - root.rotation.x) * 0.07;

    root.position.y = Math.sin(t * 1.1) * 0.025;
    halo.rotation.z += 0.0027;
    halo.material.color.setHex(emotionColors[emotion] || emotionColors.calm);

    if (headModel) {
      const idleNod = Math.sin(t * 0.9) * 0.03;
      const speakNod = speaking ? Math.sin(t * 9) * 0.02 : 0;
      headModel.rotation.x = idleNod + speakNod;
      headModel.rotation.y += ((pointer.x * 0.07) - headModel.rotation.y) * 0.1;

      const mouthOpen = speaking ? 0.28 + Math.abs(Math.sin(t * 12)) * 0.2 : 0.02;
      for (const m of mouthMorphRefs) {
        m.mesh.morphTargetInfluences[m.index] =
          m.mesh.morphTargetInfluences[m.index] +
          (mouthOpen - m.mesh.morphTargetInfluences[m.index]) * 0.2;
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  threeCtx = { renderer, scene, camera };
  animate();
}

function initCanvasRecruiter() {
  if (!recruiter3d) return;
  recruiter3d.innerHTML = "";
  interviewerOrb.classList.remove("photo-missing");

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  recruiter3d.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    interviewerOrb.classList.add("photo-missing");
    return;
  }

  const pointer = { x: 0, y: 0 };
  recruiter3d.addEventListener("pointermove", (e) => {
    const rect = recruiter3d.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  });

  function resize() {
    const w = Math.max(1, recruiter3d.clientWidth);
    const h = Math.max(1, recruiter3d.clientHeight);
    canvas.width = Math.floor(w * (window.devicePixelRatio || 1));
    canvas.height = Math.floor(h * (window.devicePixelRatio || 1));
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function emotionTint() {
    if (currentEmotion === "curious") return "#e58f4a";
    if (currentEmotion === "encouraging") return "#44a978";
    if (currentEmotion === "serious") return "#5f738d";
    if (currentEmotion === "closing") return "#57a486";
    return "#6a92bf";
  }

  function drawFace(cx, cy, r, t) {
    ctx.save();
    ctx.translate(cx + pointer.x * 10, cy + pointer.y * 6);

    const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.3, 0, 0, r);
    grad.addColorStop(0, "#f4ceb0");
    grad.addColorStop(1, "#d8a984");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#2a1f1a";
    ctx.beginPath();
    ctx.arc(0, -r * 0.2, r * 0.95, Math.PI, Math.PI * 2);
    ctx.fill();

    const eyeY = -r * 0.08 + pointer.y * 2;
    const eyeOffset = r * 0.32;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(-eyeOffset, eyeY, r * 0.14, r * 0.1, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeOffset, eyeY, r * 0.14, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d130f";
    ctx.beginPath();
    ctx.arc(-eyeOffset + pointer.x * 1.6, eyeY + pointer.y * 1.2, r * 0.04, 0, Math.PI * 2);
    ctx.arc(eyeOffset + pointer.x * 1.6, eyeY + pointer.y * 1.2, r * 0.04, 0, Math.PI * 2);
    ctx.fill();

    const mouthOpen = currentMode === "speaking" ? 0.16 + Math.abs(Math.sin(t * 0.018)) * 0.12 : 0.08;
    ctx.strokeStyle = "#733831";
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, r * 0.35, r * 0.22, 0.2, Math.PI - 0.2);
    ctx.stroke();
    if (currentMode === "speaking") {
      ctx.fillStyle = "rgba(95,30,30,0.25)";
      ctx.beginPath();
      ctx.ellipse(0, r * 0.35, r * 0.14, r * mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function animate(ts) {
    const w = recruiter3d.clientWidth;
    const h = recruiter3d.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#d9e7f6");
    bg.addColorStop(1, "#e8f1fb");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const haloColor = emotionTint();
    ctx.strokeStyle = `${haloColor}66`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 - 8, Math.min(w, h) * 0.23, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#2d4662";
    ctx.fillRect(w * 0.34, h * 0.62, w * 0.32, h * 0.27);
    ctx.fillStyle = "#eef5ff";
    ctx.fillRect(w * 0.44, h * 0.62, w * 0.12, h * 0.24);

    drawFace(w / 2, h * 0.43, Math.min(w, h) * 0.16, ts || 0);
    requestAnimationFrame(animate);
  }

  canvasCtx = { canvas, ctx };
  requestAnimationFrame(animate);
}

function hasUrduScript(text) {
  return /[\u0600-\u06FF]/.test(text || "");
}

function normalizeRecognitionLang(lang) {
  // Web Speech API does not support custom locales like mix-PK.
  if (lang === "mix-PK") return mixLangProbeState === "en-second" ? "en-US" : "ur-PK";
  if (lang === "ur-PK") return "ur-PK";
  if (lang === "en-PK") return "en-US";
  return "en-US";
}

function scoreTranscriptCandidate(text, langMode) {
  const t = String(text || "").trim();
  if (!t) return -999;
  let score = t.length;
  const hasUrdu = /[\u0600-\u06FF]/.test(t);
  const hasEnglish = /[a-z]/i.test(t);
  if (langMode === "ur-PK") {
    if (hasUrdu) score += 80;
    if (hasEnglish) score -= 8;
  } else if (langMode === "mix-PK") {
    if (hasUrdu) score += 30;
    if (hasEnglish) score += 20;
  } else if (langMode === "en-PK") {
    if (hasEnglish) score += 25;
  }
  return score;
}

function pickBestAlternative(result, langMode) {
  if (!result || !result.length) return "";
  let best = "";
  let bestScore = -999;
  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i]?.transcript || "";
    const s = scoreTranscriptCandidate(alt, langMode);
    if (s > bestScore) {
      bestScore = s;
      best = alt;
    }
  }
  return best;
}

function detectAnswerLang(text) {
  if (activePromptLang === "mix-PK") return "mix-PK";
  return hasUrduScript(text) ? "ur-PK" : activePromptLang;
}

function isStartConfirmation(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (/[\u0600-\u06FF]/.test(t)) {
    return /جی|ہاں|ہان|شروع|چلو|اوکے/.test(t);
  }
  return /yes|yeah|yep|yas|start|ready|jee|ji|haan|han|ha|okay|ok|sure|chalo|go ahead|begin/.test(t);
}

function isLikelyAffirmative(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (/no|not now|later|wait|ruk|nahi|nahin|نہیں/.test(t)) return false;
  if (isStartConfirmation(t)) return true;
  return t.length <= 14 && /(ye+s?|ya+s?|je+|ji+|ha+n+|ok+|alright)/.test(t);
}

function isLikelyNegative(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  // Keep this strict to avoid false negatives from noisy ASR.
  return /\b(not now|later|wait|stop|ruk|nahi|nahin)\b|نہیں|بعد/.test(t);
}

function detectEmotionFromPrompt(text, bubbleKind = "Interviewer") {
  const t = (text || "").toLowerCase();
  if (bubbleKind === "Closing" || /thank you|complete|submitted|\u0634\u06a9\u0631\u06cc\u06c1/.test(t)) {
    return "closing";
  }
  if (bubbleKind === "Follow-up" || /how|why|specific|measure|example|\u06a9\u06cc\u0648\u06ba|\u06a9\u06cc\u0633\u06d2/.test(t)) {
    return "curious";
  }
  if (/great|good|excellent|nice|appreciate|well done/.test(t)) {
    return "encouraging";
  }
  if (/risk|challenge|tradeoff|difficult|conflict/.test(t)) {
    return "serious";
  }
  return "calm";
}

function setEmotion(emotion) {
  currentEmotion = emotion;
  interviewerOrb.classList.remove(
    "emotion-calm",
    "emotion-curious",
    "emotion-encouraging",
    "emotion-serious",
    "emotion-closing"
  );
  interviewerOrb.classList.add(`emotion-${emotion}`);
  interviewerEmotion.textContent = `Emotion: ${emotion}`;
}

function setInterviewerMode(mode, emotion = "calm") {
  currentMode = mode;
  if (mode === "speaking") {
    interviewerState.textContent = "Interviewer is speaking...";
    interviewerOrb.classList.add("talking");
    setEmotion(emotion);
    return;
  }
  if (mode === "listening") {
    interviewerState.textContent = "Interviewer is listening...";
    interviewerOrb.classList.remove("talking");
    setEmotion("curious");
    return;
  }
  interviewerState.textContent = "Interviewer is preparing...";
  interviewerOrb.classList.remove("talking");
  setEmotion("calm");
}

function addBubble(side, text, label) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${side === "ai" ? "ai" : "human"}`;
  wrap.innerHTML = `<span class="bubble-label">${label}</span>${text}`;
  dialogueFeed.appendChild(wrap);
  dialogueFeed.scrollTop = dialogueFeed.scrollHeight;
}

async function loadSession() {
  if (!token) {
    outMsg.textContent = "Missing interview token.";
    return;
  }

  const res = await fetch(`/api/interviews/${token}`);
  const data = await res.json();
  if (!res.ok) {
    outMsg.textContent = data.error || "Interview not found.";
    return;
  }

  document.getElementById("sessionMeta").textContent =
    `${data.candidate_name} | ${data.role_title}`;
  flowStatus.textContent = "Session: checks";
  outMsg.textContent = "Preparing room and device checks...";

  if (data.status === "completed") {
    outMsg.textContent = "This interview has already been completed.";
    disableAll();
    return;
  }

  runChecks().catch(() => {
    outMsg.textContent = "System check failed unexpectedly.";
  });
}

function disableAll() {
  checkBtn.disabled = true;
  submitBtn.disabled = true;
  liveTranscript.disabled = true;
}

function stopListening() {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (noResponseTimer) clearTimeout(noResponseTimer);
  if (recognitionHealthTimer) clearTimeout(recognitionHealthTimer);
  if (recognition && isListening) {
    try {
      recognition.stop();
    } catch (_err) {}
  }
  isListening = false;
}

function restartRecognitionHealthTimer() {
  if (recognitionHealthTimer) clearTimeout(recognitionHealthTimer);
  recognitionHealthTimer = setTimeout(() => {
    if (!isListening || !recognition || interviewDone || sendingAnswer) return;
    const noResultsForLong = Date.now() - lastResultAt > 4500;
    const voiceIsPresent = Date.now() - audioDetectedAt < 2500;
    if (noResultsForLong && voiceIsPresent) {
      try {
        recognition.stop();
      } catch (_err) {}
      setTimeout(() => {
        if (!isListening && !interviewDone && !sendingAnswer) {
          try {
            forcedRecognitionLang = "en-US";
            recognition.lang = "en-US";
            recognition.start();
            isListening = true;
            outMsg.textContent = "Mic recovered in compatibility mode. Please continue speaking.";
          } catch (_err) {}
        }
      }, 180);
    }
    restartRecognitionHealthTimer();
  }, 1200);
}

function restartNoResponseTimer() {
  if (noResponseTimer) clearTimeout(noResponseTimer);
  noResponseTimer = setTimeout(async () => {
    if (!isListening || sendingAnswer || interviewDone) return;
    if ((recognizedText || "").trim()) return;
    // If we detect raw voice energy, avoid interrupting and keep listening.
    if (Date.now() - audioDetectedAt < 5000) {
      restartNoResponseTimer();
      return;
    }
    noResponseCount += 1;
    stopListening();
    const nudge =
      noResponseCount % 2 === 1
        ? "I can't hear you, are you there? Agar aap sun rahe hain to please boliye."
        : "Still not getting your voice. Please unmute mic and answer. Main sun raha hun.";
    await playAiTurn(nudge, "mix-PK", "Interviewer");
  }, ACTIVE_SPEED_PROFILE.noResponseMs);
}

async function runChecks() {
  stopStreamTracks(stream);
  stream = null;

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    checks = { camera: false, microphone: false };
    camStatus.textContent = "Camera: unsupported";
    micStatus.textContent = "Mic: unsupported";
    flowStatus.textContent = "Session: blocked";
    outMsg.textContent = "Your browser does not support media capture. Use latest Chrome/Edge.";
    return;
  }

  try {
    // First try combined capture for best compatibility.
    let combinedStream = null;
    let videoStream = null;
    let audioStream = null;

    try {
      combinedStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (_combinedErr) {
      // Fallback to separate checks so one denied device doesn't fail both statuses.
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (_videoErr) {}
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (_audioErr) {}
    }

    if (combinedStream) {
      stream = combinedStream;
    } else {
      stream = new MediaStream([
        ...(videoStream ? videoStream.getVideoTracks() : []),
        ...(audioStream ? audioStream.getAudioTracks() : [])
      ]);
    }

    // If combined stream came back without audio, do one explicit mic probe.
    if (!stream.getAudioTracks().length) {
      try {
        const micProbe = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const probeTrack = micProbe.getAudioTracks()[0];
        if (probeTrack) stream.addTrack(probeTrack);
      } catch (_micProbeErr) {}
    }

    preview.srcObject = stream;
    preview
      .play()
      .catch(() => {});

    const hasVideo = stream.getVideoTracks().some((t) => t.readyState !== "ended");
    const hasAudio = stream.getAudioTracks().some((t) => t.readyState !== "ended");
    startAudioMonitor(stream);
    checks = { camera: hasVideo, microphone: hasAudio };

    camStatus.textContent = `Camera: ${hasVideo ? "ok" : "failed"}`;
    micStatus.textContent = `Mic: ${hasAudio ? "ok" : "failed"}`;
    flowStatus.textContent = "Session: ready";
    outMsg.textContent = hasVideo && hasAudio
      ? "Checks passed. Please say yes to start."
      : "Camera and microphone are required.";

    if (hasVideo && hasAudio) {
      checkBtn.disabled = true;
      await askStartConfirmation();
      return;
    }

    outMsg.textContent = "Please allow both camera and microphone permissions, then click Run Checks again.";
  } catch (err) {
    checks = { camera: false, microphone: false };
    camStatus.textContent = "Camera: failed";
    micStatus.textContent = "Mic: failed";
    flowStatus.textContent = "Session: blocked";
    const reason = err?.name ? ` (${err.name})` : "";
    outMsg.textContent =
      `Access denied or unavailable devices${reason}. Check browser site permissions for camera/microphone.`;
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    speechSupport.textContent =
      "Speech recognition is not supported in this browser. Use Chrome or Edge.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-PK";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 3;

  recognition.onresult = (event) => {
    lastResultAt = Date.now();
    const finalParts = [];
    let interim = "";
    let gotFinal = false;
    for (let i = 0; i < event.results.length; i += 1) {
      const piece = pickBestAlternative(event.results[i], activePromptLang) || "";
      if (event.results[i].isFinal) {
        finalParts.push(piece);
      } else {
        interim += `${piece} `;
      }
      if (event.results[i].isFinal) gotFinal = true;
    }
    hasFinalSegment = hasFinalSegment || gotFinal;
    recognizedText = `${finalParts.join(" ")} ${interim}`.trim();
    liveTranscript.value = recognizedText;
    lastSpeechAt = Date.now();

    // For interview start confirmation, react instantly to "yes" to avoid loop/stall.
    if (awaitingStartConfirmation && !interviewStarted && recognizedText.trim()) {
      if (!isLikelyNegative(recognizedText)) {
        autoStoppedForSubmission = true;
        try {
          recognition.stop();
        } catch (_err) {}
        return;
      }
    }

    restartSilenceTimer();
    restartNoResponseTimer();
    restartRecognitionHealthTimer();

    // Faster handoff in balanced mode: when final ASR lands and audio drops, submit early.
    if (
      gotFinal &&
      shouldStopAfterSilence() &&
      Date.now() - audioDetectedAt > ACTIVE_SPEED_PROFILE.finalDropMs
    ) {
      lastSilenceDetectedAt = Date.now();
      autoStoppedForSubmission = true;
      try {
        recognition.stop();
      } catch (_err) {}
      return;
    }
    if (gotFinal && shouldStopAfterSilence()) restartSilenceTimer();
  };

  recognition.onend = () => {
    isListening = false;
    if (autoStoppedForSubmission && !sendingAnswer && (interviewStarted || awaitingStartConfirmation) && !interviewDone) {
      autoStoppedForSubmission = false;
      sendCurrentAnswer().catch(() => {
        outMsg.textContent = "Could not process response.";
      });
      return;
    }
    if (!sendingAnswer && (interviewStarted || awaitingStartConfirmation) && !interviewDone) {
      setTimeout(() => {
        if (!sendingAnswer && !interviewDone) startListening();
      }, 300);
    }
  };

  recognition.onerror = (event) => {
    const code = event?.error || "unknown";
    // In bilingual mode, switch probe between English and Urdu before failing.
    if (activePromptLang === "mix-PK" && code !== "not-allowed") {
      if (mixLangProbeState === "ur-first") {
        mixLangProbeState = "en-second";
        outMsg.textContent = "Switching recognition to English probe for better capture...";
        setTimeout(() => {
          if (!interviewDone && (interviewStarted || awaitingStartConfirmation) && !isListening) startListening();
        }, 220);
        return;
      }
      mixLangProbeState = "ur-first";
    }

    // Generic locale fallback to English once.
    if (!recognitionFallbackTried && code !== "not-allowed" && recognition.lang !== "en-US") {
      recognitionFallbackTried = true;
      forcedRecognitionLang = "en-US";
      recognition.lang = "en-US";
      outMsg.textContent = "Switching mic recognition to English fallback for better capture...";
      setTimeout(() => {
        if (!interviewDone && (interviewStarted || awaitingStartConfirmation) && !isListening) startListening();
      }, 250);
      return;
    }

    if (code === "audio-capture" || code === "network") {
      forcedRecognitionLang = "en-US";
    }
    outMsg.textContent = `Mic recognition issue: ${code}. Please keep mic enabled and speak clearly.`;
  };

  recognition.onstart = () => {
    lastResultAt = Date.now();
    outMsg.textContent = "Listening to candidate response...";
    restartRecognitionHealthTimer();
  };
}

async function speakWithAiVoice(text, lang) {
  const ctrl = new AbortController();
  if (activeTurnLatency && !activeTurnLatency.ttsFetchStartAt) {
    activeTurnLatency.ttsFetchStartAt = Date.now();
  }
  const timeout = setTimeout(() => ctrl.abort(), ACTIVE_SPEED_PROFILE.aiTtsTimeoutMs);
  let res = null;
  try {
    res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
      signal: ctrl.signal
    });
  } catch (_err) {
    // One retry for transient failures before fallback.
    res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
      signal: ctrl.signal
    });
  }
  clearTimeout(timeout);
  if (activeTurnLatency && !activeTurnLatency.ttsFetchEndAt) {
    activeTurnLatency.ttsFetchEndAt = Date.now();
  }
  if (!res.ok) throw new Error("AI voice unavailable");
  const blob = await res.blob();
  if (aiAudio) {
    aiAudio.pause();
    aiAudio = null;
  }
  const url = URL.createObjectURL(blob);
  aiAudio = new Audio(url);
  await new Promise((resolve, reject) => {
    aiAudio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    aiAudio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("AI audio decode/playback failed"));
    };
    aiAudio.onplay = () => {
      if (activeTurnLatency && !activeTurnLatency.aiAudioStartAt) {
        activeTurnLatency.aiAudioStartAt = Date.now();
        finalizeTurnLatency();
      }
    };
    aiAudio.play().catch((err) => {
      URL.revokeObjectURL(url);
      reject(err || new Error("AI audio playback blocked"));
    });
  });
}

function speakFallback(text, lang) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }

    const chunks = splitIntoSpeechChunks(text);
    if (!chunks.length) {
      resolve();
      return;
    }

    const targetLang = lang || "en-PK";
    preferredVoice = chooseBestVoice(targetLang) || preferredVoice;

    let index = 0;
    const speakNext = () => {
      if (index >= chunks.length) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = targetLang;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      if (preferredVoice) utterance.voice = preferredVoice;
      utterance.onstart = () => {
        if (activeTurnLatency && !activeTurnLatency.aiAudioStartAt) {
          activeTurnLatency.aiAudioStartAt = Date.now();
          finalizeTurnLatency();
        }
      };
      utterance.onend = () => {
        index += 1;
        setTimeout(speakNext, 70);
      };
      utterance.onerror = () => {
        index += 1;
        setTimeout(speakNext, 70);
      };
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    speakNext();
  });
}

async function speak(text, lang = "en-PK") {
  const emotion = detectEmotionFromPrompt(text);
  setInterviewerMode("speaking", emotion);
  try {
    await speakWithAiVoice(text, lang);
  } catch (_err) {
    await speakFallback(text, lang);
  } finally {
    setInterviewerMode("listening");
  }
}

function shouldStopAfterSilence() {
  if (!recognizedText) return false;
  const words = recognizedText.split(/\s+/).filter(Boolean).length;
  const requiredWords = awaitingStartConfirmation ? 1 : ACTIVE_SPEED_PROFILE.minWords;
  const enoughWords = words >= requiredWords;
  const requiredDuration = awaitingStartConfirmation ? 350 : ACTIVE_SPEED_PROFILE.minSpeechMs;
  const enoughDuration = Date.now() - listenStartedAt >= requiredDuration;
  return enoughWords && enoughDuration;
}

function restartSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const silentLongEnough = Date.now() - lastSpeechAt >= ACTIVE_SPEED_PROFILE.silenceMs;
    if (!isListening || !recognition || !silentLongEnough) return;

    if (shouldStopAfterSilence()) {
      lastSilenceDetectedAt = Date.now();
      autoStoppedForSubmission = true;
      recognition.stop();
      return;
    }
    restartSilenceTimer();
  }, ACTIVE_SPEED_PROFILE.silenceMs);
}

function startListening() {
  if (!recognition || (!interviewStarted && !awaitingStartConfirmation) || interviewDone || isListening) return;
  if (awaitingStartConfirmation) {
    recognizedText = "";
    hasFinalSegment = false;
    if (liveTranscript) liveTranscript.value = "";
  } else if (!recognizedText) {
    hasFinalSegment = false;
  }
  autoStoppedForSubmission = false;
  listenStartedAt = Date.now();
  lastSpeechAt = Date.now();
  noResponseCount = 0;

  try {
    recognition.lang = forcedRecognitionLang || normalizeRecognitionLang(activePromptLang);
    recognitionFallbackTried = false;
    recognition.start();
    isListening = true;
    setInterviewerMode("listening");
    outMsg.textContent =
      activePromptLang === "mix-PK"
        ? "Listening in Urdu + English mode..."
        : "Listening to candidate response...";
    restartNoResponseTimer();
  } catch (_err) {
    // Recover from transient recognition state errors.
    try {
      recognition.stop();
    } catch (_e) {}
    setTimeout(() => {
      if (!isListening && !interviewDone && (interviewStarted || awaitingStartConfirmation)) {
        try {
          recognition.start();
          isListening = true;
          restartNoResponseTimer();
        } catch (_e2) {}
      }
    }, 180);
    outMsg.textContent = "Microphone reconnecting...";
  }
}

async function playAiTurn(text, lang = "en-PK", bubbleKind = "Interviewer") {
  activePromptLang = lang;
  promptLine.textContent = text;
  setEmotion(detectEmotionFromPrompt(text, bubbleKind));
  addBubble("ai", text, bubbleKind);
  await speak(text, lang);
  if (!interviewDone) startListening();
}

async function startInterview() {
  if (interviewStarted) return;

  const res = await fetch(`/api/interviews/${token}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checks, preferredLang: DEFAULT_INTERVIEW_LANG })
  });
  const data = await res.json();
  if (!res.ok) {
    outMsg.textContent = data.error || "Could not start interview.";
    return;
  }

  interviewStarted = true;
  flowStatus.textContent = "Session: live";
  outMsg.textContent = "Interview started.";

  const turnLang = data.lang || "en-PK";
  addBubble("ai", data.opening, "Interviewer");
  promptLine.textContent = data.opening;
  setEmotion("calm");
  await speak(data.opening, turnLang);
  await playAiTurn(data.question, turnLang, "Question");
}

async function askStartConfirmation() {
  awaitingStartConfirmation = true;
  recognizedText = "";
  hasFinalSegment = false;
  if (liveTranscript) liveTranscript.value = "";
  flowStatus.textContent = "Session: ready";
  outMsg.textContent = "Checks complete. Waiting for your confirmation.";
  await playAiTurn(
    "Checks complete. Kya hum interview start karein? Please say yes to begin.",
    "mix-PK",
    "Interviewer"
  );
}

async function sendCurrentAnswer() {
  if (interviewDone || sendingAnswer) return;

  const answerText = (recognizedText || liveTranscript.value || "").trim();
  if (!answerText) {
    outMsg.textContent = "No clear response detected.";
    await playAiTurn("I can't hear you clearly. Are you there? Please respond.", "mix-PK", "Interviewer");
    return;
  }

  if (awaitingStartConfirmation && !interviewStarted) {
    if (!isLikelyNegative(answerText) && answerText.trim()) {
      awaitingStartConfirmation = false;
      await startInterview();
      return;
    }
    await playAiTurn(
      "No problem. Jab aap ready hon, just say yes and we will begin.",
      "mix-PK",
      "Interviewer"
    );
    return;
  }

  if (!interviewStarted) {
    return;
  }

  sendingAnswer = true;
  stopListening();
  beginTurnLatency();
  activeTurnLatency.mode = ACTIVE_SPEED_PROFILE_NAME;
  activeTurnLatency.respondStartAt = Date.now();
  flowStatus.textContent = "Session: processing";
  addBubble("human", answerText, "Candidate");
  promptLine.textContent = "Interviewer is thinking...";
  outMsg.textContent = "Thinking about your response...";

  try {
    const answerLang = detectAnswerLang(answerText);
    const res = await fetch(`/api/interviews/${token}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerText, lang: answerLang })
    });
    const data = await res.json();
    if (activeTurnLatency && !activeTurnLatency.respondEndAt) {
      activeTurnLatency.respondEndAt = Date.now();
    }
    if (!res.ok) {
      outMsg.textContent = data.error || "Could not process response.";
      return;
    }

    liveTranscript.value = "";
    recognizedText = "";
    flowStatus.textContent = "Session: live";

    if (data.done) {
      interviewDone = true;
      submitBtn.disabled = false;
      flowStatus.textContent = "Session: completed";
      await playAiTurn(data.nextPrompt, data.lang || "en-PK", "Closing");
      outMsg.textContent = "Interview finished. Click Finish Interview.";
      return;
    }

    await playAiTurn(
      data.nextPrompt,
      data.lang || "en-PK",
      data.kind === "followup" ? "Follow-up" : "Question"
    );
  } finally {
    sendingAnswer = false;
  }
}

async function submitInterview() {
  if (!interviewStarted) {
    outMsg.textContent = "Interview has not started.";
    return;
  }

  const res = await fetch(`/api/interviews/${token}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (!res.ok) {
    outMsg.textContent = data.error || "Could not finish interview.";
    return;
  }

  flowStatus.textContent = "Session: submitted";
  outMsg.textContent = `Submitted. Recommendation: ${data.aiFeedback.recommendation} (score ${data.aiFeedback.score}).`;
  submitBtn.disabled = true;
}

checkBtn.addEventListener("click", () => {
  runChecks().catch(() => {
    outMsg.textContent = "System check failed unexpectedly.";
  });
});

submitBtn.addEventListener("click", () => {
  submitInterview().catch(() => {
    outMsg.textContent = "Could not submit interview.";
  });
});

setEmotion("calm");
initThreeRecruiter();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    preferredVoice = chooseBestVoice(activePromptLang || "en-PK");
  };
  preferredVoice = chooseBestVoice("en-PK");
}
setupSpeechRecognition();
loadAiStatus().catch(() => {});
loadSession().catch(() => {
  outMsg.textContent = "Could not load session.";
});
