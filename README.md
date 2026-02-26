# AI Recruitment MVP

Initial MVP for AI-led first-round interviews with:
- Candidate invite links
- Device pre-checks (camera/microphone)
- Interview session flow
- Recording/transcript placeholders
- Recruiter feedback view

## Stack
- Node.js
- Express
- SQLite
- Vanilla HTML/CSS/JS frontend

## Quick Start
1. Install dependencies:
   - `npm install`
2. Configure env:
   - Copy `.env.example` values to your environment (or set variables in your deployment platform)
2. Run the app:
   - `npm run dev`
3. Open:
   - `http://localhost:3000`

## Optional AI Provider Setup (Recommended)
The app can run with free-tier LLM providers for smarter follow-up questions and scoring.

### Option A: Groq (fast, recommended)
Set environment variables before running:
- `AI_PROVIDER=groq`
- `GROQ_API_KEY=your_key_here`
- `AI_MODEL=llama-3.1-8b-instant` (or another Groq-supported model)

### Option B: OpenRouter
Set:
- `AI_PROVIDER=openrouter`
- `OPENROUTER_API_KEY=your_key_here`
- `AI_MODEL=openai/gpt-4o-mini` (or another supported model)
- Optional: `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME`

If no key is configured, the app falls back to built-in local interview/scoring logic.

## Optional AI Voice (higher quality)
For more natural interviewer voice, configure ElevenLabs:
- `ELEVENLABS_API_KEY=your_key_here`
- `ELEVENLABS_VOICE_ID=voice_id` (optional; default set in code)
- `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` (optional)

Or use Gemini TTS (uses your existing `GEMINI_API_KEY`):
- `GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts`
- `GEMINI_TTS_VOICE_EN=Kore` (optional)
- `GEMINI_TTS_VOICE_UR=Kore` (optional)

If no TTS provider is configured, browser speech synthesis is used as fallback.

## Production Deployment Checklist
- Set `GEMINI_API_KEY`.
- Set `RECRUITER_ACCESS_KEY` to protect recruiter endpoints and review data.
- Set `ALLOWED_ORIGINS` to your frontend/domain.
- Keep `INTERVIEW_SPEED_PROFILE=balanced` for best latency/quality tradeoff.
- Configure rate limits:
  - `RATE_MAX_DEFAULT`, `RATE_MAX_RESPOND`, `RATE_MAX_TTS`, `RATE_MAX_CREATE`
- Health probes:
  - `GET /api/health`
  - `GET /api/ready`
- Optional telemetry:
  - `POST /api/telemetry/turn-latency` (enabled unless `ENABLE_LATENCY_TELEMETRY=0`)

## Initial Endpoints
- `POST /api/interviews/create`
- `GET /api/interviews/:token`
- `POST /api/interviews/:token/start`
- `POST /api/interviews/:token/respond`
- `POST /api/interviews/:token/submit`
- `GET /api/recruiter/interviews`
- `GET /api/recruiter/interviews/:id`
- `GET /api/ai/status`
- `GET /api/config/public`

## Notes
- Camera and mic checks are implemented on the candidate pre-check page.
- AI scoring is currently a deterministic placeholder to be replaced with real model integration.
