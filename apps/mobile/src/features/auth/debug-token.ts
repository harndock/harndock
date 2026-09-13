export function resolveManualTokenEntryEnabled(isDevelopment: boolean, configured: string | undefined): boolean {
  return isDevelopment && configured?.trim().toLowerCase() === 'true'
}

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

export const manualTokenEntryEnabled = resolveManualTokenEntryEnabled(
  isDevelopmentBuild,
  process.env.EXPO_PUBLIC_MOBILE_DEBUG_TOKEN,
)
