export interface VerdictCell {
  day_of_week: number;
  hour_of_day: number;
  score: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  payload_hash: string;
  signature: string;
  signed_at: string;
}

export interface HeatmapResponse {
  feature: string;
  mode: string;
  grid: VerdictCell[];
  publicKey: string;
}
