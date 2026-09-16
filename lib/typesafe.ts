// Server-side TypeSafe API client. The API key never leaves the server.

const API_URL = "https://api.typesafe.ai/v1/systemone";

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type Usage = { input_tokens: number; output_tokens: number };

export type EvaluateResult = {
  answers: Record<string, Answer>;
  usage: Usage;
  latencyMs: number;
};

export async function evaluate(
  document: string | object,
  questions: Record<string, Question>
): Promise<EvaluateResult> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set");

  const started = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document, model: "speed_latest", questions }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TypeSafe API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  return {
    answers: json.answers,
    usage: json.usage,
    latencyMs: Date.now() - started,
  };
}
