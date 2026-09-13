import type { ApprovalOutcome, CommandType } from '@harndock/sync-protocol'
import { useEffect, useRef, useState } from 'react'
import type { SessionProjection } from '../../sync/projection'
import { isTerminalCommandStatus } from '../../sync/command-state'
import {
  loadAccessToken,
  loadSessionCommands,
  loadSessionProjections,
  openSyncDatabase,
  saveCommandRecord,
  type StoredCommandState,
} from '../../services/storage'
import { createCommandId, GatewayApi, GatewayApiError } from '../../services/transport'
import { isAuthenticationFailure } from '../connection/presentation'
import { createApprovalSubmissionLock, type ApprovalAttempt } from './approval-model'
import { isSameConversationProjection } from './projection-equivalence'
import { nextCommandAttempt, type CommandOperationState } from './composer-model'
import { commandStatusLabel, delay, formatCommandError, formatCommandReason } from './presentation'

type CommandPayload = {
  readonly contentBlocks?: readonly { type: 'text'; text: string }[]
  readonly approvalId?: string
  readonly outcome?: ApprovalOutcome
}

interface CommandRequest {
  readonly commandId: string
  readonly commandType: CommandType
  readonly baseSeq: number
  readonly expiresAt: string
  readonly payload: CommandPayload
}

const IDLE_OPERATION: CommandOperationState = { kind: 'idle', retry: 'none' }

export interface ConversationSessionController {
  readonly projection: SessionProjection | undefined
  readonly prompt: string
  readonly command: StoredCommandState | undefined
  readonly message: string
  readonly busy: boolean
  readonly controlsUnavailable: boolean
  readonly operation: CommandOperationState
  readonly canRetry: boolean
  readonly commandAcknowledged: boolean
  readonly approvalAttempt: ApprovalAttempt | undefined
  readonly setPrompt: (value: string) => void
  readonly submitPrompt: () => Promise<void>
  readonly cancel: () => Promise<void>
  readonly retry: () => Promise<void>
  readonly dismissCommandStatus: () => void
  readonly respondToApproval: (outcome: ApprovalOutcome) => Promise<void>
}

export function useConversationSession(
  sessionId: string,
  gatewayUrl: string,
  onAuthenticationRequired: (error?: unknown) => void,
): ConversationSessionController {
  const [projection, setProjection] = useState<SessionProjection | undefined>()
  const [prompt, setPrompt] = useState('')
  const [command, setCommand] = useState<StoredCommandState | undefined>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<CommandOperationState>(IDLE_OPERATION)
  const [acknowledgedCommandId, setAcknowledgedCommandId] = useState<string | undefined>()
  const [approvalAttempt, setApprovalAttempt] = useState<ApprovalAttempt | undefined>()
  const mounted = useRef(true)
  const pollGeneration = useRef(0)
  const retryRequestRef = useRef<CommandRequest | undefined>(undefined)
  const retryReusesIdRef = useRef(false)
  const approvalLockRef = useRef(createApprovalSubmissionLock())

  useEffect(() => {
    mounted.current = true
    const generation = ++pollGeneration.current
    setProjection(undefined)
    setCommand(undefined)
    setPrompt('')
    setMessage('')
    setBusy(false)
    setOperation(IDLE_OPERATION)
    setAcknowledgedCommandId(undefined)
    setApprovalAttempt(undefined)
    retryRequestRef.current = undefined
    retryReusesIdRef.current = false
    approvalLockRef.current.clear()
    const database = openSyncDatabase()
    const refresh = (): void => {
      const current = loadSessionProjections(database).find(item => item.sessionId === sessionId)
      if (current !== undefined) {
        setProjection(previous => isSameConversationProjection(previous, current) ? previous : current)
      }
    }
    refresh()
    const cachedCommand = loadSessionCommands(database, sessionId)[0]
    if (cachedCommand !== undefined) {
      setCommand(cachedCommand)
      if (isTerminalCommandStatus(cachedCommand.status)) showCommandResult(cachedCommand)
      else void resumeCommand(cachedCommand, database, generation)
    }
    const timer = setInterval(refresh, 1_000)
    return () => {
      mounted.current = false
      pollGeneration.current += 1
      clearInterval(timer)
    }
  }, [sessionId])

  useEffect(() => {
    if (approvalAttempt === undefined || projection === undefined) return
    if (projection.unresolvedApproval?.approvalId === approvalAttempt.approvalId) return
    approvalLockRef.current.release(approvalAttempt.approvalId)
    setApprovalAttempt(undefined)
    if (operation.commandType === 'approval.respond') setOperation(IDLE_OPERATION)
    if (retryRequestRef.current?.payload.approvalId === approvalAttempt.approvalId) {
      retryRequestRef.current = undefined
      retryReusesIdRef.current = false
    }
  }, [approvalAttempt, projection?.unresolvedApproval?.approvalId])

  async function runCommand(request: CommandRequest): Promise<boolean> {
    if (busy && request.commandType !== 'session.cancel') return false
    if (projection === undefined) {
      setMessage('本地尚未收到该 Session 的快照，请稍后重试。')
      return false
    }
    if (!projection.historyLoaded) {
      setMessage('历史仍在补发，请等待 Session 状态追平后再发送。')
      return false
    }
    if (request.commandType === 'approval.respond'
      && request.payload.approvalId !== undefined
      && request.payload.outcome !== undefined) {
      setApprovalAttempt({
        approvalId: request.payload.approvalId,
        commandId: request.commandId,
        outcome: request.payload.outcome,
      })
    }
    retryRequestRef.current = request
    if (projection.status === 'offline') {
      retryReusesIdRef.current = false
      setOperation({
        kind: 'offline',
        commandType: request.commandType,
        detail: 'PC Runtime 离线，命令没有提交。',
        retry: 'submit',
      })
      return false
    }
    setBusy(true)
    const generation = ++pollGeneration.current
    setMessage('')
    setOperation({ kind: 'submitting', commandType: request.commandType, retry: 'none' })
    let acceptedByGateway = false
    try {
      const token = await loadAccessToken()
      if (token === null) throw new Error('本机 access token 不可用')
      const api = new GatewayApi({ baseUrl: gatewayUrl, accessToken: token })
      const database = openSyncDatabase()
      const accepted = await api.submitCommand(sessionId, {
        commandId: request.commandId,
        baseSeq: request.baseSeq,
        commandType: request.commandType,
        expiresAt: request.expiresAt,
        payload: request.payload,
      })
      acceptedByGateway = true
      saveCommandRecord(database, accepted)
      if (mounted.current) {
        setCommand(accepted)
        setAcknowledgedCommandId(undefined)
        setOperation(IDLE_OPERATION)
        if (request.commandType === 'session.prompt') setPrompt('')
      }
      const current = await watchCommand(api, accepted, database, generation)
      if (mounted.current && pollGeneration.current === generation) showCommandResult(current)
    } catch (error) {
      if (!mounted.current || pollGeneration.current !== generation) return false
      if (isAuthenticationFailure(error)) {
        setOperation(IDLE_OPERATION)
        onAuthenticationRequired(error)
      } else if (acceptedByGateway) {
        setOperation({
          kind: 'status-error',
          commandType: request.commandType,
          detail: '命令已被 Gateway 接受，但状态查询失败；刷新只会查询原命令。',
          retry: 'status',
        })
      } else if (error instanceof GatewayApiError && error.code === 'stale_state') {
        const expectedSeq = typeof error.details?.currentSeq === 'number' ? error.details.currentSeq : undefined
        retryReusesIdRef.current = false
        setOperation({ kind: 'stale', commandType: request.commandType, expectedSeq, retry: 'submit' })
      } else if (error instanceof GatewayApiError && error.code === 'approval_already_decided') {
        retryRequestRef.current = undefined
        retryReusesIdRef.current = false
        setOperation({
          kind: 'approval-decided',
          commandType: 'approval.respond',
          detail: '该审批已由其他设备处理。',
          retry: 'none',
        })
      } else if (error instanceof GatewayApiError) {
        retryReusesIdRef.current = false
        const detail = formatCommandError(error)
        setOperation(error.code === 'runtime_offline'
          ? { kind: 'offline', commandType: request.commandType, detail, retry: 'submit' }
          : { kind: 'submission-error', commandType: request.commandType, detail, retry: 'submit' })
      } else {
        retryReusesIdRef.current = true
        setOperation({
          kind: 'submission-error',
          commandType: request.commandType,
          detail: '无法确认 Gateway 是否收到命令；重试将复用同一命令 ID。',
          retry: 'submit',
        })
      }
    } finally {
      if (mounted.current && pollGeneration.current === generation) setBusy(false)
    }
    return acceptedByGateway
  }

  async function resumeCommand(
    cached: StoredCommandState,
    database: ReturnType<typeof openSyncDatabase>,
    generation: number,
  ): Promise<void> {
    setBusy(true)
    setMessage('')
    setOperation({ kind: 'recovering', commandType: cached.commandType, retry: 'none' })
    try {
      const token = await loadAccessToken()
      if (token === null) throw new Error('本机 access token 不可用')
      const api = new GatewayApi({ baseUrl: gatewayUrl, accessToken: token })
      const refreshed = await api.getCommand(cached.commandId)
      saveCommandRecord(database, refreshed)
      if (mounted.current && pollGeneration.current === generation) setCommand(refreshed)
      const current = await watchCommand(api, refreshed, database, generation)
      if (mounted.current && pollGeneration.current === generation) showCommandResult(current)
    } catch (error) {
      if (mounted.current && pollGeneration.current === generation) {
        if (isAuthenticationFailure(error)) {
          onAuthenticationRequired(error)
        } else {
          setOperation({
            kind: 'status-error',
            commandType: cached.commandType,
            detail: error instanceof GatewayApiError
              ? formatCommandError(error, '无法恢复命令状态')
              : '无法恢复命令状态；刷新只会查询原命令，不会重新执行。',
            retry: 'status',
          })
        }
      }
    } finally {
      if (mounted.current && pollGeneration.current === generation) setBusy(false)
    }
  }

  async function watchCommand(
    api: GatewayApi,
    initial: StoredCommandState,
    database: ReturnType<typeof openSyncDatabase>,
    generation: number,
  ): Promise<StoredCommandState> {
    let current = initial
    saveCommandRecord(database, current)
    for (let attempt = 0; attempt < 40 && !isTerminalCommandStatus(current.status); attempt += 1) {
      await delay(750)
      if (!mounted.current || pollGeneration.current !== generation) return current
      current = await api.getCommand(initial.commandId)
      saveCommandRecord(database, current)
      if (mounted.current && pollGeneration.current === generation) {
        setCommand(current)
        setOperation(IDLE_OPERATION)
      }
    }
    return current
  }

  function showCommandResult(current: StoredCommandState): void {
    if (isTerminalCommandStatus(current.status)) {
      if (current.commandType === 'approval.respond' && current.reason === 'approval_already_decided') {
        retryRequestRef.current = undefined
        retryReusesIdRef.current = false
        setMessage('')
        setOperation({
          kind: 'approval-decided',
          commandType: 'approval.respond',
          detail: '该审批已由其他设备处理。',
          retry: 'none',
        })
        return
      }
      setOperation(IDLE_OPERATION)
      if (current.status === 'completed') {
        retryRequestRef.current = undefined
        setMessage('')
      } else if (current.status === 'unknown') {
        setMessage('')
      } else {
        setMessage(current.commandType === 'approval.respond'
          ? ''
          : `命令结束：${commandStatusLabel(current.status)}${formatCommandReason(current.reason)}`)
      }
    } else {
      setMessage('')
      setOperation({
        kind: 'status-error',
        commandType: current.commandType,
        detail: '命令仍未进入终态；刷新只查询原命令，不会重新执行。',
        retry: 'status',
      })
    }
  }

  const submitPrompt = async (): Promise<void> => {
    const content = prompt.trim()
    if (content.length === 0 || projection === undefined) return
    await runCommand(createRequest('session.prompt', {
      contentBlocks: [{ type: 'text', text: content }],
    }, projection.lastSeq))
  }

  const respondToApproval = async (outcome: ApprovalOutcome): Promise<void> => {
    const currentProjection = projection
    const approvalId = currentProjection?.unresolvedApproval?.approvalId
    if (approvalId == null || currentProjection === undefined) {
      setMessage('该审批已不再待处理，请查看最新 Session 事件。')
      return
    }
    if (!currentProjection.historyLoaded || currentProjection.status === 'offline' || !approvalLockRef.current.claim(approvalId)) return
    const request = createRequest('approval.respond', { approvalId, outcome }, currentProjection.lastSeq)
    setApprovalAttempt({ approvalId, commandId: request.commandId, outcome })
    await runCommand(request)
  }

  const retry = async (): Promise<void> => {
    if (operation.retry === 'status' && command !== undefined) {
      const database = openSyncDatabase()
      const generation = ++pollGeneration.current
      await resumeCommand(command, database, generation)
      return
    }
    const previous = retryRequestRef.current
    if (previous === undefined || projection === undefined) return
    if (operation.kind === 'stale' && operation.expectedSeq !== undefined && projection.lastSeq < operation.expectedSeq) return
    const now = Date.now()
    const nextAttempt = nextCommandAttempt(previous, {
      reuseIdentity: retryReusesIdRef.current,
      currentSeq: projection.lastSeq,
      now,
      createId: createCommandId,
    })
    retryReusesIdRef.current = false
    await runCommand(nextAttempt)
  }

  const canRetry = operation.retry === 'status'
    ? command !== undefined
    : retryRequestRef.current !== undefined && (operation.retry === 'submit'
      || command?.status === 'unknown' || command?.status === 'rejected' || command?.status === 'expired')

  return {
    approvalAttempt,
    busy,
    cancel: () => projection === undefined
      ? Promise.resolve()
      : runCommand(createRequest('session.cancel', {}, projection.lastSeq)).then(() => undefined),
    canRetry,
    command,
    commandAcknowledged: command !== undefined && command.commandId === acknowledgedCommandId,
    controlsUnavailable: projection === undefined || projection.status === 'offline' || !projection.historyLoaded,
    dismissCommandStatus: () => {
      setOperation(IDLE_OPERATION)
      setMessage('')
      setAcknowledgedCommandId(command?.commandId)
      retryRequestRef.current = undefined
      retryReusesIdRef.current = false
    },
    message,
    operation,
    projection,
    prompt,
    respondToApproval,
    retry,
    setPrompt,
    submitPrompt,
  }
}

function createRequest(commandType: CommandType, payload: CommandPayload, baseSeq: number): CommandRequest {
  return {
    commandId: createCommandId(),
    commandType,
    baseSeq,
    expiresAt: commandExpiry(),
    payload,
  }
}

function commandExpiry(): string {
  return new Date(Date.now() + 120_000).toISOString()
}
