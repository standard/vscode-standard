import * as vscode from 'vscode'

import { getDocUri, testDiagnostics } from '../helper'

test('legacy', async () => {
  const noLintErrorsUri = getDocUri('legacy', 'no-lint-errors.js')
  const lintErrorsUri = getDocUri('legacy', 'lint-errors.js')
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
      message: 'Extra semicolon. (semi)',
      range: new vscode.Range(
        new vscode.Position(0, 28),
        new vscode.Position(0, 29)
      ),
      severity: vscode.DiagnosticSeverity.Error
    }
  ])
})
