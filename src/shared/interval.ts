export const deliveryIntervals = {
  "15-30": { label: "15-30秒", min: 15, max: 30 },
  "31-60": { label: "31-60秒", min: 31, max: 60 },
  "60-120": { label: "60-120秒", min: 60, max: 120 },
  "121-180": { label: "121-180秒", min: 121, max: 180 },
} as const;
export type DeliveryInterval = keyof typeof deliveryIntervals;
export function deliveryIntervalMs(
  config: {
    deliveryIntervalEnabled?: boolean;
    deliveryInterval?: DeliveryInterval;
  },
  random = Math.random,
): number {
  if (config.deliveryIntervalEnabled === false) return 0;
  const range = deliveryIntervals[config.deliveryInterval || "15-30"];
  const fraction = Math.max(0, Math.min(1 - Number.EPSILON, random()));
  return (
    (range.min + Math.floor(fraction * (range.max - range.min + 1))) * 1000
  );
}
