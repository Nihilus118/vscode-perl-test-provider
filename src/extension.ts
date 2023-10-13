import * as vscode from 'vscode';
import { testData, TestFile } from './testTree';
import { failedRe } from './parser';
import { spawnSync } from 'child_process';
import { basename, dirname } from 'path';

export async function activate(context: vscode.ExtensionContext) {
	const ctrl = vscode.tests.createTestController('perl', 'Perl');
	context.subscriptions.push(ctrl);

	const fileChangedEmitter = new vscode.EventEmitter<vscode.Uri>();

	const runHandler = (request: vscode.TestRunRequest) => {
		const fileUri = request.include![0].uri!;
		const buffer = spawnSync(`perl`, [basename(fileUri.fsPath)], { cwd: dirname(fileUri.fsPath) });
		if (buffer.error) {
			console.error(`Buffer: ${buffer.error}`);
			return;
		}
		const result = buffer.stderr
			.toString()
			.split(/\r?\n/)
			.filter((v) => { return v !== ''; })
			.slice(-1)[0] || '';
		if (result.trim().match(failedRe)) {
			// failed
			console.log('failed');
		} else {
			// passed
			console.log('passed');
		}
	};

	const debugHandler = (request: vscode.TestRunRequest) => {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(request.include![0].uri!);
		const fileUri = request.include![0].uri!;
		const debugConfig: vscode.DebugConfiguration = {
			name: 'Debug Test',
			type: 'perl',
			request: 'launch',
			program: fileUri.fsPath,
			cwd: dirname(fileUri.fsPath)
		};
		vscode.debug.startDebugging(workspaceFolder, debugConfig);
	};

	ctrl.refreshHandler = async () => {
		await Promise.all(getWorkspaceTestPatterns().map(({ pattern }) => findInitialFiles(ctrl, pattern)));
	};

	ctrl.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runHandler, true);

	ctrl.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, debugHandler, false);

	ctrl.resolveHandler = async item => {
		if (!item) {
			context.subscriptions.push(...startWatchingWorkspace(ctrl, fileChangedEmitter));
			return;
		}

		const data = testData.get(item);
		if (data instanceof TestFile) {
			await data.updateFromDisk(ctrl, item);
		}
	};

	function updateNodeForDocument(e: vscode.TextDocument) {
		if (e.uri.scheme !== 'file') {
			return;
		}

		if (!e.uri.path.endsWith('.pl')) {
			return;
		}

		const { file, data } = getOrCreateFile(ctrl, e.uri);
		data.updateFromContents(ctrl, e.getText(), file);
	}

	for (const document of vscode.workspace.textDocuments) {
		updateNodeForDocument(document);
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateNodeForDocument),
		vscode.workspace.onDidChangeTextDocument(e => updateNodeForDocument(e.document)),
	);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
	const existing = controller.items.get(uri.toString());
	if (existing) {
		return { file: existing, data: testData.get(existing) as TestFile };
	}

	const file = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);
	controller.items.add(file);

	const data = new TestFile();
	testData.set(file, data);

	file.canResolveChildren = true;
	return { file, data };
}

function getWorkspaceTestPatterns() {
	if (!vscode.workspace.workspaceFolders) {
		return [];
	}

	return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
		workspaceFolder,
		pattern: new vscode.RelativePattern(workspaceFolder, '**/*.pl'),
	}));
}

async function findInitialFiles(controller: vscode.TestController, pattern: vscode.GlobPattern) {
	for (const file of await vscode.workspace.findFiles(pattern)) {
		getOrCreateFile(controller, file);
	}
}

function startWatchingWorkspace(controller: vscode.TestController, fileChangedEmitter: vscode.EventEmitter<vscode.Uri>) {
	return getWorkspaceTestPatterns().map(({ pattern }) => {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidCreate(uri => {
			getOrCreateFile(controller, uri);
			fileChangedEmitter.fire(uri);
		});
		watcher.onDidChange(async uri => {
			const { file, data } = getOrCreateFile(controller, uri);
			if (data.didResolve) {
				await data.updateFromDisk(controller, file);
			}
			fileChangedEmitter.fire(uri);
		});
		watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

		findInitialFiles(controller, pattern);

		return watcher;
	});
}
