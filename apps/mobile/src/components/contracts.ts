import type { ReactNode } from 'react'
import type { ApprovalOutcome } from '@harndock/sync-protocol'

export interface BottomSheetContract {
  readonly open: boolean
  readonly title: string
  readonly onDismiss: () => void
  readonly children: ReactNode
}

export interface ComposerContract {
  readonly value: string
  readonly disabled: boolean
  readonly submitting: boolean
  readonly onChange: (value: string) => void
  readonly onSubmit: () => void | Promise<void>
}

export interface ApprovalPanelContract {
  readonly approvalId: string
  readonly toolName: string
  readonly disabled: boolean
  readonly submitting: boolean
  readonly onRespond: (outcome: ApprovalOutcome) => void | Promise<void>
}
