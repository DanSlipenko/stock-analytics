import type { FilingStatus } from './schema';

// IRS Rev. Proc. 2024-40 (2025 brackets), 2025-32 (2026), OBBBA standard deductions.
// 2027 is deliberately a projection with 2026 parameters, not a published schedule.
export const TAX_SOURCES = [
  { label: '2026 federal brackets and deductions', url: 'https://www.irs.gov/irb/2025-45_IRB' },
  { label: '2025 federal brackets', url: 'https://www.irs.gov/irb/2024-45_IRB' },
  {
    label: 'Updated standard deductions',
    url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill',
  },
  { label: 'Capital gains and losses', url: 'https://www.irs.gov/taxtopics/tc409' },
  { label: 'Rental property and passive losses', url: 'https://www.irs.gov/publications/p527' },
  { label: 'Self-employment tax', url: 'https://www.irs.gov/taxtopics/tc554' },
  { label: 'Qualified business income deduction', url: 'https://www.irs.gov/newsroom/qualified-business-income-deduction' },
  { label: 'Net investment income tax', url: 'https://www.irs.gov/taxtopics/tc559' },
  { label: 'Additional Medicare tax', url: 'https://www.irs.gov/taxtopics/tc560' },
  { label: 'Social Security wage bases', url: 'https://www.ssa.gov/oact/cola/cbb.html' },
  { label: '2026 itemized deduction limitation', url: 'https://www.irs.gov/publications/p505' },
];
export const filingLabels: Record<FilingStatus, string> = {
  single: 'Single',
  joint: 'Married filing jointly',
  separate: 'Married filing separately',
  head: 'Head of household',
};
const limits: Record<number, Record<FilingStatus, number[]>> = {
  2025: {
    single: [11925, 48475, 103350, 197300, 250525, 626350],
    joint: [23850, 96950, 206700, 394600, 501050, 751600],
    separate: [11925, 48475, 103350, 197300, 250525, 375800],
    head: [17000, 64850, 103350, 197300, 250500, 626350],
  },
  2026: {
    single: [12400, 50400, 105700, 201775, 256225, 640600],
    joint: [24800, 100800, 211400, 403550, 512450, 768700],
    separate: [12400, 50400, 105700, 201775, 256225, 384350],
    head: [17700, 67450, 105700, 201750, 256200, 640600],
  },
};
const deductions = {
  2025: { single: 15750, joint: 31500, separate: 15750, head: 23625 },
  2026: { single: 16100, joint: 32200, separate: 16100, head: 24150 },
};
const capital = {
  2025: { single: [48350, 533400], joint: [96700, 600050], separate: [48350, 300000], head: [64750, 566700] },
  2026: { single: [49450, 545500], joint: [98900, 613700], separate: [49450, 306850], head: [66200, 579600] },
};
// Section 199A: the threshold and the top of its phase-in range (OBBBA widens the range from 2026).
const qbi = {
  2025: { single: [197300, 247300], joint: [394600, 494600], separate: [197300, 247300], head: [197300, 247300] },
  2026: { single: [201750, 276750], joint: [403500, 553500], separate: [201775, 276775], head: [201750, 276750] },
};
export function taxRules(year: number, status: FilingStatus) {
  const ruleYear = year === 2025 ? 2025 : 2026;
  return {
    ruleYear,
    provisional: year > 2026,
    rates: [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    limits: limits[ruleYear][status],
    standardDeduction: deductions[ruleYear][status],
    capitalLimits: capital[ruleYear][status],
    qbiLimits: qbi[ruleYear][status],
    // From 2026, at least $1,000 of QBI earns a deduction of at least $400.
    qbiMinimum: ruleYear === 2025 ? 0 : 400,
    socialSecurityBase: ruleYear === 2025 ? 176100 : 184500,
    surtaxThreshold: status === 'joint' ? 250000 : status === 'separate' ? 125000 : 200000,
  };
}
