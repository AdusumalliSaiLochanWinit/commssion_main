export function applyWeight(rawPayout, weight) {
  // weight is a percentage (e.g., 40 means 40%)
  return Math.round(rawPayout * (weight / 100) * 100) / 100;
}
