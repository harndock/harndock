import { GatewayApiError } from '../../services/transport'

export { commandStatusLabel, sessionStatusLabel } from '../../sync/status-labels'
export { describeEvent } from '../../sync/event-summary'

export function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function formatCommandError(error: GatewayApiError, prefix = 'Gateway 拒绝命令'): string {
  if (error.status === 401 || error.code === 'authentication_required') {
    return '登录已失效，请返回连接设置重新登录。'
  }
  if (error.status === 403 || error.code === 'forbidden' || error.code === 'insufficient_scope') {
    return '无权限，当前凭据不能控制此 Session。'
  }
  if (error.code === 'runtime_offline') return 'PC 离线，不能发送控制命令。'
  if (error.code === 'device_revoked') return '设备已撤销，请重新登录或配对。'
  if (error.code === 'approval_already_decided') return '该审批已由其他设备处理。'
  return `${prefix}：${error.code ?? error.message}`
}

export function formatCommandReason(reason: string | undefined): string {
  if (reason === undefined) return ''
  if (reason === 'runtime_offline') return '（PC 离线）'
  if (reason === 'device_revoked') return '（设备已撤销）'
  if (reason === 'approval_already_decided') return '（已由其他设备处理）'
  return `（${reason}）`
}
