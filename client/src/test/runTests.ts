import * as path from 'path'
import { runTests } from '@vscode/test-electron'
import { linterValues } from '../linterValues'

async function main (): Promise<void> {
  for (const linter of linterValues) {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../')
    const extensionTestsPath = path.resolve(__dirname, linter, 'index')
    const testWorkspace = path.resolve(__dirname, '../../testFixture', linter)
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, '--disable-extensions']
    })
  }
}

main().catch(err => {
  console.error(err)
  console.error('Failed to run tests')
  process.exit(1)
})
