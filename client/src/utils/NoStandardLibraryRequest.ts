import { RequestType, TextDocumentIdentifier } from 'vscode-languageclient'

interface NoStandardLibraryParams {
  source: TextDocumentIdentifier
}

export const type = new RequestType<NoStandardLibraryParams, {}, void>(
  'standard/noLibrary'
)
