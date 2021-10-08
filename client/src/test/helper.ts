import * as vscode from 'vscode'
import * as path from 'path'
import * as assert from 'assert'

export let doc: vscode.TextDocument
export let editor: vscode.TextEditor
export let documentEol: string
export let platformEol: string

/**
 * Activates the extension
 */
export async function activate (docUri: vscode.Uri): Promise<void> {
  const ext = vscode.extensions.getExtension('standard.vscode-standard')
  await ext?.activate()
  try {
    doc = await vscode.workspace.openTextDocument(docUri)
    editor = await vscode.window.showTextDocument(doc)
    await sleep(5000)
  } catch (error) {
    console.error(error)
  }
}

export async function sleep (ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

export const getDocUri = (folder: string, file: string): vscode.Uri => {
  return vscode.Uri.file(path.resolve(__dirname, '..', '..', 'testFixture', folder, file))
}

export async function testDiagnostics (
  docUri: vscode.Uri,
  expectedDiagnostics: vscode.Diagnostic[]
): Promise<void> {
  await activate(docUri)
  const actualDiagnostics = vscode.languages.getDiagnostics(docUri)
  assert.strictEqual(actualDiagnostics.length, expectedDiagnostics.length)
  expectedDiagnostics.forEach((expectedDiagnostic, index) => {
    const actualDiagnostic = actualDiagnostics[index]
    assert.strictEqual(actualDiagnostic.message, expectedDiagnostic.message)
    assert.deepEqual(actualDiagnostic.range, expectedDiagnostic.range)
    assert.strictEqual(actualDiagnostic.severity, expectedDiagnostic.severity)
  })
}
