export const COLORS = {
  navy: '#102C46',
  buttonPrimary: '#102C46',
  background: '#F7F9FC',
  surface: '#FFFFFF',
  green: '#20AD73',
  greenLight: '#E8F7EF',
  amber: '#B97800',
  amberStrong: '#F2B544',
  amberLight: '#FFF5DD',
  red: '#D9363E',
  redStrong: '#E5484D',
  redLight: '#FFF0F0',
  secondaryText: '#687789',
  border: '#E5EAF0',
  muted: '#9AA7B5',
  paleBlue: '#EDF4FA',
} as const;

export const DARK_COLORS = {
  ...COLORS,
  navy: '#ECF2F7',
  buttonPrimary: '#2A4558',
  background: '#111B24',
  surface: '#1B2935',
  greenLight: '#173D31',
  amber: '#FFD176',
  amberLight: '#46371D',
  red: '#FF8388',
  redLight: '#48262B',
  secondaryText: '#AAB8C5',
  border: '#334451',
  muted: '#8594A2',
  paleBlue: '#243541',
} as const;

export type ColorPalette = { [Key in keyof typeof COLORS]: string };
