/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { workspace, window, commands, Disposable, ExtensionContext, Uri, StatusBarAlignment, TextEditor, TextDocument } from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, RequestType, TransportKind,
	TextDocumentIdentifier, NotificationType, ErrorHandler,
	ErrorAction, CloseAction, State as ClientState,
	RevealOutputChannelOn, DocumentSelector, VersionedTextDocumentIdentifier, ExecuteCommandRequest, ExecuteCommandParams
} from 'vscode-languageclient';


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

function enable() {
	if (!workspace.rootPath) {
		window.showErrorMessage('JavaScript Standard Style can only be enabled if VS Code is opened on a workspace folder.');
		return;
	}
	workspace.getConfiguration('standard').update('enable', true, false);
}

function disable() {
	if (!workspace.rootPath) {
		window.showErrorMessage('JavaScript Standard Style can only be disabled if VS Code is opened on a workspace folder.');
		return;
	}
	workspace.getConfiguration('standard').update('enable', false, false);
}

let dummyCommands: [Disposable];

export function activate(context: ExtensionContext) {
	let supportedLanguages: Set<string>;
	function configurationChanged() {
		supportedLanguages = new Set<string>();
		let settings = workspace.getConfiguration('standard');
		if (settings) {
			let toValidate = settings.get('validate', undefined);
			if (toValidate && Array.isArray(toValidate)) {
				toValidate.forEach(item => {
					if (Is.string(item)) {
						supportedLanguages.add(item);
					} else if (ValidateItem.is(item)) {
						supportedLanguages.add(item.language);
					}
				});
			}
		}
	}
	configurationChanged();
	const configurationListener = workspace.onDidChangeConfiguration(configurationChanged);

	let activated: boolean;
	let notValidating = () => window.showInformationMessage('JavaScript Standard Style is not validating any files yet.');
	dummyCommands = [
		commands.registerCommand('standard.executeAutofix', notValidating),
		commands.registerCommand('standard.showOutputChannel', notValidating)
	];
	function didOpenTextDocument(textDocument: TextDocument) {
		if (supportedLanguages.has(textDocument.languageId)) {
			configurationListener.dispose();
			openListener.dispose();
			activated = true;
			realActivate(context);
		}
	};
	const openListener = workspace.onDidOpenTextDocument(didOpenTextDocument);
	for (let textDocument of workspace.textDocuments) {
		if (activated) {
			break;
		}
		didOpenTextDocument(textDocument);
	}

	context.subscriptions.push(
		commands.registerCommand('standard.enable', enable),
		commands.registerCommand('standard.disable', disable)
	);
}

export function realActivate(context: ExtensionContext) {

	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	let standardStatus: Status = Status.ok;
	let serverRunning: boolean = false;

	statusBarItem.text = 'JavaScript Standard Style';
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
				statusBarItem.color = '#aaa';
				break;
		}
		standardStatus = status;
		udpateStatusBarVisibility(window.activeTextEditor);
	}

	function udpateStatusBarVisibility(editor: TextEditor): void {
		statusBarItem.text = standardStatus === Status.ok ? 'JavaScript Standard Style' : 'JavaScript Standard Style!';
		showStatusBarItem(
			serverRunning &&
			(
				standardStatus !== Status.ok ||
				(editor && (editor.document.languageId === 'javascript' || editor.document.languageId === 'javascriptreact'))
			)
		);
	}

	window.onDidChangeActiveTextEditor(udpateStatusBarVisibility);
	udpateStatusBarVisibility(window.activeTextEditor);

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	// serverModule
	let serverModule = path.join(__dirname, '..', 'server', 'server.js');
	let debugOptions = { execArgv: ["--nolazy", "--debug=6010"] };
	let serverOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions}
	};

	let defaultErrorHandler: ErrorHandler;
	let serverCalledProcessExit: boolean = false;
	let staticDocuments: DocumentSelector = [{ scheme: 'file', pattern: '**/package.json'}];
	let languages = ['javascript', 'javascriptreact']
	let clientOptions: LanguageClientOptions = {
		documentSelector: staticDocuments,
		diagnosticCollectionName: 'standard',
		revealOutputChannelOn: RevealOutputChannelOn.Never,
		synchronize: {
			configurationSection: 'standard',
			fileEvents: [
				workspace.createFileSystemWatcher('**/package.json')
			]
		},
		initializationOptions: () => {
			let configuration = workspace.getConfiguration('standard');
			return {
				legacyModuleResolve: configuration ? configuration.get('_legacyModuleResolve', false) : false,
				nodePath: configuration ? configuration.get('nodePath', undefined) : undefined,
				languageIds: configuration ? configuration.get('validate', languages) : languages
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
		}
	};

	let client = new LanguageClient('standard', serverOptions, clientOptions);
	defaultErrorHandler = client.createDefaultErrorHandler();
	const running = 'JavaScript Standard Style server is running.';
	const stopped = 'JavaScript Standard Style server stopped.'
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
		udpateStatusBarVisibility(window.activeTextEditor);
	});
	client.onReady().then(() => {
		client.onNotification(StatusNotification.type, (params) => {
			updateStatus(params.state);
		});

		client.onNotification(StatusNotification.type, (params) => {
			updateStatus(params.state);
		});

		defaultErrorHandler = client.createDefaultErrorHandler();
		client.onNotification(exitCalled, (params) => {
			serverCalledProcessExit = true;
			client.error(`Server process exited with code ${params[0]}. This usually indicates a misconfigured JavaScript Standard Style setup.`, params[1]);
			window.showErrorMessage(`JavaScript Standard Style server shut down itself. See 'JavaScript Standard Style' output channel for details.`);
		});

		// when server reports that no `standard` library installed neither locally or globally
		client.onRequest(NoStandardLibraryRequest.type, (params) => {
			const key = 'noStandardMessageShown';
			let state = context.globalState.get<NoStandardState>(key, {});
			let uri: Uri = Uri.parse(params.source.uri);
			let configuration = workspace.getConfiguration('standard');
			if (configuration.semistandard === true) {
				window.showErrorMessage('Failed to load semistandard library, make sure you have it installed either locally or globally');
			} else {
				window.showErrorMessage('Failed to load standard library, make sure you have it installed either locally or globally');
			}
			if (workspace.rootPath) {
				client.info([
					'',
					`Failed to load the JavaScript Standard Style library for the document '${uri.fsPath}'.`,
					'',
					'To use JavaScript Standard Style in this workspace please install standard using \'npm install standard\' or globally using \'npm install -g standard\'.',
					'You need to reopen the workspace after installing standard.',
					'',
					`Alternatively you can disable JavaScript Standard Style for this workspace by executing the 'Disable JavaScript Standard Style for this workspace' command.`
				].join('\n'));

				if (!state.workspaces) {
					state.workspaces = Object.create(null);
				}
				if (!state.workspaces[workspace.rootPath]) {
					state.workspaces[workspace.rootPath] = true;
					client.outputChannel.show(true);
					context.globalState.update(key, state);
				}
			} else {
				const style = workspace.getConfiguration('standard').semistandard ? 'semistandard' : 'standard';
				client.info([
					`Failed to load the JavaScript Standard Style library for the document '${uri.fsPath}'.`,
					`To use JavaScript ${style.charAt(0).toUpperCase().concat(style.substr(1))} Style for single JavaScript file install ${style} globally using 'npm install -g ${style}'.`,
					'You need to reopen VS Code after installing standard.',
				].join('\n'));
				if (!state.global) {
					state.global = true;
					client.outputChannel.show(true);
					context.globalState.update(key, state);
				}
			}
			// update status bar
			updateStatus(3)
			return {};
		});
	});

	if (dummyCommands) {
		dummyCommands.forEach(command => command.dispose());
		dummyCommands = undefined;
	}
	context.subscriptions.push(
		new SettingMonitor(client, 'standard.enable').start(),
		commands.registerCommand('standard.executeAutofix', () => {
			let textEditor = window.activeTextEditor;
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
				window.showErrorMessage('Failed to apply JavaScript Standard Style fixes to the document. Please consider opening an issue with steps to reproduce.');
			});
		}),
		commands.registerCommand('standard.showOutputChannel', () => { client.outputChannel.show(); }),
		statusBarItem
	);
}

export function deactivate() {
	if (dummyCommands) {
		dummyCommands.forEach(command => command.dispose());
	}
}
