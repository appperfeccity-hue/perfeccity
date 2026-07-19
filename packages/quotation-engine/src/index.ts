/**
 * @perfeccity/quotation-engine
 * 13-Step Deterministic Quotation Engine + SHA-256 Seal
 * 
 * Source of truth: Engineering Handover v7.0, Part 8
 * 
 * Fixed constants:
 * - MARGIN_RATE = 0.25
 * - GST_RATE = 0.18
 * 
 * Steps: 1. Effective DNA → 2. Panel SKU data → 3. Net areas →
 * 4. Panel cost → 5. Non-panel costs → 6. Structural check →
 * 7. Moisture verify → 8. Labour → 9. Transport → 10. Furniture →
 * 11. Subtotal → 12. Margin + pre-GST → 13. GST + grand total + seal
 */

export { computeQuotationSeal } from './seal';
// Engine steps will be implemented in Sprint 5
