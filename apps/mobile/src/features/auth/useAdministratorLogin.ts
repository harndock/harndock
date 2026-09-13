import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import {
  loadGatewayOrigin,
  loadOrCreateMobileInstallationId,
  saveGatewayOrigin,
  saveMobileSession,
} from '../../services/storage'
import { GatewayAuthApi } from '../../sync/gateway-auth-api'
import { defaultGatewayUrl, normalizeGatewayOrigin } from '../../sync/gateway-url'
import type { MobileAuthSession } from '../../sync/mobile-session'
import { loginAdministrator } from './administrator-login'

export interface AdministratorLoginController {
  readonly gatewayOrigin: string
  readonly username: string
  readonly password: string
  readonly message: string
  readonly messageTone: 'info' | 'warning' | 'danger' | 'success'
  readonly busy: boolean
  readonly restoring: boolean
  readonly setGatewayOrigin: (value: string) => void
  readonly setUsername: (value: string) => void
  readonly setPassword: (value: string) => void
  readonly submit: () => Promise<MobileAuthSession | undefined>
}

const loginServices = {
  authApi: (gatewayOrigin: string) => new GatewayAuthApi({ baseUrl: gatewayOrigin }),
  loadInstallationId: loadOrCreateMobileInstallationId,
  saveGatewayOrigin,
  saveSession: saveMobileSession,
}

export function useAdministratorLogin(): AdministratorLoginController {
  const [gatewayOrigin, setGatewayOriginState] = useState(defaultGatewayUrl)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('正在恢复 Gateway 地址…')
  const [messageTone, setMessageTone] = useState<AdministratorLoginController['messageTone']>('info')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let active = true
    void loadGatewayOrigin()
      .then(storedOrigin => {
        if (!active) return
        const restored = storedOrigin === null ? undefined : normalizeGatewayOrigin(storedOrigin)
        setGatewayOriginState(restored ?? defaultGatewayUrl)
        setMessage(storedOrigin !== null && restored === undefined
          ? '已忽略不符合当前安全策略的 Gateway 地址，请重新确认。'
          : '请输入 Gateway 管理员账号和密码。')
        setMessageTone(storedOrigin !== null && restored === undefined ? 'warning' : 'info')
      })
      .catch(() => {
        if (!active) return
        setMessage('无法读取系统安全存储，请稍后重试。')
        setMessageTone('danger')
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => { active = false }
  }, [])

  const updateGatewayOrigin = (value: string): void => {
    setGatewayOriginState(value)
    if (password.length === 0) return
    setPassword('')
    setMessage('Gateway 地址已更改，请重新输入密码。')
    setMessageTone('warning')
  }

  const submit = async (): Promise<MobileAuthSession | undefined> => {
    if (busy || restoring) return undefined
    setBusy(true)
    setMessage('正在登录并建立安全会话…')
    setMessageTone('info')
    try {
      const result = await loginAdministrator({
        deviceName: 'Harndock Mobile',
        gatewayOrigin,
        password,
        platform: Platform.OS,
        username,
      }, loginServices)
      if (!result.ok) {
        setMessage(result.message)
        setMessageTone('danger')
        return undefined
      }
      setPassword('')
      setMessage('登录成功，正在进入 Session。')
      setMessageTone('success')
      return result.session
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    gatewayOrigin,
    message,
    messageTone,
    password,
    restoring,
    setGatewayOrigin: updateGatewayOrigin,
    setPassword,
    setUsername,
    submit,
    username,
  }
}
