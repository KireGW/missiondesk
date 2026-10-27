export const defaultProcessingModel = "gpt-6-luna";
export const defaultBriefingModel = "gpt-6.1-sol";

export function compactResponseSettings(model: string, outputTokens: number) {
  if (/^gpt-(?:6|5\.[1-9])/.test(model)) {
    return { max_output_tokens: outputTokens + 1536, reasoning: { effort: "low" as const } };
  }
  if (/^gpt-5(?:-|$)/.test(model)) {
    return { max_output_tokens: outputTokens, reasoning: { effort: "minimal" as const } };
  }
  return { max_output_tokens: outputTokens };
}
