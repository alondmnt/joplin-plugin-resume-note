import type { ContentScriptContext } from 'api/types';
import { EditorView } from '@codemirror/view';

module.exports = {
	default: function(context: ContentScriptContext) { 
		return {
			plugin: function(CodeMirror: any) {
				if (!CodeMirror.cm6) { return; }

				CodeMirror.registerCommand('rn.getCursorAndScroll', function() {
					const cm: EditorView = CodeMirror.editor;
					// Cursor position
					const selection = cm.state.selection.main;
					const startPos = selection.anchor;
					const endPos = selection.head;
					// Convert the absolute position to line and character
					const line = cm.state.doc.lineAt(startPos);

					// Scroll position
					const rect = cm.scrollDOM.getBoundingClientRect();
					const scrollPos = cm.posAtCoords({ x: rect.left + 5, y: rect.top }) || 0;
					const scrollLine = cm.state.doc.lineAt(scrollPos);

					const result = {
						line: line.number,
						ch: startPos - line.from,
						scroll: scrollLine.number,
						selection: endPos - startPos,
					};
					return result;
				});

				CodeMirror.registerCommand('rn.setCursor', function(message: any) {
					const cm: EditorView = CodeMirror.editor;
					const { line, ch, scroll, selection } = message;
					const lineInfo = cm.state.doc.line(line);
					// Calculate the exact position by adding the character offset to the line start
					const pos = lineInfo.from + ch;	
					cm.dispatch({
						selection: { anchor: pos, head: selection ? pos + selection : pos },
						scrollIntoView: true,
					});
				});

				CodeMirror.registerCommand('rn.setScroll', function(message: any) {
					const cm = CodeMirror.editor;
					const { line, ch, scroll } = message;

					// Validate line number
					let lineNumber = Math.max(1, scroll || line || 1);
					const lineCount = cm.state.doc.lines;
					if (lineNumber > lineCount) {
						lineNumber = lineCount;
					}

					// Get the position at the start of the line
					const linePos = cm.state.doc.line(lineNumber).from;

					// Get the coordinates of the position
					const coords = cm.coordsAtPos(linePos);

					if (coords) {
						// Calculate the scroll position
						const scrollTop = coords.top - cm.scrollDOM.getBoundingClientRect().top + cm.scrollDOM.scrollTop;
				
						// Scroll the editor
						cm.scrollDOM.scrollTo({
							top: scrollTop,
							behavior: 'auto'
						});
					} else {
						console.error('Could not get coordinates for position', linePos);
					}
				});				
			},
			codeMirrorOptions: {},
		}
	},
}