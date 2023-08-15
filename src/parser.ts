import * as vscode from 'vscode';

const headingRe = /^(use)\s+(Test).*;/;
export const failedRe = /# Looks like you failed \d+ tests? of \d+\./;

export const parsePerl = (text: string, events: {
	onHeading(range: vscode.Range, name: string, depth: number): void;
}) => {
	const lines = text.split('\n');

	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const line = lines[lineNo];
		const heading = headingRe.exec(line);
		if (heading) {
			const [, pounds, name] = heading;
			const range = new vscode.Range(new vscode.Position(lineNo, 0), new vscode.Position(lineNo, line.length));
			events.onHeading(range, name, pounds.length);
		}
	}
};
