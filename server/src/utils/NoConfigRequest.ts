import { RequestType, TextDocumentIdentifier } from 'vscode-languageserver'

interface NoConfigParams {
  message: string
  document: TextDocumentIdentifier
}

export const type = new RequestType<NoConfigParams, {}, void, void>(
  'standard/noConfig'
)
