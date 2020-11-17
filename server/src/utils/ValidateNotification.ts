import { NotificationType } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'

export const type: NotificationType<TextDocument, void> = new NotificationType<
TextDocument,
void
>('standard/validate')
