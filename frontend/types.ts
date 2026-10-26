export type SignalLevel = 'low' | 'medium' | 'high';

export interface Signal {
  label: string;
  val: string;
  level: SignalLevel;
}
