const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{16,200}$/

export function parseMobileInstallationId(value: unknown): string | undefined {
  return typeof value === 'string' && INSTALLATION_ID_PATTERN.test(value) ? value : undefined
}

export function mobileInstallationId(uuid: string): string {
  const installationId = `mobile:${uuid}`
  if (parseMobileInstallationId(installationId) === undefined) {
    throw new Error('Generated Mobile installation ID is invalid')
  }
  return installationId
}
