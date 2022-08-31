import * as vscode from 'vscode'

import { getDocUri, testDiagnostics } from '../helper'

const expectedDiagnosticsLintErrors: vscode.Diagnostic[] = [
  {
    message: 'Strings must use singlequote. (quotes)',
    range: new vscode.Range(
      new vscode.Position(0, 12),
      new vscode.Position(0, 27)
    ),
    severity: vscode.DiagnosticSeverity.Error
  },
  {
    message: 'Extra semicolon. (semi)',
    range: new vscode.Range(
      new vscode.Position(0, 28),
      new vscode.Position(0, 29)
    ),
    severity: vscode.DiagnosticSeverity.Error
  }
]

test('standard', async () => {
  const noLintErrorsUri = getDocUri('standard', 'no-lint-errors.js')
  const lintErrorsUri = getDocUri('standard', 'lint-errors.js')
  await testDiagnostics(noLintErrorsUri, [])
  await testDiagnostics(lintErrorsUri, expectedDiagnosticsLintErrors)
})

test('standard with brackets in filename and folders', async () => {
  const errorsFilenameBracketsUri = getDocUri('standard', '[errors].js')
  const errorsFolderBracketsUri = getDocUri('standard', '[errors]/errors.js')
  const errorsFilenameAndFolderBracketsUri = getDocUri('standard', '[errors]/[errors].js')
  const errorsFilenameAndFolderDeepBracketsUri = getDocUri('standard', '[errors]/[deep]/[errors].js')
  await testDiagnostics(errorsFilenameBracketsUri, expectedDiagnosticsLintErrors)
  await testDiagnostics(errorsFolderBracketsUri, expectedDiagnosticsLintErrors)
  await testDiagnostics(errorsFilenameAndFolderBracketsUri, expectedDiagnosticsLintErrors)
  await testDiagnostics(errorsFilenameAndFolderDeepBracketsUri, expectedDiagnosticsLintErrors)
})
