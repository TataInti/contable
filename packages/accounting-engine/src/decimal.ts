import { Decimal } from "decimal.js";

/** Tipo de una instancia Decimal. */
export type DecimalValue = InstanceType<typeof Decimal>;

/**
 * Configuración de precisión y redondeo del motor.
 * NUMERIC(20,4) para importes, NUMERIC(20,8) para tasas.
 */

export interface EngineConfig {
  moneyPrecision: number;
  ratePrecision: number;
  rounding: Decimal.Rounding;
}

export const DEFAULT_CONFIG: EngineConfig = {
  moneyPrecision: 4,
  ratePrecision: 8,
  rounding: Decimal.ROUND_HALF_UP,
};

let config: EngineConfig = { ...DEFAULT_CONFIG };

export function setEngineConfig(next: Partial<EngineConfig>): void {
  config = { ...config, ...next };
  Decimal.set({ precision: Math.max(config.moneyPrecision, config.ratePrecision) + 10 });
}

export function getEngineConfig(): Readonly<EngineConfig> {
  return config;
}

/** Crea un Decimal validando que sea un importe/tasa válido. */
export function dec(value: string | number | DecimalValue): DecimalValue {
  return new Decimal(value);
}

/** Redondea a precisión de dinero. */
export function roundMoney(value: DecimalValue | string | number): DecimalValue {
  return new Decimal(value).toDecimalPlaces(config.moneyPrecision, config.rounding);
}

/** Redondea a precisión de tasa. */
export function roundRate(value: DecimalValue | string | number): DecimalValue {
  return new Decimal(value).toDecimalPlaces(config.ratePrecision, config.rounding);
}

/** Formatea como string con precisión de dinero. */
export function moneyToString(value: DecimalValue | string | number): string {
  return roundMoney(value).toFixed(config.moneyPrecision);
}

/** Formatea como string con precisión de tasa. */
export function rateToString(value: DecimalValue | string | number): string {
  return roundRate(value).toFixed(config.ratePrecision);
}

/**
 * Convierte importe original × tasa a importe funcional.
 * El redondeo se aplica sobre el resultado final.
 */
export function toFunctional(
  original: DecimalValue | string | number,
  rate: DecimalValue | string | number,
): DecimalValue {
  return roundMoney(dec(original).mul(dec(rate)));
}
