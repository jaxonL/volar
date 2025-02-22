import * as vscode from 'vscode';
import type { BaseLanguageClient } from 'vscode-languageclient';
import { AutoInsertRequest } from '@volar/vue-language-server';

export async function register(context: vscode.ExtensionContext, htmlClient: BaseLanguageClient, tsClient: BaseLanguageClient) {

	const supportedLanguages: Record<string, boolean> = {
		vue: true,
		markdown: true,
		javascript: true,
		typescript: true,
		javascriptreact: true,
		typescriptreact: true,
	};

	let disposables: vscode.Disposable[] = [];
	vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument, null, disposables);

	let isEnabled = false;
	updateEnabledState();
	vscode.window.onDidChangeActiveTextEditor(updateEnabledState, null, disposables);

	let timeout: NodeJS.Timeout | undefined;

	function updateEnabledState() {
		isEnabled = false;
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		let document = editor.document;
		if (!supportedLanguages[document.languageId]) {
			return;
		}
		isEnabled = true;
	}

	function onDidChangeTextDocument({ document, contentChanges, reason }: vscode.TextDocumentChangeEvent) {
		if (!isEnabled || contentChanges.length === 0 || reason === vscode.TextDocumentChangeReason.Undo || reason === vscode.TextDocumentChangeReason.Redo) {
			return;
		}
		const activeDocument = vscode.window.activeTextEditor?.document;
		if (document !== activeDocument) {
			return;
		}
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}

		const lastChange = contentChanges[contentChanges.length - 1];

		doAutoInsert(document, lastChange, async (document, position, lastChange) => {

			const params = {
				...htmlClient.code2ProtocolConverter.asTextDocumentPositionParams(document, position),
				options: {
					lastChange: {
						...lastChange,
						range: htmlClient.code2ProtocolConverter.asRange(lastChange.range),
					},
				},
			};

			const result = await htmlClient.sendRequest(AutoInsertRequest.type, params)
				?? await tsClient.sendRequest(AutoInsertRequest.type, params);

			if (typeof result === 'string') {
				return result;
			}
			else {
				return htmlClient.protocol2CodeConverter.asTextEdit(result);
			}
		});
	}

	function doAutoInsert(
		document: vscode.TextDocument,
		lastChange: vscode.TextDocumentContentChangeEvent,
		provider: (document: vscode.TextDocument, position: vscode.Position, lastChange: vscode.TextDocumentContentChangeEvent) => Thenable<string | vscode.TextEdit | null | undefined>,
	) {
		const rangeStart = lastChange.range.start;
		const version = document.version;
		timeout = setTimeout(() => {
			const position = new vscode.Position(rangeStart.line, rangeStart.character + lastChange.text.length);
			provider(document, position, lastChange).then(text => {
				if (text && isEnabled) {
					const activeEditor = vscode.window.activeTextEditor;
					if (activeEditor) {
						const activeDocument = activeEditor.document;
						if (document === activeDocument && activeDocument.version === version) {
							if (typeof text === 'string') {
								const selections = activeEditor.selections;
								if (selections.length && selections.some(s => s.active.isEqual(position))) {
									activeEditor.insertSnippet(new vscode.SnippetString(text), selections.map(s => s.active));
								} else {
									activeEditor.insertSnippet(new vscode.SnippetString(text), position);
								}
							}
							else {
								activeEditor.insertSnippet(new vscode.SnippetString(text.newText), text.range);
							}
						}
					}
				}
			});
			timeout = undefined;
		}, 100);
	}

	return vscode.Disposable.from(...disposables);
}
