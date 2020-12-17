import { RequestType, TextDocumentIdentifier } from 'vscode-languageserver'

interface NoStandardLibraryParams {
  source: TextDocumentIdentifier
}

export const type = new RequestType<NoStandardLibraryParams, {}, void>(
  'standard/noLibrary'
)
