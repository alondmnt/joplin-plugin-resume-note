import joplin from 'api';
import { SettingItemType, MenuItemLocation, ContentScriptType } from 'api/types';

// In-memory map
let currentFolderId: string = '';
let currentNoteId: string = '';
let folderNoteMap: Record<string, string> = {};
let noteCursorMap: Record<string, { line: number, ch: number }> = {};

// Function to update cursor position
async function updateCursorPosition(): Promise<void> {
	if (!currentNoteId) return;

	const cursor = await joplin.commands.execute('editor.execCommand', {
		name: 'getCursor'
	});

	if (cursor) {
		noteCursorMap[currentNoteId] = cursor;
	}
}

joplin.plugins.register({
	onStart: async function() {
		// Register the setting
		await joplin.settings.registerSection('stickynote', {
			label: 'Sticky Note',
			iconName: 'fas fa-sticky-note',
		});
		await joplin.settings.registerSettings({
			'stickynote.folderNoteMap': {
				value: '{}',
				type: SettingItemType.String,
				public: false,
				section: 'stickynote',
				label: 'Folder Note Map',
			},
			'stickynote.lastNoteId': {
				value: '',
				type: SettingItemType.String,
				public: false,
				section: 'stickynote',
				label: 'Default Note ID',
			},
			'stickynote.homeNoteId': {
				value: '',
				type: SettingItemType.String,
				public: true,
				section: 'stickynote',
				label: 'Home note ID',
			},
			'stickynote.refreshInterval': {
				value: 2000,
				type: SettingItemType.Int,
				public: true,
				section: 'stickynote',
				label: 'Cursor position refresh interval (ms)',
				description: 'How often to save the cursor position (in milliseconds). Requires a restart.',
				minimum: 1000,
				maximum: 10000,
			},
		});

		// Register the command
		await joplin.commands.register({
			name: 'stickynote.setHomeNote',
			label: 'Set as Home Note',
			execute: async () => {
				const note = await joplin.workspace.selectedNote();
				if (note) {
					await joplin.settings.setValue('stickynote.homeNoteId', note.id);
					await joplin.views.dialogs.showMessageBox('Current note set as Home Note');
				}
			},
		});
		await joplin.commands.register({
			name: 'stickynote.resetHomeNote',
			label: 'Reset Home Note',
			execute: async () => {
				await joplin.settings.setValue('stickynote.homeNoteId', '');
				await joplin.views.dialogs.showMessageBox('Home Note reset');
			},
		});

		// Add commands to Note menu
		await joplin.views.menuItems.create(
			'stickynote.setHomeNoteMenuItem',
			'setHomeNote',
			MenuItemLocation.Note
		);
		await joplin.views.menuItems.create(
			'stickynote.resetHomeNoteMenuItem',
			'resetHomeNote',
			MenuItemLocation.Note
		);

		// Register the content script
    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
    'cursorTracker',
    './cursorTracker.js'
    );

		// Load the saved map on startup
		const mapJson = await joplin.settings.value('stickynote.folderNoteMap');
		folderNoteMap = JSON.parse(mapJson);

		// Initialize with current note and folder
		const lastNoteId = await joplin.settings.value('stickynote.lastNoteId');
		const homeNoteId = await joplin.settings.value('stickynote.homeNoteId');
		if (homeNoteId) {
			await joplin.commands.execute('openNote', homeNoteId);
		} else if (lastNoteId) {
			await joplin.commands.execute('openNote', lastNoteId);
		}

		// Periodic cursor position update
		setInterval(updateCursorPosition, await joplin.settings.value('stickynote.refreshInterval'));

		// Update cursor position on note selection change
		await joplin.workspace.onNoteSelectionChange(async () => {
			const note = await joplin.workspace.selectedNote();
			if (!note) return;

			currentNoteId = note.id;
			const newFolderId = note.parent_id;

			// Update the last note ID
			await joplin.settings.setValue('stickynote.lastNoteId', currentNoteId);

			if (newFolderId !== currentFolderId) {
        currentFolderId = newFolderId;

				// Check if we have a saved note for the new folder
				const savedNoteId = folderNoteMap[newFolderId];
				if (savedNoteId) {
					// Navigate to the saved note
						await joplin.commands.execute('openNote', savedNoteId);
				}

			} else {
				// Update both in-memory map and settings
				await updateFolderNoteMap(currentFolderId, currentNoteId);
			}

			// If we have a saved cursor position for this note, restore it
			const savedCursor = noteCursorMap[currentNoteId];
			if (savedCursor) {
        await joplin.commands.execute('editor.focus');
        await new Promise(resolve => setTimeout(resolve, 100));
        await joplin.commands.execute('editor.execCommand', {
          name: 'setCursor',
          args: [savedCursor]
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await joplin.commands.execute('editor.execCommand', {
          name: 'scrollIntoView',
          args: [savedCursor.line, savedCursor.ch]
        });
			}
		});

		// Also initialize both currentNoteId and currentFolderId in onStart
		currentNoteId = await joplin.workspace.selectedNote().then(note => note.id);
		if (currentNoteId) {
			currentFolderId = await joplin.workspace.selectedNote().then(note => note.parent_id);
		}
	},
});

// Helper function to update both the in-memory map and settings
async function updateFolderNoteMap(folderId: string, noteId: string): Promise<void> {
	// Update in-memory object
	folderNoteMap[folderId] = noteId;
	
	// Update settings (can now stringify directly)
	await joplin.settings.setValue('stickynote.folderNoteMap', JSON.stringify(folderNoteMap));
}
