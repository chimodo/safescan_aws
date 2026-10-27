export interface ColorPalette {
  background: string;
  surface: string;
  surface2: string;
  border: string;
  buttonPrimary: string;
  navy: string;
  secondaryText: string;
  muted: string;
  green: string;
  greenLight: string;
  amber: string;
  amberLight: string;
  amberStrong: string;
  /** Level 3, Very suspicious: between amber (level 2) and red (level 4) */
  orange: string;
  orangeLight: string;
  red: string;
  redLight: string;
  paleBlue: string;
  bg: string;
  accent: string;
  accent2: string;
  textPrimary: string;
  textSecondary: string;
  textDim: string;
  safe: string;
  suspicious: string;
  malicious: string;
}

export const COLORS: ColorPalette = {
  background: '#F5F8FA',
  surface: '#FFFFFF',
  surface2: '#EEF3F6',
  border: '#DCE5EA',
  buttonPrimary: '#147D64',
  navy: '#183447',
  secondaryText: '#526875',
  muted: '#82939C',
  green: '#147D64',
  greenLight: '#E0F3EC',
  amber: '#A96500',
  amberLight: '#FFF1D8',
  amberStrong: '#F2A900',
  orange: '#C2410C',
  orangeLight: '#FFE8D9',
  red: '#B42332',
  redLight: '#FDE7E8',
  paleBlue: '#E8F1F6',
  bg: '#F5F8FA',
  accent: '#147D64',
  accent2: '#2D9B82',
  textPrimary: '#183447',
  textSecondary: '#526875',
  textDim: '#82939C',
  safe: '#147D64',
  suspicious: '#A96500',
  malicious: '#B42332',
};

export const DARK_COLORS: ColorPalette = {
  background: '#101B22',
  surface: '#17262F',
  surface2: '#20333E',
  border: '#2B414D',
  buttonPrimary: '#36B394',
  navy: '#E7F0F3',
  secondaryText: '#B3C4CB',
  muted: '#849AA4',
  green: '#50C6A5',
  greenLight: '#183A35',
  amber: '#FFC15B',
  amberLight: '#49371C',
  amberStrong: '#FFC15B',
  orange: '#FF9A57',
  orangeLight: '#4A2E1E',
  red: '#FF7B83',
  redLight: '#48252B',
  paleBlue: '#203540',
  bg: '#101B22',
  accent: '#36B394',
  accent2: '#50C6A5',
  textPrimary: '#E7F0F3',
  textSecondary: '#B3C4CB',
  textDim: '#849AA4',
  safe: '#50C6A5',
  suspicious: '#FFC15B',
  malicious: '#FF7B83',
};

export default COLORS;
