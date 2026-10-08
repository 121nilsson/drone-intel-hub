export { ieeeBandsFor, ieeeLabel, natoBandsFor, natoLabel, IEEE_BANDS, NATO_BANDS } from "./bands";
export type { FrequencyBandDefinition } from "./bands";
export { parseMoney, toUSD } from "./currency";
export type { Money } from "./currency";
export { parseMagnitude, parseNumber, parseRange } from "./numeric";
export type { QuantityQualifier, QuantityRange } from "./numeric";
export {
  detectProtocols,
  effectiveIeeeBands,
  effectiveNatoBands,
  inferRole,
  intersectBands,
  isFiberOptic,
  linkIsFiber,
  normalizeRF,
  parseFrequencies,
} from "./rf";
export type { NormalizedRFLink, NormalizedRFRole } from "./rf";
export { CANONICAL_UNIT, canonicalUnitFor, convert, normalizeQuantity } from "./units";
export type { Dimension, NormalizedQuantity } from "./units";
