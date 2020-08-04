/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import {
	workspace as Workspace, window as Window, commands as Commands, languages as Languages, Disposable, ExtensionContext, Uri, StatusBarAlignment, TextEditor, TextDocument,
	CodeActionContext, Diagnostic, ProviderResult, Command, QuickPickItem, WorkspaceFolder as VWorkspaceFolder
} from 'vscode';
import {
	LanguageClient, LanguageClientOptions, RequestType, TransportKind,
	TextDocumentIdentifier, NotificationType, ErrorHandler,
	ErrorAction, CloseAction, State as ClientState,
	RevealOutputChannelOn, VersionedTextDocumentIdentifier, ExecuteCommandRequest, ExecuteCommandParams,
	ServerOptions, Proposed, DocumentFilter, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification,
	CancellationToken, WorkspaceMiddleware
} from 'vscode-languageclient';
type LinterValues = 'standard' | 'semistandard' | 'standardx' | 'ts-standard';
type LinterNameValues = 'JavaScript Standard Style' | 'JavaScript Semi-Standard Style' | 'JavaScript Standard Style with custom tweaks' | 'TypeScript Standard Style';
var linterName: LinterNameValues;

namespace Is {
	const toString = Object.prototype.toString;

	export function boolean(value: any): value is boolean {
		return value === true || value === false;
	}

	export function string(value: any): value is string {
		return toString.call(value) === '[object String]';
	}
}

interface ValidateItem {
	language: string;
	autoFix?: boolean;
}

namespace ValidateItem {
	export function is(item: any): item is ValidateItem {
		let candidate = item as ValidateItem;
		return candidate && Is.string(candidate.language) && (Is.boolean(candidate.autoFix) || candidate.autoFix === void 0);
	}
}

interface DirectoryItem {
	directory: string;
	changeProcessCWD?: boolean;
}

namespace DirectoryItem {
	export function is(item: any): item is DirectoryItem {
		let candidate = item as DirectoryItem;
		return candidate && Is.string(candidate.directory) && (Is.boolean(candidate.changeProcessCWD) || candidate.changeProcessCWD === void 0);
	}
}

type RunValues = 'onType' | 'onSave';

interface TextDocumentSettings {
	validate: boolean;
	autoFix: boolean;
	autoFixOnSave: boolean;
	engine: LinterValues;
	usePackageJson: boolean;
	options: any | undefined;
	run: RunValues;
	nodePath: string | undefined;
	workspaceFolder: Proposed.WorkspaceFolder | undefined;
	workingDirectory: DirectoryItem | undefined;
	library: undefined;
}

interface NoStandardState {
	global?: boolean;
	workspaces?: { [key: string]: boolean };
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
	export const type = new NotificationType<StatusParams, void>('standard/status');
}

interface NoStandardLibraryParams {
	source: TextDocumentIdentifier;
}

interface NoStandardLibraryResult {
}

namespace NoStandardLibraryRequest {
	export const type = new RequestType<NoStandardLibraryParams, NoStandardLibraryResult, void, void>('standard/noLibrary');
}

const exitCalled = new NotificationType<[number, string], void>('standard/exitCalled');

interface WorkspaceFolderItem extends QuickPickItem {
	folder: VWorkspaceFolder;
}
function getLinterName() {
	let configuration = Workspace.getConfiguration('standard');
	let linterNames: { [linter: string]: LinterNameValues; } = {
		'standard': 'JavaScript Standard Style',
		'semistandard': 'JavaScript Semi-Standard Style',
		'standardx': 'JavaScript Standard Style with custom tweaks',
		'ts-standard': 'TypeScript Standard Style'
	}
	return linterNames[configuration.get<LinterValues>('engine', 'standard')];
}
function pickFolder(folders: VWorkspaceFolder[], placeHolder: string): Thenable<VWorkspaceFolder> {
	if (folders.length === 1) {
		return Promise.resolve(folders[0]);
	}
	return Window.showQuickPick(
		folders.map<WorkspaceFolderItem>((folder) => { return { label: folder.name, description: folder.uri.fsPath, folder: folder }; }),
		{ placeHolder: placeHolder }
	).then((selected) => {
		if (!selected) {
			return undefined;
		}
		return selected.folder;
	});
}

function enable() {
	let folders = Workspace.workspaceFolders;
	if (!folders) {
		Window.showWarningMessage(`${linterName} can only be enabled if VS Code is opened on a workspace folder.`);
		return;
	}
	let disabledFolders = folders.filter(folder => !Workspace.getConfiguration('standard',folder.uri).get('enable', true));
	if (disabledFolders.length === 0) {
		if (folders.length === 1) {
			Window.showInformationMessage(`${linterName} is already enabled in the workspace.`);
		} else {
			Window.showInformationMessage(`${linterName} is already enabled on all workspace folders.`);
		}
		return;
	}
	pickFolder(disabledFolders, `Select a workspace folder to enable ${linterName} for`).then(folder => {
		if (!folder) {
			return;
		}
		Workspace.getConfiguration('standard', folder.uri).update('enable', true);
	});
}

function disable() {
	let folders = Workspace.workspaceFolders;
	if (!folders) {
		Window.showErrorMessage(`${linterName} can only be disabled if VS Code is opened on a workspace folder.`);
		return;
	}
	let enabledFolders = folders.filter(folder => Workspace.getConfiguration('standard',folder.uri).get('enable', true));
	if (enabledFolders.length === 0) {
		if (folders.length === 1) {
			Window.showInformationMessage(`${linterName} is already disabled in the workspace.`);
		} else {
			Window.showInformationMessage(`${linterName} is already disabled on all workspace folders.`);
		}
		return;
	}
	pickFolder(enabledFolders, `Select a workspace folder to disable ${linterName} for`).then(folder => {
		if (!folder) {
			return;
		}
		Workspace.getConfiguration('standard', folder.uri).update('enable', false);
	});
}

let dummyCommands: Disposable[];

let defaultLanguages = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'];
function shouldBeValidated(textDocument: TextDocument): boolean {
	let config = Workspace.getConfiguration('standard', textDocument.uri);
	if (!config.get('enable', true)) {
		return false;
	}
	let validate = config.get<(ValidateItem | string)[]>('validate', defaultLanguages);
	for (let item of validate) {
		if (Is.string(item) && item === textDocument.languageId) {
			return true;
		} else if (ValidateItem.is(item) && item.language === textDocument.languageId) {
			return true;
		}
	}
	return false;
}

export function activate(context: ExtensionContext) {
	let activated: boolean;
	let openListener: Disposable;
	let configurationListener: Disposable;
	function didOpenTextDocument(textDocument: TextDocument) {
		if (activated) {
			return;
		}
		if (shouldBeValidated(textDocument)) {
			openListener.dispose();
			configurationListener.dispose();
			activated = true;
			realActivate(context);
		}
	}
	function configurationChanged() {
		if (!activated) {
			for (let textDocument of Workspace.textDocuments) {
				if (shouldBeValidated(textDocument)) {
					openListener.dispose();
					configurationListener.dispose();
					activated = true;
					realActivate(context);
					break;
				}
			}
		}
		Commands.executeCommand('setContext', 'standardEnabled', activated);
	}
	openListener = Workspace.onDidOpenTextDocument(didOpenTextDocument);
	configurationListener = Workspace.onDidChangeConfiguration(configurationChanged);

	let notValidating = () => Window.showInformationMessage(`${linterName} is not validating any files yet.`);
	dummyCommands = [
		Commands.registerCommand('standard.executeAutofix', notValidating),
		Commands.registerCommand('standard.showOutputChannel', notValidating)
	];

	context.subscriptions.push(
		Commands.registerCommand('standard.enable', enable),
		Commands.registerCommand('standard.disable', disable)
	);
	configurationChanged();
}

export function realActivate(context: ExtensionContext) {
	linterName = getLinterName();

		let statusBarItem = Window.createStatusBarItem(StatusBarAlignment.Right, 0);
		let standardStatus: Status = Status.ok;
		let serverRunning: boolean = false;

		statusBarItem.text = linterName;
		statusBarItem.command = 'standard.showOutputChannel';

		function showStatusBarItem(show: boolean): void {
			if (show) {
				statusBarItem.show();
			} else {
				statusBarItem.hide();
			}
		}

		function updateStatus(status: Status) {
			switch (status) {
				case Status.ok:
					statusBarItem.color = undefined;
					break;
				case Status.warn:
					statusBarItem.color = 'yellow';
					break;
				case Status.error:
					statusBarItem.color = 'darkred';
					break;
			}
			standardStatus = status;
			updateStatusBarVisibility(Window.activeTextEditor);
		}

		function updateStatusBarVisibility(editor: TextEditor): void {
			statusBarItem.text = standardStatus === Status.ok ? linterName : `${linterName}!`;
			showStatusBarItem(
				serverRunning &&
				(
					standardStatus !== Status.ok ||
					(editor && defaultLanguages.indexOf(editor.document.languageId) > -1)
				)
			);
		}

		Window.onDidChangeActiveTextEditor(updateStatusBarVisibility);
		updateStatusBarVisibility(Window.activeTextEditor);

		// We need to go one level up since an extension compile the js code into
		// the output folder.
		// serverModule
		let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
		let debugOptions = { execArgv: ["--nolazy", "--inspect=6023"], cwd: process.cwd() };
		let serverOptions: ServerOptions = {
			run: { module: serverModule, transport: TransportKind.ipc, options: { cwd: process.cwd() } },
			debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
		};

		let defaultErrorHandler: ErrorHandler;
		let serverCalledProcessExit: boolean = false;

		let packageJsonFilter: DocumentFilter = { scheme: 'file', pattern: '**/package.json'};
		let syncedDocuments: Map<string, TextDocument> = new Map<string, TextDocument>();

		Workspace.onDidChangeConfiguration(() => {
			for (let textDocument of syncedDocuments.values()) {
				if (!shouldBeValidated(textDocument)) {
					syncedDocuments.delete(textDocument.uri.toString());
					client.sendNotification(DidCloseTextDocumentNotification.type, client.code2ProtocolConverter.asCloseTextDocumentParams(textDocument));
				}
			}
			for (let textDocument of Workspace.textDocuments) {
				if (!syncedDocuments.has(textDocument.uri.toString()) && shouldBeValidated(textDocument)) {
					client.sendNotification(DidOpenTextDocumentNotification.type, client.code2ProtocolConverter.asOpenTextDocumentParams(textDocument));
					syncedDocuments.set(textDocument.uri.toString(), textDocument);
				}
			}
		});
		let clientOptions: LanguageClientOptions = {
			documentSelector: [{  scheme: 'file' }, { scheme: 'untitled'}],
			diagnosticCollectionName: 'standard',
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			synchronize: {
				// configurationSection: 'standard',
				fileEvents: [
					Workspace.createFileSystemWatcher('**/package.json')
				]
			},
			initializationOptions: () => {
				let configuration = Workspace.getConfiguration('standard');
				let folders = Workspace.workspaceFolders;
				return {
					legacyModuleResolve: configuration ? configuration.get('_legacyModuleResolve', false) : false,
					nodePath: configuration ? configuration.get('nodePath', undefined) : undefined,
					languageIds: configuration ? configuration.get('valiadate', defaultLanguages) : defaultLanguages,
					workspaceFolders: folders ? folders.map(folder => folder.toString()) : []
				};
			},
			initializationFailedHandler: (error) => {
				client.error('Server initialization failed.', error);
				client.outputChannel.show(true);
				return false;
			},
			errorHandler: {
				error: (error, message, count): ErrorAction => {
					return defaultErrorHandler.error(error, message, count);
				},
				closed: (): CloseAction => {
					if (serverCalledProcessExit) {
						return CloseAction.DoNotRestart;
					}
					return defaultErrorHandler.closed();
				}
			},
			middleware: {
				didOpen: (document, next) => {
					if (Languages.match(packageJsonFilter, document) || shouldBeValidated(document)) {
						next(document);
						syncedDocuments.set(document.uri.toString(), document);
						return;
					}
				},
				didChange: (event, next) => {
					if (syncedDocuments.has(event.document.uri.toString())) {
						next(event);
					}
				},
				willSave: (event, next) => {
					if (syncedDocuments.has(event.document.uri.toString())) {
						next(event);
					}
				},
				willSaveWaitUntil: (event, next) => {
					if (syncedDocuments.has(event.document.uri.toString())) {
						return next(event);
					} else {
						return Promise.resolve([]);
					}
				},
				didSave: (document, next) => {
					if (syncedDocuments.has(document.uri.toString())) {
						next(document);
					}
				},
				didClose: (document, next) => {
					let uri = document.uri.toString();
					if (syncedDocuments.has(uri)) {
						syncedDocuments.delete(uri);
						next(document);
					}
				},
				provideCodeActions: (document, range, context, token, next): ProviderResult<Command[]> => {
					if (!syncedDocuments.has(document.uri.toString()) || !context.diagnostics || context.diagnostics.length === 0) {
						return [];
					}
					let standardDiagnostics: Diagnostic[] = [];
					for (let diagnostic of context.diagnostics) {
						if (diagnostic.source === 'standard') {
							standardDiagnostics.push(diagnostic);
						}
					}
					if (standardDiagnostics.length === 0) {
						return [];
					}
					let newContext: CodeActionContext = Object.assign({}, context, { diagnostics: standardDiagnostics } as CodeActionContext);
					return next(document, range, newContext, token);
				},
				workspace: {
					configuration: (params: Proposed.ConfigurationParams, _token: CancellationToken, _next: Function): any[] => {
						if (!params.items) {
							return null;
						}
						let result: (TextDocumentSettings | null)[] = [];
						for (let item of params.items) {
							if (item.section || !item.scopeUri) {
								result.push(null);
								continue;
							}
							let resource = client.protocol2CodeConverter.asUri(item.scopeUri);
							let config = Workspace.getConfiguration('standard', resource);
							let settings: TextDocumentSettings = {
								validate: false,
								autoFix: false,
								autoFixOnSave: false,
								engine: config.get('engine', 'standard'),
								usePackageJson: config.get('usePackageJson', false),
								options: config.get('options', {}),
								run: config.get('run', 'onType'),
								nodePath: config.get('nodePath', undefined),
								workingDirectory: undefined,
								workspaceFolder: undefined,
								library: undefined
							}
							let document: TextDocument = syncedDocuments.get(item.scopeUri);
							if (!document) {
								result.push(settings);
								continue;
							}
							if (config.get('enabled', true)) {
								let validateItems = config.get<(ValidateItem | string)[]>('validate', defaultLanguages);
								for (let item of validateItems) {
									if (Is.string(item) && item === document.languageId) {
										settings.validate = true;
										if (defaultLanguages.indexOf(item) > -1) {
											settings.autoFix = true;
										}
										break;
									}
									else if (ValidateItem.is(item) && item.language === document.languageId) {
										settings.validate = true;
										settings.autoFix = item.autoFix;
										break;
									}
								}
							}
							if (settings.validate) {
								settings.autoFixOnSave = settings.autoFix && config.get('autoFixOnSave', false);
							}
							let workspaceFolder = Workspace.getWorkspaceFolder(resource);
							if (workspaceFolder) {
								settings.workspaceFolder = { name: workspaceFolder.name, uri: client.code2ProtocolConverter.asUri(workspaceFolder.uri) };
							}
							let workingDirectories = config.get<(string | DirectoryItem)[]>('workingDirectories', undefined);
							if (Array.isArray(workingDirectories)) {
								let workingDirectory = undefined;
								let workspaceFolderPath = workspaceFolder && workspaceFolder.uri.scheme === 'file' ? workspaceFolder.uri.fsPath : undefined;
								for (let entry of workingDirectories) {
									let directory;
									let changeProcessCWD = false;
									if (Is.string(entry)) {
										directory = entry;
									}
									else if (DirectoryItem.is(entry)) {
										directory = entry.directory;
										changeProcessCWD = !!entry.changeProcessCWD;
									}
									if (directory) {
										if (path.isAbsolute(directory)) {
											directory = directory;
										}
										else if (workspaceFolderPath && directory) {
											directory = path.join(workspaceFolderPath, directory);
										}
										else {
											directory = undefined;
										}
										let filePath = document.uri.scheme === 'file' ? document.uri.fsPath : undefined;
										if (filePath && directory && filePath.startsWith(directory)) {
											if (workingDirectory) {
												if (workingDirectory.directory.length < directory.length) {
													workingDirectory.directory = directory;
													workingDirectory.changeProcessCWD = changeProcessCWD;
												}
											}
											else {
												workingDirectory = { directory, changeProcessCWD };
											}
										}
									}
								}
								settings.workingDirectory = workingDirectory;
							}
							result.push(settings);
						}
						return result;
					}
				} as WorkspaceMiddleware
			}
		};
		let client = new LanguageClient(linterName, serverOptions, clientOptions);
		client.registerProposedFeatures();
		defaultErrorHandler = client.createDefaultErrorHandler();
		const running = `${linterName} server is running.`;
		const stopped = `${linterName} server stopped.`;
		client.onDidChangeState((event) => {
			if (event.newState === ClientState.Running) {
				client.info(running);
				statusBarItem.tooltip = running;
				serverRunning = true;
			} else {
				client.info(stopped);
				statusBarItem.tooltip = stopped;
				serverRunning = false;
			}
			updateStatusBarVisibility(Window.activeTextEditor);
		});
		client.onReady().then(() => {
			client.onNotification(StatusNotification.type, (params) => {
				updateStatus(params.state);
			});

			client.onNotification(exitCalled, (params) => {
				serverCalledProcessExit = true;
				client.error(`Server process exited with code ${params[0]}. This usually indicates a misconfigured ${linterName} setup.`, params[1]);
				Window.showErrorMessage(`${linterName} server shut down itself. See '${linterName}' output channel for details.`);
			});

			client.onRequest(NoStandardLibraryRequest.type, (params) => {
				const key = 'noStandardMessageShown';
				let state = context.globalState.get<NoStandardState>(key, {});
				let uri: Uri = Uri.parse(params.source.uri);
				let workspaceFolder = Workspace.getWorkspaceFolder(uri);
				let config = Workspace.getConfiguration('standard');
				let linter = config.get('engine', 'standard');
				if (workspaceFolder) {
					client.info([
						'',
						`Failed to load the ${linterName} library for the document ${uri.fsPath}`,
						'',
						`To use ${linterName} please install ${linterName} by running 'npm install ${linter}' in the workspace folder ${workspaceFolder.name}`,
						`or globally using 'npm install -g ${linter}'. You need to reopen the workspace after installing ${linterName}.`,
						'',
						`Alternatively you can disable ${linterName} for the workspace folder ${workspaceFolder.name} by executing the 'Disable JavaScript Standard Style' command.`
					].join('\n'));
					if (!state.workspaces) {
						state.workspaces = Object.create(null);
					}
					if (!state.workspaces[workspaceFolder.uri.toString()]) {
						state.workspaces[workspaceFolder.uri.toString()] = true;
						client.outputChannel.show(true);
						context.globalState.update(key, state);
					}
				} else {
					client.info([
						`Failed to load the ${linterName} library for the document ${uri.fsPath}`,
						`To use ${linterName} for single JavaScript file install standard globally using 'npm install -g ${linter}'.`,
						`You need to reopen VS Code after installing ${linter}.`,
					].join('\n'));
					if (!state.global) {
						state.global = true;
						client.outputChannel.show(true);
						context.globalState.update(key, state);
					}
				}
				return {};
			});
		});

		if (dummyCommands) {
			dummyCommands.forEach(command => command.dispose());
			dummyCommands = undefined;
		}
		context.subscriptions.push(
			client.start(),
			Commands.registerCommand('standard.executeAutofix', () => {
				let textEditor = Window.activeTextEditor;
				if (!textEditor) {
					return;
				}
				let textDocument: VersionedTextDocumentIdentifier = {
					uri: textEditor.document.uri.toString(),
					version: textEditor.document.version
				};
				let params: ExecuteCommandParams = {
					command: 'standard.applyAutoFix',
					arguments: [textDocument]
				}
				client.sendRequest(ExecuteCommandRequest.type, params).then(undefined, () => {
					Window.showErrorMessage(`Failed to apply ${linterName} fixes to the document. Please consider opening an issue with steps to reproduce.`);
				});
			}),
			Commands.registerCommand('standard.showOutputChannel', () => { client.outputChannel.show(); }),
			statusBarItem
		);
	}

export function deactivate() {
	if (dummyCommands) {
		dummyCommands.forEach(command => command.dispose());
	}
}
