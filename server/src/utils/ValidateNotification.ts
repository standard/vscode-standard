import { NotificationType } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'

export const type: NotificationType<TextDocument> = new NotificationType<TextDocument>(
  'standard/validate'
)
