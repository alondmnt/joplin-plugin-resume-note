import joplin from 'api';
import { SettingItemType, MenuItemLocation, ContentScriptType, ModelType, ToolbarButtonLocation } from 'api/types';

// In-memory map
let currentFolderId: string = '';
let currentNoteId: string = '';
let folderNoteMap: Record<string, string> = {};
let noteCursorMap: Record<string, CursorPosition> = {};
let saveFolderNote: boolean = true;
let useUserData: boolean = false;
let saveSelection: boolean = true;
let restoreDelay: number = 300;
let noteNotLoaded: boolean = true;

interface CursorPosition {
	line: number;
	ch: number;
	scroll: number;
}

// Get the version of Joplin
let versionInfo = {
	toggleEditorSupport: null,
};

async function initializeVersionInfo() {
	const version = await joplin.versionInfo();
	versionInfo.toggleEditorSupport = 
		version.platform === 'mobile' && 
		parseInt(version.version.split('.')[0]) >= 3 && 
		parseInt(version.version.split('.')[1]) >= 2;
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
			'resumenote.saveFolderNote': {
				value: true,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: 'Save the last active note in each folder. Requires restart.',
			},
			'resumenote.noteCursorMap': {
				value: '{}',
				type: SettingItemType.String,
				public: false,
				section: 'resumenote',
				label: 'Note Cursor Map',
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
			'resumenote.startHomeNote': {
				value: true,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: 'Go to home note on startup',
			},
			'resumenote.refreshInterval': {
				value: 2000,
				type: SettingItemType.Int,
				public: true,
				section: 'resumenote',
				label: 'Refresh interval for saving cursor and scroll position (ms)',
				description: 'How often to save the cursor and scroll position (in ms). Requires restart.',
				minimum: 500,
				maximum: 10000,
				step: 100,
			},
			'resumenote.restoreDelay': {
				value: 300,
				type: SettingItemType.Int,
				public: true,
				section: 'resumenote',
				label: 'Delay before setting cursor and scroll position (in ms)',
				description: 'Delay before setting the cursor and scroll position after opening a note in the editor.',
				minimum: 0,
				maximum: 2000,
				step: 50,
			},
			'resumenote.startupDelay': {
				value: 1000,
				type: SettingItemType.Int,
				public: true,
				section: 'resumenote',
				label: 'Delay before starting the plugin (in ms)',
				description: 'Delay after Joplin starts before the plugin is activated.',
				minimum: 0,
				maximum: 10000,
				step: 50,
			},
			'resumenote.toggleEditor': {
				value: true,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: '(Mobile app) Switch to the Markdown editor on note selection',
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
				description: 'Store folder and cursor data using note properties instead of app settings. Data will sync across devices. When disabled, all data will be cleared from the note properties.',
			},
		});

		// Register commands
		await joplin.commands.register({
			name: 'resumenote.clearUserData',
			label: 'Clear Resume Note user data',
			execute: async () => {
				folderNoteMap = {};
				noteCursorMap = {};
				await clearUserData();
			},
		});
		await joplin.commands.register({
			name: 'resumenote.clearSettingsData',
			label: 'Clear Resume Note settings data',
			execute: async () => {
				folderNoteMap = {};
				noteCursorMap = {};
				await clearSettingsData();
			},
		});
		await joplin.commands.register({
			name: 'resumenote.setHomeNote',
			label: 'Set as home note',
			execute: async () => {
				let note = await joplin.workspace.selectedNote();
				if (note) {
					await joplin.settings.setValue('resumenote.homeNoteId', note.id);
					await joplin.views.dialogs.showMessageBox('Current note set as home note');
				}
				note = clearObjectReferences(note);
			},
		});
		await joplin.commands.register({
			name: 'resumenote.goToHomeNote',
			label: 'Go to home note',
			iconName: 'fas fa-home',
			execute: async () => {
				const homeNoteId = await joplin.settings.value('resumenote.homeNoteId');
				if (homeNoteId) {
					await joplin.commands.execute('openNote', homeNoteId);
					// Repeat twice, to ensure that we don't switch to a different note
					if (!versionInfo.toggleEditorSupport) {
						setTimeout(async () => {
							await joplin.commands.execute('openNote', homeNoteId);
						}, 2*restoreDelay);
					}
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
			'resumenote.goToHomeNoteMenuItem',
			'resumenote.goToHomeNote',
			MenuItemLocation.Note
		);
		await joplin.views.menuItems.create(
			'resumenote.resetHomeNoteMenuItem',
			'resumenote.resetHomeNote',
			MenuItemLocation.Note
		);

		const startupDelay = await joplin.settings.value('resumenote.startupDelay');
		await new Promise(resolve => setTimeout(resolve, startupDelay));

		await initializeVersionInfo();

		// Register the content script
		await joplin.contentScripts.register(
		ContentScriptType.CodeMirrorPlugin,
		'cursorTracker',
		'./cursorTracker.js'
		);

		// Load the useUserData setting
		saveFolderNote = await joplin.settings.value('resumenote.saveFolderNote');
		useUserData = await joplin.settings.value('resumenote.useUserData');
		saveSelection = await joplin.settings.value('resumenote.saveSelection');
		restoreDelay = await joplin.settings.value('resumenote.restoreDelay');

		// Load the saved map on startup
		if (!useUserData) {
			if (saveFolderNote) {
				folderNoteMap = JSON.parse(await joplin.settings.value('resumenote.folderNoteMap'));
			}
			noteCursorMap = JSON.parse(await joplin.settings.value('resumenote.noteCursorMap'));
		}

		// Initialize with current note and folder
		const lastNoteId = await joplin.settings.value('resumenote.lastNoteId');
		const homeNoteId = await joplin.settings.value('resumenote.homeNoteId');
		const goToHomeNoteOnStartup = await joplin.settings.value('resumenote.startHomeNote');
		if (homeNoteId) {
			await joplin.views.toolbarButtons.create(
				'resumenote.goToHomeNoteToolbarButton',
				'resumenote.goToHomeNote',
				ToolbarButtonLocation.NoteToolbar
			);
		}
		const toggleEditor = await joplin.settings.value('resumenote.toggleEditor');
		if (homeNoteId && goToHomeNoteOnStartup) {
			await joplin.commands.execute('openNote', homeNoteId);
			if (versionInfo.toggleEditorSupport) {
			}
			setTimeout(async () => {
				if (toggleEditor) {
					await joplin.commands.execute('toggleVisiblePanes');
				}
				await restoreCursorPosition(homeNoteId);
			}, 2*restoreDelay);

		} else if (lastNoteId) {
			await joplin.commands.execute('openNote', lastNoteId);
			setTimeout(async () => {
				if (toggleEditor) {
					await joplin.commands.execute('toggleVisiblePanes');
				}
				await restoreCursorPosition(lastNoteId);
			}, 2*restoreDelay);
		}

		// Periodic cursor position update
		setInterval(updateCursorPosition, await joplin.settings.value('resumenote.refreshInterval'));

		// Update cursor position on note selection change
		await joplin.workspace.onNoteSelectionChange(async () => {
			noteNotLoaded = true;
			let note = await joplin.workspace.selectedNote();
			if (!note) return;
			if (versionInfo.toggleEditorSupport) {
				// Wait for the note to be opened for 100 ms
				await new Promise(resolve => setTimeout(resolve, 100));
				const toggleEditor = await joplin.settings.value('resumenote.toggleEditor');
				if (toggleEditor) {
					await joplin.commands.execute('toggleVisiblePanes');
				}
			}
			currentNoteId = note.id;
			const newFolderId = note.parent_id;
			note = clearObjectReferences(note);

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

		// Update settings
		await joplin.settings.onChange(async (event: any) => {
			if (event.keys.includes('resumenote.saveSelection')) {
				saveSelection = await joplin.settings.value('resumenote.saveSelection');
			}
			if (event.keys.includes('resumenote.restoreDelay')) {
				restoreDelay = await joplin.settings.value('resumenote.restoreDelay');
			}
			if (event.keys.includes('resumenote.useUserData')) {
				useUserData = await joplin.settings.value('resumenote.useUserData');
				if (!useUserData) {
					await clearUserData();
				} else {
					await clearSettingsData();
				}
			}
		});

		// Initialize both currentNoteId and currentFolderId in onStart
		let note = await joplin.workspace.selectedNote();
		if (note) {
			currentFolderId = note.parent_id;
			currentNoteId = note.id;
		}
		note = clearObjectReferences(note);
	},
});

// Helper functions to update / load both the in-memory map, settings and user data
async function updateFolderNoteMap(folderId: string, noteId: string): Promise<void> {  
	if (!saveFolderNote) return;
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
	if (!saveFolderNote) return '';
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
	if (noteNotLoaded) return;

    // Check if we're in code view
    const isCodeView = await joplin.settings.globalValue('editor.codeView');
    if (!isCodeView) return;  // Only proceed if in code view

	const cursor = await joplin.commands.execute('editor.execCommand', {
		name: 'rn.getCursorAndScroll'
	});
	if (!saveSelection) {
		cursor.selection = null;
	}

	if (cursor) {
		// Update in-memory object
		noteCursorMap[currentNoteId] = cursor;
		
		// Add userData storage if enabled
		if (useUserData) {
			await joplin.data.userDataSet(ModelType.Note, currentNoteId, 'cursor', cursor);
		} else {
			// Update settings
			await joplin.settings.setValue('resumenote.noteCursorMap', JSON.stringify(noteCursorMap));
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
		await new Promise(resolve => setTimeout(resolve, restoreDelay));
		await joplin.commands.execute('editor.execCommand', {
			name: 'rn.setCursor',
			args: [ { line: savedCursor.scroll, ch: 1, selection: 0 } ]
		});
		await joplin.commands.execute('editor.execCommand', {
			name: 'rn.setScroll',
			args: [ savedCursor ]
		});
		await joplin.commands.execute('editor.execCommand', {
			name: 'rn.setCursor',
			args: [ savedCursor ]
		});
	}
	noteNotLoaded = false;
}

// Clear all note / folder properties
async function clearUserData(): Promise<void> {
	let hasMore = true;
	let page = 1;
	while (hasMore) {
		const notes = await joplin.data.get(['notes'], {
			fields: ['id'],
			page: page++,
		});
		hasMore = notes.has_more;
		for (const note of notes.items) {
			// Only delete if the property exists
			const savedCursor: any = await joplin.data.userDataGet(ModelType.Note, note.id, 'cursor');
			if (savedCursor !== undefined) {
				await joplin.data.userDataDelete(ModelType.Note, note.id, 'cursor');
			}
		}
		clearObjectReferences(notes);
	}
	hasMore = true;
	page = 1;
	while (hasMore) {
		const folders = await joplin.data.get(['folders'], {
			fields: ['id'],
			page: page++,
		});
		hasMore = folders.has_more;
		for (const folder of folders.items) {
			// Only delete if the property exists
			const savedNoteId: any = await joplin.data.userDataGet(ModelType.Folder, folder.id, 'note');
			if (savedNoteId !== undefined) {
				await joplin.data.userDataDelete(ModelType.Folder, folder.id, 'note');
			}
		}
		clearObjectReferences(folders);
	}
}

// Clear folderNoteMap and noteCursorMap in settings
async function clearSettingsData(): Promise<void> {
	await joplin.settings.setValue('resumenote.folderNoteMap', '{}');
	await joplin.settings.setValue('resumenote.noteCursorMap', '{}');
}

export function clearObjectReferences(obj: any): null {
	if (!obj) { return null; }

	// Remove references to object properties
	for (const prop in obj) {
		obj[prop] = null;
	}
	obj = null;

	return null;
}