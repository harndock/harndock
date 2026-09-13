import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { mobileTheme } from '../theme'

export type AppButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export interface AppButtonProps {
  readonly label: string
  readonly onPress: () => void | Promise<void>
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly variant?: AppButtonVariant
  readonly leading?: ReactNode
  readonly accessibilityLabel?: string
  readonly testID?: string
  readonly style?: StyleProp<ViewStyle>
}

export function AppButton({
  accessibilityLabel,
  disabled = false,
  label,
  leading,
  loading = false,
  onPress,
  style,
  testID,
  variant = 'primary',
}: AppButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => { void onPress() }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !disabled && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      testID={testID}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? color.surface : variant === 'danger' ? color.danger : color.brand} size="small" />
        : leading !== undefined && <View style={styles.leading}>{leading}</View>}
      <Text style={[styles.label, variant === 'primary' && styles.primaryLabel, variant === 'danger' && styles.dangerLabel]}>
        {label}
      </Text>
    </Pressable>
  )
}

const { color, radius, spacing, touchTarget } = mobileTheme

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: color.brand, borderColor: color.brand, elevation: 1, shadowColor: color.brand, shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.18, shadowRadius: 7 },
  secondary: { backgroundColor: color.surface, borderColor: color.borderStrong },
  danger: { backgroundColor: color.surface, borderColor: color.danger },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.42 },
  leading: { marginRight: spacing.xs },
  label: { color: color.text, fontSize: 15, fontWeight: '700' },
  primaryLabel: { color: color.surface },
  dangerLabel: { color: color.danger },
})
