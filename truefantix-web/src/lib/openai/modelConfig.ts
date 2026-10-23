function sanitizeModelName(value: string | undefined): string | null {
  if (!value) return null;

  const sanitized = value
    .replace(/\\(?:r\\n|n|r|t)/gi, "")
    .replace(/[\r\n\t]/g, "")
    .trim();

  return sanitized || null;
}

export function configuredOpenAiModel(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const model = sanitizeModelName(value);
    if (model) return model;
  }

  return null;
}
