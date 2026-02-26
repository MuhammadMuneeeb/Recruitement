import { chatJson, isAiConfigured } from "./llm.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function heuristicFeedback({ roleTitle, transcript }) {
  const text = (transcript || "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const hasNumbers = /\d/.test(text);
  const impact = /(impact|improv|result|metric|measured|led|built|tradeoff)/.test(text);
  const communication = clamp(Math.round(words / 55), 1, 5);
  const problemSolving = impact ? 4 : 2;
  const roleFit = /(project|team|delivery|ownership)/.test(text) ? 3 : 2;
  const clarity = hasNumbers ? 4 : 3;

  const score = Math.round(
    communication * 20 * 0.2 +
    problemSolving * 20 * 0.35 +
    roleFit * 20 * 0.25 +
    clarity * 20 * 0.2
  );

  const recommendation = score >= 75 ? "Shortlist" : score >= 60 ? "Hold" : "Reject";

  return {
    roleTitle,
    score,
    recommendation,
    strengths: [
      "Maintained coherent communication throughout the interview.",
      "Provided at least one ownership-oriented example."
    ],
    risks: [
      "Technical depth could be validated further in a live technical round.",
      "More measurable outcomes would improve confidence."
    ],
    evidence: [
      "Candidate described project context and responsibilities.",
      hasNumbers ? "Candidate cited quantified outcomes." : "Limited quantified outcomes in responses."
    ],
    rubric: {
      communication,
      problemSolving,
      roleFit,
      clarity
    }
  };
}

export async function generateAiFeedback({ roleTitle, transcript }) {
  if (!isAiConfigured()) return heuristicFeedback({ roleTitle, transcript });

  const system = `
You are a hiring evaluator scoring first-round interview transcripts.
Return strict JSON with this schema:
{
  "roleTitle": string,
  "score": number,
  "recommendation": "Shortlist" | "Hold" | "Reject",
  "strengths": string[],
  "risks": string[],
  "evidence": string[],
  "rubric": {
    "communication": number,
    "problemSolving": number,
    "roleFit": number,
    "clarity": number
  }
}
Rules:
- rubric values are 1-5
- overall score is 0-100 and should align with rubric
- use evidence from transcript only
- max 3 items each for strengths/risks/evidence
`.trim();

  const user = JSON.stringify({ roleTitle, transcript });

  try {
    const out = await chatJson({
      system,
      user,
      temperature: 0.1,
      maxTokens: 520
    });

    const score = Number(out?.score);
    const recommendation = out?.recommendation;
    const rubric = out?.rubric || {};
    const communication = clamp(Number(rubric.communication || 0), 1, 5);
    const problemSolving = clamp(Number(rubric.problemSolving || 0), 1, 5);
    const roleFit = clamp(Number(rubric.roleFit || 0), 1, 5);
    const clarity = clamp(Number(rubric.clarity || 0), 1, 5);

    if (
      Number.isNaN(score) ||
      score < 0 ||
      score > 100 ||
      !["Shortlist", "Hold", "Reject"].includes(recommendation)
    ) {
      return heuristicFeedback({ roleTitle, transcript });
    }

    const strengths = Array.isArray(out?.strengths) ? out.strengths.slice(0, 3) : [];
    const risks = Array.isArray(out?.risks) ? out.risks.slice(0, 3) : [];
    const evidence = Array.isArray(out?.evidence) ? out.evidence.slice(0, 3) : [];

    return {
      roleTitle,
      score: Math.round(score),
      recommendation,
      strengths,
      risks,
      evidence,
      rubric: {
        communication,
        problemSolving,
        roleFit,
        clarity
      }
    };
  } catch (_err) {
    return heuristicFeedback({ roleTitle, transcript });
  }
}
