import * as vscode from 'vscode'

import { getDocUri, testDiagnostics } from '../helper'

test('semistandard', async () => {
  const noLintErrorsUri = getDocUri('semistandard', 'no-lint-errors.js')
  const lintErrorsUri = getDocUri('semistandard', 'lint-errors.js')
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
