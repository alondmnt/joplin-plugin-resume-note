import { EditorView } from '@codemirror/view';

module.exports = {
	default: function(context) { 
		return {
			plugin: function(CodeMirror) {
				// Handle messages from the main process
				context.onMessage(async (message: any) => {
					if (message.name === 'getCursor') {
						const cm: EditorView = CodeMirror.editor;
						const selection = cm.state.selection.main;
						const pos = selection.head;
						// Convert the absolute position to line and character
						const line = cm.state.doc.lineAt(pos);
						return {
							line: line.number,
							ch: pos - line.from
						};
					}
					if (message.name === 'setCursor') {
						const cm: EditorView = CodeMirror.editor;
						const { line, ch } = message;
						// Get the line info
						const lineInfo = cm.state.doc.line(line);
						// Calculate the exact position by adding the character offset to the line start
						const pos = lineInfo.from + ch;
						
            cm.requestMeasure();
						cm.dispatch({
              selection: { anchor: pos },
						});

						return true;
					}
          if (message.name === 'scrollIntoView') {
            const cm: EditorView = CodeMirror.editor;
            const { line, ch } = message;
            const pos = cm.state.doc.line(line).from + ch;
            cm.dispatch({
              effects: EditorView.scrollIntoView(pos, {
                y: 'start',
                x: 'start'
              })
						});

            return true;
					}
					return null;
				});
			},
			codeMirrorOptions: {},
		}
	},
} 