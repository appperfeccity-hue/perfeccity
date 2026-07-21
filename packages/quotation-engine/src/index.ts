/**
 * Quotation Engine — public API
 */
export { runQuotationEngine } from './engine';
export { computeQuotationSeal } from './seal';
export type {
  QuotationInput,
  QuotationOutput,
  StepBreakdown,
  ConfigLineItem,
  SpaceContext,
  FurnitureItem,
  PricingSettings,
} from './types';
export type { SealInput, SealOutput } from './seal';
