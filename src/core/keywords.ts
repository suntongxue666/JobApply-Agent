export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[\n\r,，、]/)
    .map((v) => v.normalize("NFKC").trim())
    .filter((v) => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
