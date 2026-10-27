export function readPersonalTestEnvironment(
  root?: string,
  options?: { requireAuth?: boolean },
): { values: Record<string, string>; env: NodeJS.ProcessEnv; port: number };
