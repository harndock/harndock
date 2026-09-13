import { useEffect, useState } from 'react'
import {
  clearAccessToken,
  clearGatewayOrigin,
  loadGatewayOrigin,
  loadLegacyAccessToken,
  saveAccessToken,
  saveGatewayOrigin,
} from '../../services/storage'
import { allowedGatewayProtocols, defaultGatewayUrl, normalizeGatewayOrigin } from '../../sync/gateway-url'
import { resolveStoredGatewayConfig, shouldClearTokenForOriginChange } from './gatewayOriginState'

export interface ConnectionSetupController {
  readonly gatewayUrl: string
  readonly accessToken: string
  readonly message: string
  readonly restoring: boolean
  readonly setGatewayUrl: (value: string) => void
  readonly setAccessToken: (value: string) => void
  readonly connect: () => Promise<string | undefined>
  readonly clearCredentials: () => Promise<void>
}

export function useConnectionSetup(): ConnectionSetupController {
  const [gatewayUrl, setGatewayUrl] = useState(defaultGatewayUrl)
  const [credentialGatewayOrigin, setCredentialGatewayOrigin] = useState<string | undefined>()
  const [accessToken, setAccessToken] = useState('')
  const [message, setMessage] = useState('正在恢复 Gateway 配置…')
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let active = true
    void Promise.all([loadGatewayOrigin(), loadLegacyAccessToken()])
      .then(async ([storedOrigin, token]) => {
        if (!active) return
        const restored = resolveStoredGatewayConfig(
          storedOrigin,
          token,
          defaultGatewayUrl,
          allowedGatewayProtocols,
        )
        if (restored.storedOriginRejected) {
          await Promise.all([clearGatewayOrigin(), clearAccessToken()])
          if (!active) return
          setAccessToken('')
          setGatewayUrl(restored.gatewayOrigin)
          setMessage('已忽略不符合当前安全策略的 Gateway 配置，请重新连接。')
          return
        }
        setGatewayUrl(restored.gatewayOrigin)
        setCredentialGatewayOrigin(restored.credentialGatewayOrigin)
        if (restored.accessToken !== null) setAccessToken(restored.accessToken)
        setMessage(restored.persistedGatewayOrigin !== undefined
          ? '已从系统安全存储恢复 Gateway 配置'
          : restored.accessToken !== null
            ? '已恢复旧版本机凭据；修改 Gateway 将要求重新输入凭据。'
            : '请输入外部身份服务签发的短期 access token')
      })
      .catch(() => {
        if (active) setMessage('无法读取系统安全存储，请稍后重试。')
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => { active = false }
  }, [])

  const updateGatewayUrl = (value: string): void => {
    setGatewayUrl(value)
    if (!shouldClearTokenForOriginChange(
      value,
      credentialGatewayOrigin,
      accessToken.length > 0,
      allowedGatewayProtocols,
    )) return
    setAccessToken('')
    setMessage('Gateway 地址已更改，旧凭据已清除；请为新 Gateway 重新输入凭据。')
    void clearAccessToken().catch(() => {
      setMessage('Gateway 地址已更改，但系统安全存储清理失败；请重启后重试。')
    })
  }

  const connect = async (): Promise<string | undefined> => {
    if (restoring) return undefined
    const normalizedOrigin = normalizeGatewayOrigin(gatewayUrl, allowedGatewayProtocols)
    if (normalizedOrigin === undefined) {
      const protocols = allowedGatewayProtocols.join(', ')
      setMessage(`Gateway 必须是当前构建允许的 origin（当前协议：${protocols}；开发 HTTP 仅允许本机或模拟器宿主地址）`)
      return undefined
    }
    if (accessToken.trim().length < 16) {
      setMessage('请输入有效的短期 access token')
      return undefined
    }
    try {
      await Promise.all([
        saveGatewayOrigin(normalizedOrigin),
        saveAccessToken(accessToken.trim()),
      ])
    } catch {
      setMessage('无法保存 Gateway 配置或凭据，请检查系统安全存储。')
      return undefined
    }
    setGatewayUrl(normalizedOrigin)
    setCredentialGatewayOrigin(normalizedOrigin)
    setMessage('Gateway 配置和凭据已保存到系统安全存储')
    return normalizedOrigin
  }

  const clearCredentials = async (): Promise<void> => {
    await clearAccessToken()
    setAccessToken('')
    setMessage('已清除本机 access token')
  }

  return {
    accessToken,
    clearCredentials,
    connect,
    gatewayUrl,
    message,
    restoring,
    setAccessToken,
    setGatewayUrl: updateGatewayUrl,
  }
}
