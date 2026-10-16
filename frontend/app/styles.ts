import { StyleSheet } from 'react-native';
import COLORS from '../constants/colors';

export default StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 20 },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  statusText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 11,
    color: COLORS.textDim,
    letterSpacing: 0.5,
  },

  // Navbar
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  navLogo: {
    fontFamily: 'Orbitron_900Black',
    fontSize: 16,
    color: COLORS.accent2,
    letterSpacing: 2,
  },
  navIconBox: {
    width: 32,
    height: 32,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scanner
  scannerSection: { padding: 20 },
  scannerFrame: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  scannerInner: {
    width: 200,
    height: 200,
    position: 'relative',
  },
  corner: { position: 'absolute', width: 24, height: 24 },
  tl: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderColor: COLORS.accent },
  tr: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderColor: COLORS.accent2 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: COLORS.accent2 },
  br: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderColor: COLORS.accent },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: COLORS.accent2,
  },
  scanLabel: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 10,
    letterSpacing: 2,
    color: COLORS.textDim,
  },

  // Result card
  resultCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  resultHeader: {
    padding: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultUrl: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 10,
    color: COLORS.textSecondary,
    flex: 1,
    marginRight: 10,
  },
  resultTime: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 1,
  },
  resultBody: { padding: 16 },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    marginBottom: 14,
  },
  verdictScore: {
    fontFamily: 'Orbitron_900Black',
    fontSize: 52,
    color: COLORS.malicious,
    lineHeight: 56,
  },
  verdictInfo: { paddingBottom: 4 },
  verdictLabel: {
    fontFamily: 'Orbitron_900Black',
    fontSize: 13,
    color: COLORS.malicious,
    letterSpacing: 1,
  },
  verdictSub: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 9,
    color: COLORS.textSecondary,
    letterSpacing: 1.5,
    marginTop: 2,
  },

  // Score bar
  scoreBar: {
    height: 2,
    backgroundColor: COLORS.border,
    borderRadius: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    backgroundColor: COLORS.malicious,
    borderRadius: 1,
  },

  // Signals
  signal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 7,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface2,
    borderRadius: 4,
    borderLeftWidth: 2,
    marginBottom: 5,
  },
  signalLow: { borderLeftColor: COLORS.border },
  signalName: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 9,
    color: COLORS.textSecondary,
    letterSpacing: 1,
  },
  signalValLow: {
    backgroundColor: COLORS.surface2,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  signalValTextLow: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 1,
  },

  // Buttons
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 14,
  },
  btnPrimary: {
    flex: 1,
    padding: 13,
    backgroundColor: COLORS.accent,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 11,
    color: '#fff',
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  btnSecondary: {
    flex: 1,
    padding: 13,
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 11,
    color: COLORS.accent2,
    letterSpacing: 1.2,
  },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    paddingBottom: 28,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    marginTop: 20,
  },
  navItem: { alignItems: 'center', gap: 4 },
  navItemIcon: { fontSize: 14 },
  navItemLabel: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 8,
    letterSpacing: 1.2,
  },
  navItemActive: { color: COLORS.accent },
  navItemInactive: { color: '#3a3560' },

  // Text helpers
  textSecondary: {
    fontFamily: 'ShareTechMono_400Regular',
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
