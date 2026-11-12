const KEY = "saltline.range.v1";

export function readRangeBest() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    return {
      bots: Number.isFinite(parsed?.bots) ? Math.max(0, Math.floor(parsed.bots)) : 0,
      targets: Number.isFinite(parsed?.targets) ? Math.max(0, Math.floor(parsed.targets)) : 0,
    };
  } catch {
    return { bots: 0, targets: 0 };
  }
}

export function writeRangeBest(mode, score) {
  const best = readRangeBest();
  const key = mode === "targets" ? "targets" : "bots";
  if (score <= best[key]) return best;
  best[key] = Math.max(0, Math.floor(score));
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // storage unavailable; the session best still applies
  }
  return best;
}
