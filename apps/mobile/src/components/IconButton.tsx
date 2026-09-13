import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { mobileTheme } from '../theme'

export interface IconButtonProps {
  readonly accessibilityLabel: string
  readonly icon: ReactNode
  readonly onPress: () => void | Promise<void>
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly style?: StyleProp<ViewStyle>
}

export function IconButton({ accessibilityLabel, busy = false, disabled = false, icon, onPress, style }: IconButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={() => { void onPress() }}
      style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed, disabled && styles.disabled, style]}
    >
      {busy ? <ActivityIndicator size="small" /> : icon}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.md,
    justifyContent: 'center',
    minHeight: mobileTheme.touchTarget,
    minWidth: mobileTheme.touchTarget,
  },
  pressed: { backgroundColor: mobileTheme.color.surfaceMuted, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.42 },
})
