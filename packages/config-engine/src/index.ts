/**
 * @perfeccity/config-engine
 * Configuration Engine — Rules R1–R9
 * 
 * Source of truth: Engineering Handover v7.0, Part 8
 * 
 * This package is isolated and unit-tested independently of any app.
 * It implements the 9 deterministic configuration rules that transform
 * a space's measurements + template + furniture selections into a
 * validated, hashable configuration.
 */

export { computeConfigurationHash } from './hashing';
// Engine rules will be implemented in Sprint 4
