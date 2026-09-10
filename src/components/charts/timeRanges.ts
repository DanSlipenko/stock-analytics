export type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const TIME_RANGES: { key: TimeRange; label: string; seconds: number }[] = [
  { key: '1W', label: '1W', seconds: 7 * 86400 },
  { key: '1M', label: '1M', seconds: 30 * 86400 },
  { key: '3M', label: '3M', seconds: 90 * 86400 },
  { key: '6M', label: '6M', seconds: 180 * 86400 },
  { key: '1Y', label: '1Y', seconds: 365 * 86400 },
  { key: 'ALL', label: 'ALL', seconds: 5 * 365 * 86400 },
];
