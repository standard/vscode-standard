import { NotificationType } from 'vscode-languageclient'

export enum Status {
  ok = 1,
  warn = 2,
  error = 3
}

export interface StatusParams {
  state: Status
}

export const type = new NotificationType<StatusParams>('standard/status')
