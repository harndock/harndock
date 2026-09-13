import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { SessionProjection } from '../sync/projection'
import { mobileTheme } from '../theme'
import { groupSessionDirectory } from '../features/sessions/directory-model'
import { AppButton } from './AppButton'
import { IconButton } from './IconButton'
import { SessionRow } from './SessionRow'
import { useI18n } from '../i18n'

export interface SessionDrawerProps {
  readonly open: boolean
  readonly sessions: readonly SessionProjection[]
  readonly activeSessionId?: string
  readonly onDismiss: () => void
  readonly onOpenDirectory: () => void
  readonly onSelectSession: (session: SessionProjection) => void
}

export function SessionDrawer({
  activeSessionId,
  onDismiss,
  onOpenDirectory,
  onSelectSession,
  open,
  sessions,
}: SessionDrawerProps): React.JSX.Element {
  const { t } = useI18n()
  const sections = groupSessionDirectory(sessions)
  const orderedSessions = [...sections.attention, ...sections.recent]
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View style={styles.overlay}>
        <SafeAreaView accessibilityViewIsModal style={styles.drawer}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{t('drawer.title')}</Text>
              <Text style={styles.subtitle}>{t('drawer.subtitle')}</Text>
            </View>
            <IconButton accessibilityLabel={t('drawer.close')} icon={<Text style={styles.close}>×</Text>} onPress={onDismiss} />
          </View>
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {orderedSessions.length === 0
              ? <Text style={styles.empty}>{t('drawer.empty')}</Text>
              : (
                <>
                  {sections.attention.length > 0 && (
                    <View style={styles.section}>
                      <View style={styles.sectionHeading}>
                        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('sessions.attention')}</Text>
                        <Text style={styles.sectionCount}>{sections.attention.length}</Text>
                      </View>
                      {sections.attention.map(session => (
                        <SessionRow
                          active={session.sessionId === activeSessionId}
                          compact
                          key={session.sessionId}
                          onPress={() => onSelectSession(session)}
                          session={session}
                        />
                      ))}
                    </View>
                  )}
                  {sections.recent.length > 0 && (
                    <View style={styles.section}>
                      <View style={styles.sectionHeading}>
                        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('sessions.recent')}</Text>
                        <Text style={styles.sectionCount}>{sections.recent.length}</Text>
                      </View>
                      {sections.recent.map(session => (
                        <SessionRow
                          active={session.sessionId === activeSessionId}
                          compact
                          key={session.sessionId}
                          onPress={() => onSelectSession(session)}
                          session={session}
                        />
                      ))}
                    </View>
                  )}
                </>
              )}
          </ScrollView>
          <View style={styles.footer}>
            <AppButton label={t('drawer.openDirectory')} onPress={onOpenDirectory} variant="secondary" />
          </View>
        </SafeAreaView>
        <Pressable
          accessibilityLabel={t('drawer.close')}
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.scrim}
        />
      </View>
    </Modal>
  )
}

const { color, spacing, typography } = mobileTheme
const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  drawer: { backgroundColor: color.canvas, elevation: 10, maxWidth: 360, shadowColor: color.text, shadowOffset: { height: 0, width: 8 }, shadowOpacity: 0.16, shadowRadius: 20, width: '86%' },
  scrim: { backgroundColor: color.overlay, flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: color.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 76,
    paddingHorizontal: spacing.md,
  },
  headerCopy: { flex: 1 },
  title: { color: color.text, fontSize: typography.heading, fontWeight: '700' },
  subtitle: { color: color.textSecondary, fontSize: typography.caption, marginTop: 2 },
  close: { color: color.textSecondary, fontSize: 28, lineHeight: 30 },
  list: { gap: spacing.md, paddingBottom: spacing.md },
  section: { gap: spacing.xs },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  sectionTitle: { color: color.textSecondary, fontSize: typography.caption, fontWeight: '700' },
  sectionCount: { color: color.textTertiary, fontSize: typography.caption, fontWeight: '700' },
  empty: { color: color.textSecondary, padding: spacing.lg, textAlign: 'center' },
  footer: { borderTopColor: color.border, borderTopWidth: 1, padding: spacing.md },
})
