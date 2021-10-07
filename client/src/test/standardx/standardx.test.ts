import * as vscode from 'vscode'

import { getDocUri, testDiagnostics } from '../helper'

test('standardx', async () => {
  const noLintErrorsUri = getDocUri('standardx', 'no-lint-errors.js')
  const lintErrorsUri = getDocUri('standardx', 'lint-errors.js')
  await testDiagnostics(noLintErrorsUri, [])
  await testDiagnostics(lintErrorsUri, [
    {
      message: 'Strings must use singlequote. (quotes)',
      range: new vscode.Range(
        new vscode.Position(0, 12),
        new vscode.Position(0, 27)
      ),
      severity: vscode.DiagnosticSeverity.Error
    },
    {
      message: 'Missing semicolon. (semi)',
      range: new vscode.Range(
        new vscode.Position(0, 28),
        new vscode.Position(1, 0)
      ),
      severity: vscode.DiagnosticSeverity.Error
    }
  ])
})
