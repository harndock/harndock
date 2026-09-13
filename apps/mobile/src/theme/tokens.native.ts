import { DynamicColorIOS, Platform, PlatformColor } from 'react-native'
import { mobileTheme as lightTheme } from './tokens'

function adaptive(light: string, dark: string, androidName: string): string {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark }) as unknown as string
  if (Platform.OS === 'android') return PlatformColor(androidName) as unknown as string
  return light
}

export const mobileTheme = {
  ...lightTheme,
  color: {
    ...lightTheme.color,
    canvas: adaptive('#f7f8fc', '#0d1018', 'harndock_canvas'),
    surface: adaptive('#ffffff', '#151a30', 'harndock_surface'),
    surfaceMuted: adaptive('#eff1f8', '#1c2442', 'harndock_surface_muted'),
    surfaceAccent: adaptive('#eef0ff', '#252e5a', 'harndock_surface_accent'),
    text: adaptive('#151a2f', '#f4f6ff', 'harndock_text'),
    textSecondary: adaptive('#5d6680', '#b1b9d4', 'harndock_text_secondary'),
    textTertiary: adaptive('#8790aa', '#7e88a8', 'harndock_text_tertiary'),
    border: adaptive('#dce2f2', '#2d365a', 'harndock_border'),
    borderStrong: adaptive('#bcc6e1', '#4a5683', 'harndock_border_strong'),
    brand: adaptive('#3f4fb5', '#9aa7ff', 'harndock_brand'),
    brandPressed: adaptive('#303f99', '#7184f2', 'harndock_brand_pressed'),
    brandSoft: adaptive('#eef0ff', '#252e5a', 'harndock_brand_soft'),
    brandInk: adaptive('#303d86', '#cbd2ff', 'harndock_brand_ink'),
    positiveSoft: adaptive('#e8f6ef', '#183a2d', 'harndock_positive_soft'),
    warningSoft: adaptive('#fff6df', '#3a2f17', 'harndock_warning_soft'),
    dangerSoft: adaptive('#fff0f2', '#3c2026', 'harndock_danger_soft'),
  },
} as const

export type MobileTheme = typeof mobileTheme
