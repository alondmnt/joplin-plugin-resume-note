import joplin from 'api';
import { SettingItemType, MenuItemLocation, ContentScriptType, ModelType } from 'api/types';

// In-memory map
let currentFolderId: string = '';
let currentNoteId: string = '';
let folderNoteMap: Record<string, string> = {};
let noteCursorMap: Record<string, CursorPosition> = {};
let useUserData: boolean = false;
let saveSelection: boolean = true;

interface CursorPosition {
	line: number;
	ch: number;
	scroll: number;
}

joplin.plugins.register({
	onStart: async function() {
		// Register the settings section and settings
		await joplin.settings.registerSection('resumenote', {
			label: 'Resume Note',
			iconName: 'fas fa-i-cursor',
		});
		await joplin.settings.registerSettings({
			'resumenote.folderNoteMap': {
				value: '{}',
				type: SettingItemType.String,
				public: false,
				section: 'resumenote',
				label: 'Folder Note Map',
			},
			'resumenote.lastNoteId': {
				value: '',
				type: SettingItemType.String,
				public: false,
				section: 'resumenote',
				label: 'Default Note ID',
			},
			'resumenote.homeNoteId': {
				value: '',
				type: SettingItemType.String,
				public: true,
				section: 'resumenote',
				label: 'Home note ID',
			},
			'resumenote.refreshInterval': {
				value: 2000,
				type: SettingItemType.Int,
				public: true,
				section: 'resumenote',
				label: 'Cursor position refresh interval (ms)',
				description: 'How often to save the cursor position (in milliseconds). Requires restart.',
				minimum: 1000,
				maximum: 10000,
			},
			'resumenote.saveSelection': {
				value: true,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: 'Save cursor selection',
				description: 'Save the selected text in the cursor position.',
			},
			'resumenote.useUserData': {
				value: false,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: 'Sync data using note properties (Experimental)',
				description: 'Store folder and cursor data using note properties instead of settings. Data will sync across devices and be retained after restart. Requires restart.',
			},
		});

		// Register commands
		await joplin.commands.register({
			name: 'resumenote.setHomeNote',
			label: 'Set as home note',
			execute: async () => {
				const note = await joplin.workspace.selectedNote();
				if (note) {
					await joplin.settings.setValue('resumenote.homeNoteId', note.id);
					await joplin.views.dialogs.showMessageBox('Current note set as home note');
				}
			},
		});
		await joplin.commands.register({
			name: 'resumenote.resetHomeNote',
			label: 'Reset home note',
			execute: async () => {
				await joplin.settings.setValue('resumenote.homeNoteId', '');
				await joplin.views.dialogs.showMessageBox('Home note reset');
			},
		});

		// Add commands to Note menu
		await joplin.views.menuItems.create(
			'resumenote.setHomeNoteMenuItem',
			'resumenote.setHomeNote',
			MenuItemLocation.Note
		);
		await joplin.views.menuItems.create(
			'resumenote.resetHomeNoteMenuItem',
			'resumenote.resetHomeNote',
			MenuItemLocation.Note
		);

		// Register the content script
    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
    'cursorTracker',
    './cursorTracker.js'
    );

    // Load the useUserData setting
    useUserData = await joplin.settings.value('resumenote.useUserData');
		saveSelection = await joplin.settings.value('resumenote.saveSelection');

		// Load the saved map on startup
		const mapJson = await joplin.settings.value('resumenote.folderNoteMap');
		folderNoteMap = JSON.parse(mapJson);

		// Initialize with current note and folder
		const lastNoteId = await joplin.settings.value('resumenote.lastNoteId');
		const homeNoteId = await joplin.settings.value('resumenote.homeNoteId');
		if (homeNoteId) {
			await joplin.commands.execute('openNote', homeNoteId);
      setTimeout(async () => {
        await restoreCursorPosition(homeNoteId);
      }, 500);

		} else if (lastNoteId) {
			await joplin.commands.execute('openNote', lastNoteId);
      setTimeout(async () => {
        await restoreCursorPosition(lastNoteId);
      }, 500);
		}

		// Periodic cursor position update
		setInterval(updateCursorPosition, await joplin.settings.value('resumenote.refreshInterval'));

		// Update cursor position on note selection change
		await joplin.workspace.onNoteSelectionChange(async () => {
			const note = await joplin.workspace.selectedNote();
			if (!note) return;

			currentNoteId = note.id;
			const newFolderId = note.parent_id;

			// Update the last note ID
			await joplin.settings.setValue('resumenote.lastNoteId', currentNoteId);

			if (newFolderId !== currentFolderId) {
        currentFolderId = newFolderId;

				// Check if we have a saved note for the new folder
				const savedNoteId = await loadFolderNoteMap(newFolderId);
				if (savedNoteId) {
					// Navigate to the saved note
						await joplin.commands.execute('openNote', savedNoteId);
				}

			} else {
				// Update both in-memory map and settings
				await updateFolderNoteMap(currentFolderId, currentNoteId);
			}

			// If we have a saved cursor position for this note, restore it
			await restoreCursorPosition(currentNoteId);
		});

		// Update saveSelection when it changes
		await joplin.settings.onChange(async (event: any) => {
			if (event.keys.includes('resumenote.saveSelection')) {
				saveSelection = await joplin.settings.value('resumenote.saveSelection');
			}
		});

		// Also initialize both currentNoteId and currentFolderId in onStart
		currentNoteId = await joplin.workspace.selectedNote().then(note => note.id);
		if (currentNoteId) {
			currentFolderId = await joplin.workspace.selectedNote().then(note => note.parent_id);
		}
	},
});

// Helper functions to update / load both the in-memory map, settings and user data
async function updateFolderNoteMap(folderId: string, noteId: string): Promise<void> {  
  if (useUserData) {
    // Store in userData
		await joplin.data.userDataSet(ModelType.Folder, folderId, `note`, noteId);

	} else {
    // Update in-memory object
    folderNoteMap[folderId] = noteId;
    // Update settings
		await joplin.settings.setValue('resumenote.folderNoteMap', JSON.stringify(folderNoteMap));
	}
}

async function loadFolderNoteMap(folderId: string): Promise<string> {
  let noteId: string;
  if (useUserData) {
    // Load from userData
    noteId = await joplin.data.userDataGet(ModelType.Folder, folderId, `note`);
  } else {
    // Load from settings / memory
    noteId = folderNoteMap[folderId];
  }
  return noteId;
}

// Functions to handle cursor position
async function updateCursorPosition(): Promise<void> {
	if (!currentNoteId) return;

	const cursor = await joplin.commands.execute('editor.execCommand', {
		name: 'rn.getCursorAndScroll'
	});
	if (!saveSelection) {
		cursor.selection = null;
	}

	if (cursor) {
		noteCursorMap[currentNoteId] = cursor;
		
		// Add userData storage if enabled
		if (useUserData) {
			await joplin.data.userDataSet(ModelType.Note, currentNoteId, 'cursor', cursor);
		}
	}
}

async function loadCursorPosition(noteId: string): Promise<CursorPosition | undefined> {
  // Load from userData
	if (useUserData) {
		const savedCursor: CursorPosition = await joplin.data.userDataGet(ModelType.Note, currentNoteId, 'cursor');
		return savedCursor;
	}
  // Load from memory
	return noteCursorMap[noteId];
}

async function restoreCursorPosition(noteId: string): Promise<void> {
	const savedCursor = await loadCursorPosition(noteId);
	if (savedCursor) {
		await joplin.commands.execute('editor.focus');
		await new Promise(resolve => setTimeout(resolve, 100));
		await joplin.commands.execute('editor.execCommand', {
			name: 'rn.setCursor',
			args: [ savedCursor ]
		});
		await new Promise(resolve => setTimeout(resolve, 100));
		await joplin.commands.execute('editor.execCommand', {
			name: 'rn.setScroll',
			args: [ savedCursor ]
		});
	}
}