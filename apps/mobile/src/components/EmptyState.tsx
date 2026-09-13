import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { mobileTheme } from '../theme'

export interface EmptyStateProps {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
}

export function EmptyState({ action, description, title }: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description !== undefined && <Text style={styles.description}>{description}</Text>}
      {action !== undefined && <View style={styles.action}>{action}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: mobileTheme.spacing.lg, paddingVertical: mobileTheme.spacing.xl },
  title: { color: mobileTheme.color.text, fontSize: mobileTheme.typography.subheading, fontWeight: '600', textAlign: 'center' },
  description: { color: mobileTheme.color.textSecondary, lineHeight: 21, marginTop: mobileTheme.spacing.xs, textAlign: 'center' },
  action: { marginTop: mobileTheme.spacing.md },
})
