/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as fs from 'fs'
import * as path from 'path'
import {
  CancellationToken,
  CodeActionRequest,
  Command,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  DidChangeWorkspaceFoldersNotification,
  ErrorCodes,
  ExecuteCommandRequest,
  Files,
  IConnection,
  IPCMessageReader,
  IPCMessageWriter,
  NotificationHandler,
  NotificationType,
  ProposedFeatures,
  Range,
  RequestHandler,
  RequestType,
  ResponseError,
  TextDocumentIdentifier,
  TextDocuments,
  TextDocumentSaveReason,
  TextDocumentSyncKind,
  TextEdit,
  VersionedTextDocumentIdentifier
} from 'vscode-languageserver'
import {
  WorkspaceChange
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import * as deglob from 'deglob'
import * as async from 'async'

type LinterValues = 'standard' | 'semistandard' | 'standardx' | 'ts-standard'
type LinterNameValues =
  | 'JavaScript Standard Style'
  | 'JavaScript Semi-Standard Style'
  | 'JavaScript Standard Style with custom tweaks'
  | 'TypeScript Standard Style'

namespace Is {
  const toString = Object.prototype.toString

  export function boolean (value: any): value is boolean {
    return value === true || value === false
  }

  export function string (value: any): value is string {
    return toString.call(value) === '[object String]'
  }
}

namespace CommandIds {
  export const applySingleFix: string = 'standard.applySingleFix'
  export const applySameFixes: string = 'standard.applySameFixes'
  export const applyAllFixes: string = 'standard.applyAllFixes'
  export const applyAutoFix: string = 'standard.applyAutoFix'
}

interface StandardError extends Error {
  messageTemplate?: string
  messageData?: {
    pluginName?: string
  }
}

enum Status {
  ok = 1,
  warn = 2,
  error = 3
}

interface StatusParams {
  state: Status
}

namespace StatusNotification {
  export const type = new NotificationType<StatusParams, void>(
    'standard/status'
  )
}

interface NoConfigParams {
  message: string
  document: TextDocumentIdentifier
}

interface NoConfigResult {}

namespace NoConfigRequest {
  export const type = new RequestType<
  NoConfigParams,
  NoConfigResult,
  void,
  void
  >('standard/noConfig')
}

interface NoStandardLibraryParams {
  source: TextDocumentIdentifier
}

interface NoStandardLibraryResult {}

namespace NoStandardLibraryRequest {
  export const type = new RequestType<
  NoStandardLibraryParams,
  NoStandardLibraryResult,
  void,
  void
  >('standard/noLibrary')
}

type RunValues = 'onType' | 'onSave'

interface DirectoryItem {
  directory: string
  changeProcessCWD?: boolean
}

namespace DirectoryItem {
  export function is (item: any): item is DirectoryItem {
    const candidate = item as DirectoryItem
    return (
      candidate &&
      Is.string(candidate.directory) &&
      (Is.boolean(candidate.changeProcessCWD) ||
        candidate.changeProcessCWD === void 0)
    )
  }
}

interface TextDocumentSettings {
  validate: boolean
  autoFix: boolean
  autoFixOnSave: boolean
  engine: LinterValues
  usePackageJson: boolean
  options: any | undefined
  run: RunValues
  nodePath: string | undefined
  workspaceFolder: { name: string, uri: URI } | undefined
  workingDirectory: DirectoryItem | undefined
  library: StandardModule | undefined
}

interface StandardAutoFixEdit {
  range: [number, number]
  text: string
}

interface StandardProblem {
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity: number
  ruleId: string
  message: string
  fix?: StandardAutoFixEdit
}

interface StandardDocumentReport {
  filePath: string
  errorCount: number
  warningCount: number
  messages: StandardProblem[]
  output?: string
}

interface StanardReport {
  errorCount: number
  warningCount: number
  results: StandardDocumentReport[]
}

interface CLIOptions {
  cwd: string
  fix: boolean
  ignore: string[]
  globals: string[]
  plugins: string[]
  envs: string[]
  parser: string
}

type StandardModuleCallback = (error: Object, results: StanardReport) => void
interface Opts {
  ignore?: string[]
  cwd?: string
}
interface StandardModule {
  lintText: (text: string, opts?: CLIOptions, cb?: StandardModuleCallback) => void
  parseOpts: (opts: Object) => Opts
}

function makeDiagnostic (
  problem: StandardProblem,
  source: LinterValues
): Diagnostic {
  const message =
    problem.ruleId != null
      ? `${problem.message} (${problem.ruleId})`
      : `${problem.message}`
  const startLine = Math.max(0, problem.line - 1)
  const startChar = Math.max(0, problem.column - 1)
  const endLine =
    problem.endLine != null ? Math.max(0, problem.endLine - 1) : startLine
  const endChar =
    problem.endColumn != null ? Math.max(0, problem.endColumn - 1) : startChar
  return {
    message: message,
    severity: convertSeverity(problem.severity),
    source: source,
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar }
    },
    code: problem.ruleId
  }
}

interface AutoFix {
  label: string
  documentVersion: number
  ruleId: string
  edit: StandardAutoFixEdit
}

function computeKey (diagnostic: Diagnostic): string {
  const range = diagnostic.range
  return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`
}

const codeActions: Map<string, Map<string, AutoFix>> = new Map<
string,
Map<string, AutoFix>
>()
function recordCodeAction (
  document: TextDocument,
  diagnostic: Diagnostic,
  problem: StandardProblem
): void {
  if (!problem.fix || !problem.ruleId) {
    return
  }
  const uri = document.uri
  let edits: Map<string, AutoFix> = codeActions.get(uri)!
  if (!edits) {
    edits = new Map<string, AutoFix>()
    codeActions.set(uri, edits)
  }
  edits.set(computeKey(diagnostic), {
    label: `Fix this ${problem.ruleId} problem`,
    documentVersion: document.version,
    ruleId: problem.ruleId,
    edit: problem.fix
  })
}

function convertSeverity (severity: number): DiagnosticSeverity {
  switch (severity) {
    // Eslint 1 is warning
    case 1:
      return DiagnosticSeverity.Warning
    case 2:
      return DiagnosticSeverity.Error
    default:
      return DiagnosticSeverity.Error
  }
}

const enum CharCode {
  /**
   * The `\` character.
   */
  Backslash = 92
}

/**
 * Check if the path follows this pattern: `\\hostname\sharename`.
 *
 * @see https://msdn.microsoft.com/en-us/library/gg465305.aspx
 * @return A boolean indication if the path is a UNC path, on none-windows
 * always false.
 */
function isUNC (path: string): boolean {
  if (process.platform !== 'win32') {
    // UNC is a windows concept
    return false
  }

  if (!path || path.length < 5) {
    // at least \\a\b
    return false
  }

  let code = path.charCodeAt(0)
  if (code !== CharCode.Backslash) {
    return false
  }
  code = path.charCodeAt(1)
  if (code !== CharCode.Backslash) {
    return false
  }
  let pos = 2
  const start = pos
  for (; pos < path.length; pos++) {
    code = path.charCodeAt(pos)
    if (code === CharCode.Backslash) {
      break
    }
  }
  if (start === pos) {
    return false
  }
  code = path.charCodeAt(pos + 1)
  if (isNaN(code) || code === CharCode.Backslash) {
    return false
  }
  return true
}

function getFilePath (documentOrUri: string | URI): string {
  if (!documentOrUri) {
    return ''
  }
  const uri = Is.string(documentOrUri) ? URI.parse(documentOrUri) : documentOrUri
  if (uri.scheme !== 'file') {
    return ''
  }
  return uri.fsPath
}

const exitCalled = new NotificationType<[number, string], void>(
  'standard/exitCalled'
)

const nodeExit = process.exit
process.on('SIGINT', () => {
  const stack = new Error('stack')
  connection.sendNotification(exitCalled, [0, stack.stack])
  setTimeout(() => {
    nodeExit(0)
  }, 1000)
})

const connection = createConnection(
  ProposedFeatures.all,
  new IPCMessageReader(process),
  new IPCMessageWriter(process)
)
const documents = new TextDocuments(TextDocument)

let globalNodePath: string | undefined

const path2Library: Map<string, StandardModule> = new Map<
string,
StandardModule
>()
const document2Settings: Map<string, Thenable<TextDocumentSettings>> = new Map<
string,
Thenable<TextDocumentSettings>
>()

function resolveSettings (
  document: TextDocument
): Thenable<TextDocumentSettings> {
  const uri = document.uri
  let resultPromise = document2Settings.get(uri)
  if (resultPromise) {
    return resultPromise
  }
  resultPromise = connection.workspace
    .getConfiguration({ scopeUri: uri, section: '' })
    .then((settings: TextDocumentSettings) => {
      const uri = URI.parse(document.uri)
      const linterNames: { [linter: string]: LinterNameValues } = {
        standard: 'JavaScript Standard Style',
        semistandard: 'JavaScript Semi-Standard Style',
        standardx: 'JavaScript Standard Style with custom tweaks',
        'ts-standard': 'TypeScript Standard Style'
      }
      let linter = settings.engine
      let linterName = linterNames[settings.engine]
      // when settings.usePackageJson is true
      // we need to do more
      const { usePackageJson } = settings
      // when we open single file not under project,
      // that workingspaceFolder would be undefined
      if (
        usePackageJson &&
        settings.workspaceFolder != null &&
        settings.workspaceFolder.uri != null
      ) {
        const pkgPath = path.join(
          getFilePath(settings.workspaceFolder.uri),
          'package.json'
        )
        const pkgExists = fs.existsSync(pkgPath)
        if (pkgExists) {
          const pkgStr = fs.readFileSync(pkgPath, 'utf8')
          const pkg = JSON.parse(pkgStr)
          if (pkg && pkg.devDependencies && pkg.devDependencies.standard) {
            linter = 'standard'
            linterName = 'JavaScript Standard Style'
          } else if (
            pkg &&
            pkg.devDependencies &&
            pkg.devDependencies.semistandard
          ) {
            linter = 'semistandard'
            linterName = 'JavaScript Semi-Standard Style'
          } else if (
            pkg &&
            pkg.devDependencies &&
            pkg.devDependencies.standardx
          ) {
            linter = 'standardx'
            linterName = 'JavaScript Standard Style with custom tweaks'
          } else if (
            pkg &&
            pkg.devDependencies &&
            pkg.devDependencies['ts-standard']
          ) {
            linter = 'ts-standard'
            linterName = 'TypeScript Standard Style'
          }
          // if standard, semistandard, standardx, ts-standard config presented in package.json
          if (
            (pkg && pkg.devDependencies && pkg.devDependencies.standard) ||
            (pkg && pkg.devDependencies && pkg.devDependencies.semistandard) ||
            (pkg && pkg.devDependencies && pkg.devDependencies.standardx) ||
            (pkg && pkg.devDependencies && pkg.devDependencies['ts-standard'])
          ) {
            if (pkg[linter]) {
              // if [linter] presented in package.json
              // combine the global one.
              settings.engine = linter
              settings.options = Object.assign(
                {},
                settings.options,
                pkg[linter]
              )
            } else {
              // default options to those in settings.json
            }
          } else {
            // no linter defined in package.json
            settings.validate = false
            connection.console.info(`no ${linter} in package.json`)
          }
        }
      }
      let promise: Thenable<string>
      if (uri.scheme === 'file') {
        const file = uri.fsPath
        const directory = path.dirname(file)
        if (settings.nodePath) {
          promise = Files.resolve(
            linter,
            settings.nodePath,
            settings.nodePath,
            trace
          ).then<string, string>(undefined, () => {
            return Files.resolve(linter, globalNodePath, directory, trace)
          })
        } else {
          promise = Files.resolve(linter, globalNodePath, directory, trace)
        }
      } else {
        promise = Files.resolve(
          linter,
          globalNodePath,
          settings.workspaceFolder
            ? settings.workspaceFolder.uri.toString()
            : undefined,
          trace
        )
      }
      return promise.then(
        path => {
          let library = path2Library.get(path)
          if (!library) {
            library = require(path)
            if (!library?.lintText) {
              settings.validate = false
              connection.console.error(
                `The ${linterName} library loaded from ${path} doesn\'t export a lintText.`
              )
            } else {
              connection.console.info(
                `${linterName} library loaded from: ${path}`
              )
              settings.library = library
            }
            path2Library.set(path, library!)
          } else {
            settings.library = library
          }
          return settings
        },
        () => {
          settings.validate = false
          connection.sendRequest(NoStandardLibraryRequest.type, {
            source: { uri: document.uri }
          })
          return settings
        }
      )
    })
  document2Settings.set(uri, resultPromise)
  return resultPromise
}

interface Request<P, R> {
  method: string
  params: P
  documentVersion: number | undefined
  resolve: (value: R | Thenable<R>) => void | undefined
  reject: (error: any) => void | undefined
  token: CancellationToken | undefined
}

namespace Request {
  export function is (value: any): value is Request<any, any> {
    const candidate: Request<any, any> = value
    return (
      candidate &&
      !!candidate.token &&
      !!candidate.resolve &&
      !!candidate.reject
    )
  }
}

interface Notifcation<P> {
  method: string
  params: P
  documentVersion: number
}

type Message<P, R> = Notifcation<P> | Request<P, R>

type VersionProvider<P> = (params: P) => number

namespace Thenable {
  export function is<T> (value: any): value is Thenable<T> {
    const candidate: Thenable<T> = value
    return candidate && typeof candidate.then === 'function'
  }
}

class BufferedMessageQueue {
  private readonly queue: Array<Message<any, any>>
  private readonly requestHandlers: Map<
  string,
  {
    handler: RequestHandler<any, any, any>
    versionProvider?: VersionProvider<any>
  }
  >

  private readonly notificationHandlers: Map<
  string,
  {
    handler: NotificationHandler<any>
    versionProvider?: VersionProvider<any>
  }
  >

  private timer: NodeJS.Timer | undefined

  constructor (private readonly connection: IConnection) {
    this.queue = []
    this.requestHandlers = new Map()
    this.notificationHandlers = new Map()
  }

  public registerRequest<P, R, E, RO> (
    type: RequestType<P, R, E, RO>,
    handler: RequestHandler<any, any, any>,
    versionProvider?: VersionProvider<P>
  ): void {
    this.connection.onRequest(type, (params, token) => {
      return new Promise<R>((resolve, reject) => {
        this.queue.push({
          method: type.method,
          params: params,
          documentVersion: versionProvider
            ? versionProvider(params)
            : undefined,
          resolve: resolve,
          reject: reject,
          token: token
        })
        this.trigger()
      })
    })
    this.requestHandlers.set(type.method, { handler, versionProvider })
  }

  public registerNotification<P, RO> (
    type: any,
    handler: NotificationHandler<any>,
    versionProvider?: any
  ) {
    connection.onNotification(type, (params: Notifcation<any>) => {
      this.queue.push({
        documentVersion:
          versionProvider != null ? versionProvider(params) : undefined,
        method: type.method,
        params: params
      })
      this.trigger()
    })
    this.notificationHandlers.set(type.method, { handler, versionProvider })
  }

  public addNotificationMessage<P, RO> (
    type: NotificationType<P, RO>,
    params: P,
    version: number
  ) {
    this.queue.push({
      method: type.method,
      params,
      documentVersion: version
    })
    this.trigger()
  }

  public onNotification<P, RO> (
    type: NotificationType<P, RO>,
    handler: NotificationHandler<P>,
    versionProvider?: (params: P) => number
  ): void {
    this.notificationHandlers.set(type.method, { handler, versionProvider })
  }

  private trigger (): void {
    if (this.timer != null || this.queue.length === 0) {
      return
    }
    // @ts-expect-error next-line
    this.timer = setImmediate(() => {
      this.timer = undefined
      this.processQueue()
    })
  }

  private processQueue (): void {
    const message = this.queue.shift()
    if (!message) {
      return
    }
    if (Request.is(message)) {
      const requestMessage = message
      if (
        requestMessage.token != null &&
        requestMessage.token.isCancellationRequested
      ) {
        requestMessage.reject(
          new ResponseError(
            ErrorCodes.RequestCancelled,
            'Request got cancelled'
          )
        )
        return
      }
      const elem = this.requestHandlers.get(requestMessage.method)
      if (elem == null) {
        return
      }
      if (
        elem?.versionProvider &&
        requestMessage.documentVersion !== void 0 &&
        requestMessage.documentVersion !==
          elem.versionProvider(requestMessage.params)
      ) {
        requestMessage.reject(
          new ResponseError(
            ErrorCodes.RequestCancelled,
            'Request got cancelled'
          )
        )
        return
      }
      const result = elem.handler(requestMessage.params, requestMessage.token!)
      if (Thenable.is(result)) {
        result.then(
          value => {
            requestMessage.resolve(value)
          },
          error => {
            requestMessage.reject(error)
          }
        )
      } else {
        requestMessage.resolve(result)
      }
    } else {
      const notificationMessage = message
      const elem = this.notificationHandlers.get(notificationMessage.method)
      if (
        elem != null &&
        elem.versionProvider &&
        notificationMessage.documentVersion !== void 0 &&
        notificationMessage.documentVersion !==
          elem.versionProvider(notificationMessage.params)
      ) {
        return
      }
      if (elem != null) {
        elem.handler(notificationMessage.params)
      }
    }
    this.trigger()
  }
}

const messageQueue: BufferedMessageQueue = new BufferedMessageQueue(connection)

namespace ValidateNotification {
  export const type: NotificationType<
  TextDocument,
  void
  > = new NotificationType<TextDocument, void>('standard/validate')
}

messageQueue.onNotification(
  ValidateNotification.type,
  document => {
    validateSingle(document, true)
  },
  (document): number => {
    return document.version
  }
)

// The documents manager listen for text document create, change
// and close on the connection
documents.listen(connection)
documents.onDidOpen(event => {
  resolveSettings(event.document).then(settings => {
    if (!settings.validate) {
      return
    }
    if (settings.run === 'onSave') {
      messageQueue.addNotificationMessage(
        ValidateNotification.type,
        event.document,
        event.document.version
      )
    }
  })
})

// A text document has changed. Validate the document according the run setting.
documents.onDidChangeContent(event => {
  resolveSettings(event.document).then(settings => {
    if (!settings.validate || settings.run !== 'onType') {
      return
    }
    messageQueue.addNotificationMessage(
      ValidateNotification.type,
      event.document,
      event.document.version
    )
  })
})

function getFixes (textDocument: TextDocument): TextEdit[] {
  const uri = textDocument.uri
  const edits = codeActions.get(uri)
  function createTextEdit (editInfo: AutoFix): TextEdit {
    return TextEdit.replace(
      Range.create(
        textDocument.positionAt(editInfo.edit.range[0]),
        textDocument.positionAt(editInfo.edit.range[1])
      ),
      editInfo.edit.text || ''
    )
  }
  if (edits) {
    const fixes = new Fixes(edits)
    if (
      fixes.isEmpty() ||
      textDocument.version !== fixes.getDocumentVersion()
    ) {
      return []
    }
    return fixes.getOverlapFree().map(createTextEdit)
  }
  return []
}

documents.onWillSaveWaitUntil(event => {
  if (event.reason === TextDocumentSaveReason.AfterDelay) {
    return []
  }

  const document = event.document
  return resolveSettings(document).then(settings => {
    if (!settings.autoFixOnSave) {
      return []
    }
    // If we validate on save and want to apply fixes on will save
    // we need to validate the file.
    if (settings.run === 'onSave') {
      // Do not queue this since we want to get the fixes as fast as possible.
      return validateSingle(document, false).then(() => getFixes(document))
    } else {
      return getFixes(document)
    }
  })
})

// A text document has been saved. Validate the document according the run setting.
documents.onDidSave(event => {
  resolveSettings(event.document).then(settings => {
    if (!settings.validate || settings.run !== 'onSave') {
      return
    }
    messageQueue.addNotificationMessage(
      ValidateNotification.type,
      event.document,
      event.document.version
    )
  })
})

documents.onDidClose(event => {
  resolveSettings(event.document).then(settings => {
    const uri = event.document.uri
    document2Settings.delete(uri)
    codeActions.delete(uri)
    if (settings.validate) {
      connection.sendDiagnostics({ uri: uri, diagnostics: [] })
    }
  })
})

function environmentChanged () {
  document2Settings.clear()
  for (const document of documents.all()) {
    messageQueue.addNotificationMessage(
      ValidateNotification.type,
      document,
      document.version
    )
  }
}

function trace (message: string, verbose?: string): void {
  connection.tracer.log(message, verbose)
}

connection.onInitialize(_params => {
  globalNodePath = Files.resolveGlobalNodePath()
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
        willSaveWaitUntil: true,
        save: {
          includeText: false
        }
      },
      codeActionProvider: true,
      executeCommandProvider: {
        commands: [
          CommandIds.applySingleFix,
          CommandIds.applySameFixes,
          CommandIds.applyAllFixes,
          CommandIds.applyAutoFix
        ]
      }
    }
  }
})

connection.onInitialized(() => {
  connection.client.register(DidChangeConfigurationNotification.type, undefined)
  connection.client.register(
    DidChangeWorkspaceFoldersNotification.type,
    undefined
  )
})

messageQueue.registerNotification(
  DidChangeConfigurationNotification.type,
  _params => {
    environmentChanged()
  }
)

messageQueue.registerNotification(
  DidChangeWorkspaceFoldersNotification.type,
  _params => {
    environmentChanged()
  }
)

const singleErrorHandlers: Array<(
  error: any,
  document: TextDocument,
  library: StandardModule | undefined
) => Status | undefined> = [
  tryHandleNoConfig,
  tryHandleConfigError,
  tryHandleMissingModule,
  showErrorMessage
]

function validateSingle (
  document: TextDocument,
  publishDiagnostics: boolean = true
): Thenable<void> {
  // We validate document in a queue but open / close documents directly. So we need to deal with the
  // fact that a document might be gone from the server.
  if (!documents.get(document.uri)) {
    return Promise.resolve(undefined)
  }
  return resolveSettings(document).then(settings => {
    if (!settings.validate) {
      return
    }
    try {
      validate(document, settings, publishDiagnostics)
      connection.sendNotification(StatusNotification.type, { state: Status.ok })
    } catch (err) {
      let status
      for (const handler of singleErrorHandlers) {
        status = handler(err, document, settings.library)
        if (status) {
          break
        }
      }
      status = status || Status.error
      connection.sendNotification(StatusNotification.type, { state: status })
    }
  })
}

function validateMany (documents: TextDocument[]): void {
  documents.forEach(document => {
    messageQueue.addNotificationMessage(
      ValidateNotification.type,
      document,
      document.version
    )
  })
}

function getMessage (err: any, document: TextDocument): string {
  let result: string | null = null
  if (typeof err.message === 'string' || err.message instanceof String) {
    result = <string>err.message
    result = result.replace(/\r?\n/g, ' ')
    if (/^CLI: /.test(result)) {
      result = result.substr(5)
    }
  } else {
    result = `An unknown error occured while validating document: ${document.uri}`
  }
  return result
}

function validate (
  document: TextDocument,
  settings: TextDocumentSettings,
  publishDiagnostics: boolean = true
): void {
  const uri = document.uri
  // filename is needed,
  // or eslint processText will fail to load the plugins
  const newOptions: CLIOptions = Object.assign(
    Object.create(null),
    { filename: uri },
    settings.options
  )
  const content = document.getText()
  const file = getFilePath(uri)
  const cwd = process.cwd()
  try {
    if (file !== '') {
      if (settings.workingDirectory != null) {
        newOptions.cwd = settings.workingDirectory.directory
        if (settings.workingDirectory.changeProcessCWD) {
          process.chdir(settings.workingDirectory.directory)
        }
      } else if (settings.workspaceFolder) {
        const workspaceFolderUri = settings.workspaceFolder.uri
        if (workspaceFolderUri.scheme === 'file') {
          newOptions.cwd = workspaceFolderUri.fsPath
          process.chdir(workspaceFolderUri.fsPath)
        }
      } else if (!settings.workspaceFolder && !isUNC(file)) {
        const directory = path.dirname(file)
        if (directory) {
          if (path.isAbsolute(directory)) {
            newOptions.cwd = directory
          }
        }
      }
    }
    if (settings.library != null) {
      var opts = settings.library.parseOpts(newOptions)
      var deglobOpts = {
        ignore: opts.ignore,
        cwd: opts.cwd,
        configKey: settings.engine
      }
    }
    async.waterfall(
      [
        function (callback: any) {
          // Clean previously computed code actions.
          codeActions.delete(uri)
          callback(null)
        },
        function (callback: any) {
          if (typeof file === 'undefined') {
            return callback(null)
          }
          deglob([file], deglobOpts, function (err: any, files: any) {
            if (err) {
              return callback(err)
            }
            if (files.length === 1) {
              // got a file
              return callback(null)
            } else {
              // no file
              // actually it's no an error,
              // just need to stop the later.
              return callback(`${file} ignored.`)
            }
          })
        },
        function (callback: any) {
          if (settings.library != null) {
            settings.library.lintText(content, newOptions, function (
              error,
              report
            ) {
              if (error) {
                tryHandleMissingModule(error, document, settings.library)
                return callback(error)
              }
              return callback(null, report)
            })
          }
        },
        function (report: StanardReport, callback: any) {
          const diagnostics: Diagnostic[] = []
          if (
            report &&
            report.results &&
            Array.isArray(report.results) &&
            report.results.length > 0
          ) {
            const docReport = report.results[0]
            if (docReport.messages && Array.isArray(docReport.messages)) {
              docReport.messages.forEach(problem => {
                if (problem) {
                  const diagnostic = makeDiagnostic(problem, settings.engine)
                  diagnostics.push(diagnostic)
                  if (settings.autoFix) {
                    recordCodeAction(document, diagnostic, problem)
                  }
                }
              })
            }
          }
          if (publishDiagnostics) {
            connection.sendDiagnostics({ uri, diagnostics })
          }
          callback(null)
        }
      ],
      function (err: any, _results: any) {
        if (err) {
          return console.log(err)
        }
      }
    )
  } catch (e) {
    console.log(e)
  } finally {
    if (cwd !== process.cwd()) {
      process.chdir(cwd)
    }
  }
}

let noConfigReported: Map<string, StandardModule | undefined> = new Map<
string,
StandardModule
>()

function isNoConfigFoundError (error: any): boolean {
  const candidate = error as StandardError
  return (
    candidate.messageTemplate === 'no-config-found' ||
    candidate.message === 'No ESLint configuration found.'
  )
}

function tryHandleNoConfig (
  error: any,
  document: TextDocument,
  library: StandardModule | undefined
): Status | undefined {
  if (!isNoConfigFoundError(error)) {
    return undefined
  }
  if (!noConfigReported.has(document.uri)) {
    connection
      .sendRequest(NoConfigRequest.type, {
        message: getMessage(error, document),
        document: {
          uri: document.uri
        }
      })
      .then(undefined, () => {})
    noConfigReported.set(document.uri, library)
  }
  return Status.warn
}

const configErrorReported: Map<string, StandardModule | undefined> = new Map<
string,
StandardModule
>()

function tryHandleConfigError (
  error: any,
  document: TextDocument,
  library: StandardModule | undefined
): Status | undefined {
  if (!error.message) {
    return undefined
  }

  function handleFileName (filename: string): Status {
    if (!configErrorReported.has(filename)) {
      connection.console.error(getMessage(error, document))
      if (!documents.get(URI.file(filename).toString())) {
        connection.window.showInformationMessage(getMessage(error, document))
      }
      configErrorReported.set(filename, library)
    }
    return Status.warn
  }

  let matches = /Cannot read config file:\s+(.*)\nError:\s+(.*)/.exec(
    error.message
  )
  if (matches && matches.length === 3) {
    return handleFileName(matches[1])
  }

  matches = /(.*):\n\s*Configuration for rule \"(.*)\" is /.exec(error.message)
  if (matches && matches.length === 3) {
    return handleFileName(matches[1])
  }

  matches = /Cannot find module '([^']*)'\nReferenced from:\s+(.*)/.exec(
    error.message
  )
  if (matches && matches.length === 3) {
    return handleFileName(matches[2])
  }

  return undefined
}

let missingModuleReported: Map<string, StandardModule> = new Map<
string,
StandardModule
>()

function tryHandleMissingModule (
  error: any,
  document: TextDocument,
  library: StandardModule | undefined
): Status | undefined {
  if (!error.message) {
    return undefined
  }

  function handleMissingModule (
    plugin: string,
    module: string,
    error: StandardError
  ): Status {
    if (!missingModuleReported.has(plugin)) {
      const fsPath = getFilePath(document.uri)
      missingModuleReported.set(plugin, library!)
      if (error.messageTemplate === 'plugin-missing') {
        connection.console.error(
          [
            '',
            `${error.message.toString()}`,
            `Happend while validating ${fsPath || document.uri}`,
            'This can happen for a couple of reasons:',
            '1. The plugin name is spelled incorrectly in JavaScript Standard Style configuration.',
            `2. If JavaScript Standard Style is installed globally, then make sure ${module} is installed globally as well.`,
            `3. If JavaScript Standard Style is installed locally, then ${module} isn't installed correctly.`
          ].join('\n')
        )
      } else {
        connection.console.error(
          [
            `${error.message.toString()}`,
            `Happend while validating ${fsPath || document.uri}`
          ].join('\n')
        )
      }
    }
    return Status.warn
  }

  const matches = /Failed to load plugin (.*): Cannot find module (.*)/.exec(
    error.message
  )
  if (matches && matches.length === 3) {
    return handleMissingModule(matches[1], matches[2], error)
  }

  return undefined
}

function showErrorMessage (error: any, document: TextDocument): Status {
  connection.window.showErrorMessage(getMessage(error, document))
  return Status.error
}

messageQueue.registerNotification(
  DidChangeWatchedFilesNotification.type,
  params => {
    // A .eslintrc has change. No smartness here.
    // Simply revalidate all file.
    noConfigReported = Object.create(null)
    missingModuleReported = Object.create(null)
    params.changes.forEach((change: any) => {
      const fsPath = getFilePath(change.uri)
      if (!fsPath || isUNC(fsPath)) {
        return
      }
      const dirname = path.dirname(fsPath)
      if (dirname) {
        const library = configErrorReported.get(fsPath)
        if (library) {
          try {
            library.lintText('')
            configErrorReported.delete(fsPath)
          } catch (error) {}
        }
      }
    })
    validateMany(documents.all())
  }
)

class Fixes {
  constructor (private readonly edits: Map<string, AutoFix>) {}

  public static overlaps (lastEdit: AutoFix, newEdit: AutoFix): boolean {
    return !!lastEdit && lastEdit.edit.range[1] > newEdit.edit.range[0]
  }

  public isEmpty (): boolean {
    return this.edits.size === 0
  }

  public getDocumentVersion (): number {
    if (this.isEmpty()) {
      throw new Error('No edits recorded.')
    }
    return this.edits.values().next().value.documentVersion
  }

  public getScoped (diagnostics: Diagnostic[]): AutoFix[] {
    const result: AutoFix[] = []
    for (const diagnostic of diagnostics) {
      const key = computeKey(diagnostic)
      const editInfo = this.edits.get(key)
      if (editInfo) {
        result.push(editInfo)
      }
    }
    return result
  }

  public getAllSorted (): AutoFix[] {
    const result: AutoFix[] = []
    this.edits.forEach(value => result.push(value))
    return result.sort((a, b) => {
      const d = a.edit.range[0] - b.edit.range[0]
      if (d !== 0) {
        return d
      }
      if (a.edit.range[1] === 0) {
        return -1
      }
      if (b.edit.range[1] === 0) {
        return 1
      }
      return a.edit.range[1] - b.edit.range[1]
    })
  }

  public getOverlapFree (): AutoFix[] {
    const sorted = this.getAllSorted()
    if (sorted.length <= 1) {
      return sorted
    }
    const result: AutoFix[] = []
    let last: AutoFix = sorted[0]
    result.push(last)
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]
      if (!Fixes.overlaps(last, current)) {
        result.push(current)
        last = current
      }
    }
    return result
  }
}

let commands: Map<string, WorkspaceChange>
messageQueue.registerRequest(
  CodeActionRequest.type,
  params => {
    commands = new Map<string, WorkspaceChange>()
    const result: Command[] = []
    const uri = params.textDocument.uri
    const edits = codeActions.get(uri)
    if (!edits) {
      return result
    }

    const fixes = new Fixes(edits)
    if (fixes.isEmpty()) {
      return result
    }

    const textDocument = documents.get(uri)
    let documentVersion: number = -1
    let ruleId: string

    function createTextEdit (editInfo: AutoFix): TextEdit | undefined {
      if (textDocument == null) {
        return undefined
      }
      return TextEdit.replace(
        Range.create(
          textDocument.positionAt(editInfo.edit.range[0]),
          textDocument.positionAt(editInfo.edit.range[1])
        ),
        editInfo.edit.text || ''
      )
    }

    function getLastEdit (array: AutoFix[]): AutoFix {
      return array[array.length - 1]
    }

    for (const editInfo of fixes.getScoped(params.context.diagnostics)) {
      documentVersion = editInfo.documentVersion
      ruleId = editInfo.ruleId
      const workspaceChange = new WorkspaceChange()
      if (editInfo != null) {
        workspaceChange
          .getTextEditChange({ uri, version: documentVersion })
          .add(createTextEdit(editInfo)!)
        commands.set(CommandIds.applySingleFix, workspaceChange)
        result.push(Command.create(editInfo.label, CommandIds.applySingleFix))
      }
    }

    if (result.length > 0) {
      const same: AutoFix[] = []
      const all: AutoFix[] = []

      for (const editInfo of fixes.getAllSorted()) {
        if (documentVersion === -1) {
          documentVersion = editInfo.documentVersion
        }
        if (
          editInfo.ruleId === ruleId! &&
          !Fixes.overlaps(getLastEdit(same), editInfo)
        ) {
          same.push(editInfo)
        }
        if (!Fixes.overlaps(getLastEdit(all), editInfo)) {
          all.push(editInfo)
        }
      }
      if (same.length > 1) {
        const sameFixes: WorkspaceChange = new WorkspaceChange()
        const sameTextChange = sameFixes.getTextEditChange({
          uri,
          version: documentVersion
        })
        same.map(createTextEdit).forEach(edit => sameTextChange.add(edit!))
        commands.set(CommandIds.applySameFixes, sameFixes)
        result.push(
          Command.create(
            `Fix all ${ruleId!} problems`,
            CommandIds.applySameFixes
          )
        )
      }
      if (all.length > 1) {
        const allFixes: WorkspaceChange = new WorkspaceChange()
        const allTextChange = allFixes.getTextEditChange({
          uri,
          version: documentVersion
        })
        all.map(createTextEdit).forEach(edit => allTextChange.add(edit!))
        commands.set(CommandIds.applyAllFixes, allFixes)
        result.push(
          Command.create(
            'Fix all auto-fixable problems',
            CommandIds.applyAllFixes
          )
        )
      }
    }
    return result
  },
  params => {
    const document = documents.get(params.textDocument.uri)
    return document ? document.version : 1
  }
)

function computeAllFixes (
  identifier: VersionedTextDocumentIdentifier
): Array<TextEdit | undefined> | undefined {
  const uri = identifier.uri
  const textDocument = documents.get(uri)
  if (!textDocument || identifier.version !== textDocument.version) {
    return undefined
  }
  const edits = codeActions.get(uri)

  if (edits) {
    const fixes = new Fixes(edits)
    if (!fixes.isEmpty()) {
      return fixes.getOverlapFree().map(editInfo => {
        if (textDocument == null) {
          return undefined
        }
        return TextEdit.replace(
          Range.create(
            textDocument.positionAt(editInfo.edit.range[0]),
            textDocument.positionAt(editInfo.edit.range[1])
          ),
          editInfo.edit.text || ''
        )
      })
    }
  }
  return undefined
}

messageQueue.registerRequest(
  ExecuteCommandRequest.type,
  params => {
    let workspaceChange = new WorkspaceChange()
    if (params.command === CommandIds.applyAutoFix) {
      const identifier: VersionedTextDocumentIdentifier = params.arguments[0]
      const edits = computeAllFixes(identifier)
      if (edits != null) {
        workspaceChange = new WorkspaceChange()
        const textChange = workspaceChange.getTextEditChange(identifier)
        edits.forEach(edit => textChange.add(edit!))
      }
    } else {
      workspaceChange = commands.get(params.command)!
    }

    if (workspaceChange == null) {
      return {}
    }
    return connection.workspace.applyEdit(workspaceChange.edit).then(
      response => {
        if (!response.applied) {
          connection.console.error(`Failed to apply command: ${params.command}`)
        }
        return {}
      },
      () => {
        connection.console.error(`Failed to apply command: ${params.command}`)
      }
    )
  },
  params => {
    if (params.command === CommandIds.applyAutoFix) {
      if (params.arguments != null) {
        return params?.arguments[0].version
      }
      return 1
    }
  }
)

connection.listen()
