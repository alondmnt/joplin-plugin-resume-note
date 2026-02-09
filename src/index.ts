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
// dictates if scroll/cursor positions are being saved into memory in a loop
let noteLoaded: boolean = false;
let restoreTimeout: ReturnType<typeof setTimeout> | null = null;
let lastRecordedNoteId: string = '';
let lastRecordedFolderId: string = '';
let beforeLastRecordedFolderId: string = '';

interface CursorPosition {
	line: number;
	ch: number;
	scroll: number;
}

// Get the version of Joplin
let versionInfo = {
	mobile: null
};

async function initializeVersionInfo() {
	const version = await joplin.versionInfo();
	versionInfo.mobile = version.platform === 'mobile';
}

joplin.plugins.register({
	onStart: async function() {
		await initializeVersionInfo();

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
				value: versionInfo.mobile ? false : true,
				type: SettingItemType.Bool,
				public: true,
				section: 'resumenote',
				label: 'Save the last active note in each folder. Requires restart.',
				description: 'This setting is not yet supported on mobile devices.',
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
				description: 'Accepts a raw note ID or a Joplin markdown link, e.g., [Title](:/noteId).',
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
				description: 'Delay before setting the cursor and scroll position after opening a note in the editor. You might want to increase it if you often see that plugin performs restore correctly, but something overwrites it right after.',
				minimum: 0,
				maximum: 10000,
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
				const homeNoteId = parseNoteId(await joplin.settings.value('resumenote.homeNoteId'));
				if (homeNoteId && homeNoteId !== currentNoteId) {
					try {
						await joplin.commands.execute('openNote', homeNoteId);
					} catch (error) {
						await joplin.views.dialogs.showMessageBox(`Home note not found (ID: ${homeNoteId}). Please check the home note setting.`);
						return;
					}
					// Repeat twice, to ensure that we don't switch to a different note
					if (!versionInfo.mobile) {
						setTimeout(async () => {
							try {
								await joplin.commands.execute('openNote', homeNoteId);
							} catch (error) {
								console.debug(`Go to home note (retry) [Failed]. Note ID: ${homeNoteId}. Error: ${error}`);
							}
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

		// Register the content script
		await joplin.contentScripts.register(
		ContentScriptType.CodeMirrorPlugin,
		'cursorTracker',
		'./cursorTracker.js'
		);

		// Load the useUserData setting
		saveFolderNote = versionInfo.mobile ? false : await joplin.settings.value('resumenote.saveFolderNote');
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
		const homeNoteId = parseNoteId(await joplin.settings.value('resumenote.homeNoteId'));
		const goToHomeNoteOnStartup = await joplin.settings.value('resumenote.startHomeNote');
		if (homeNoteId) {
			const homeNoteButtonLocation = (versionInfo.mobile) ? ToolbarButtonLocation.EditorToolbar : ToolbarButtonLocation.NoteToolbar;
			await joplin.views.toolbarButtons.create(
				'resumenote.goToHomeNoteToolbarButton',
				'resumenote.goToHomeNote',
				homeNoteButtonLocation
			);
		}
		const toggleEditor = await joplin.settings.value('resumenote.toggleEditor');
		let startupNote = (homeNoteId && goToHomeNoteOnStartup) ? homeNoteId : lastNoteId;
		if (startupNote) {
			let startupNoteOpened = false;
			try {
				await joplin.commands.execute('openNote', startupNote);
				startupNoteOpened = true;
			} catch (error) {
				if (startupNote === homeNoteId) {
					await joplin.views.dialogs.showMessageBox(`Home note not found (ID: ${startupNote}). Please check the home note setting.`);
				} else {
					console.debug(`Open startup note [Failed]. Note ID: ${startupNote}. Error: ${error}`);
				}
			}
			if (startupNoteOpened) setTimeout(async () => {
				if (!versionInfo.mobile) {
					// We're not in the mobile app
					noteLoaded = await restoreCursorPosition(startupNote);
					return;
				}
				// We're in the mobile app
				if (toggleEditor) {
					try {
						await joplin.commands.execute('toggleVisiblePanes');
					} catch (error) {
						console.debug(`Toggle editor on startup [Failed]. Error: ${error}`);
					}
					noteLoaded = await restoreCursorPosition(startupNote);
				}
			}, 3*restoreDelay);
		}

		// Periodic cursor position update
		setInterval(updateCursorPosition, await joplin.settings.value('resumenote.refreshInterval'));

		// Update cursor position on note selection change
		await joplin.workspace.onNoteSelectionChange(async () => {
			console.debug("On Note Selection Change [In Progress].");
			let note = await joplin.workspace.selectedNote();
			let folder = await joplin.workspace.selectedFolder();

			if (lastRecordedNoteId === note?.id) {
				console.debug("On Note Selection Change [Cancel]. Reason: Duplicated execution. Note ID: " + lastRecordedNoteId);
				return;
			}

			lastRecordedNoteId = note?.id;
			beforeLastRecordedFolderId = lastRecordedFolderId;
			lastRecordedFolderId = folder?.id;

			// pause cursor/scroll saves into memory until 'On Note Selection Change' handler successfully executed
			noteLoaded = false;
			if (!note) {
				console.debug(`On Note Selection Change [Cancel]. Reason: no selected note discovered.`);
				return;
			}
			currentNoteId = note.id;
			const createdTime = note.created_time;
			const newFolderId = note.parent_id;
			note = clearObjectReferences(note);
			let newFolderManuallySelected = await isNewFolderManuallySelected();

			console.debug(`New Folder Manually Selected: ${newFolderManuallySelected}`);

			// Update the last note ID
			await joplin.settings.setValue('resumenote.lastNoteId', currentNoteId);

			if (newFolderId === currentFolderId) {
				// Update both in-memory map and settings
				await updateFolderNoteMap(currentFolderId, currentNoteId);
			}

			// Hash is ID of the note's section.
			// If available on note selection change - user specifically wants to be scrolled to section of other note by Joplin core.
			// Hash is not available on note selection change during general note switching.
			// Avoid setting pos. from memory to not overwrite Joplin's scroll position to section.
			let newNoteHash = await joplin.workspace.selectedNoteHash();
			if (newNoteHash != null && newNoteHash.length > 0) {
				console.debug(`On Note Selection Change [Cancel]. Reason: cross-note link contains hash #${newNoteHash}.`);
				// keep cursor/scroll scanning active
				noteLoaded = true;
				return;
			}
			// Open folder's default note only during manual folder click, otherwise we overwrite cross-note links targeting
			// note in other folder.
			if (newFolderManuallySelected && (newFolderId !== currentFolderId)) {
				console.debug("Open folder's default note [In Progress]. Reason: manual folder change detected.");
				currentFolderId = newFolderId;

				// Check if we have a saved note for the new folder
				const savedNoteId = await loadFolderNoteMap(newFolderId);
				if (savedNoteId) {
					// Navigate to the saved note
					try {
						await joplin.commands.execute('openNote', savedNoteId);
						console.debug("Open folder's default note [Done].");
					} catch (error) {
						console.debug(`Open folder's default note [Failed]. Note ID: ${savedNoteId}. Error: ${error}`);
					}
				} else {
					console.debug("Open folder's default note [Cancel]. Reason: not set yet.");
				}
			}

			if (!versionInfo.mobile) {
				// We're not in the mobile app
				// Debounce cursor restoration to avoid focus stealing during search
				if (restoreTimeout) clearTimeout(restoreTimeout);
				restoreTimeout = setTimeout(async () => {
					noteLoaded = await restoreCursorPosition(currentNoteId);
				}, restoreDelay);
			} else {
				// We're in the mobile app
				const toggleEditor = await joplin.settings.value('resumenote.toggleEditor');
				const currentTime = Date.now();
				const noteAge = currentTime - createdTime;
				// Note must be older than 10 seconds (new note is already in edit mode)
				if (toggleEditor && noteAge > 1000*10) {
					await new Promise(resolve => setTimeout(resolve, 100)); // Wait for the note to be opened
					try {
						await joplin.commands.execute('toggleVisiblePanes');
					} catch (error) {
						console.debug(`Toggle editor on note selection [Failed]. Error: ${error}`);
					}
					await new Promise(resolve => setTimeout(resolve, restoreDelay));
					noteLoaded = await restoreCursorPosition(currentNoteId);
				}
				// Do nothing or else it will fail
			}
			console.debug(`On Note Selection Change [Done]`);
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
	console.debug(`Save default note for folder [In Progress]. Note ID: ${noteId}; Folder ID: ${folderId}`);
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
	console.debug(`Save default note for folder [Done]. Note ID: ${noteId}; Folder ID: ${folderId}`);
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
	const isCodeView = await joplin.settings.globalValue('editor.codeView');
	if (!currentNoteId || !noteLoaded || !isCodeView) {
		return;
	}

	let cursor: { line: number, ch: number, scroll: number, selection: number };
	try {
		cursor = await joplin.commands.execute('editor.execCommand', {
			name: 'rn.getCursorAndScroll'
		});
	} catch (error) {
		// If the command fails, it means the editor is not available
		return;
	}

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

/**
 * Reads cursor/scroll positions ({@link CursorPosition}) from memory.
 * Memory varies depending on plugin setting:
 * - user settings (single device memory);
 * - user data (sync across devices).
 * @param noteId - ID of currently opened note.
 * @returns boolean indicating if note is loaded properly:
 *          - true if no cursor/scroll position found in memory, or if restore went well;
 *          - false if editor is not "code view", or there was error during positions restore.
 */
async function loadCursorPosition(noteId: string): Promise<CursorPosition | undefined> {
	console.debug("Load saved cursor & scroll [In Progress]. Note ID: " + currentNoteId);
	let savedCursor: CursorPosition;
	if (useUserData) {
		savedCursor = await joplin.data.userDataGet(ModelType.Note, currentNoteId, 'cursor');
	} else {
		// Load from memory
		savedCursor = noteCursorMap[noteId];
	}
	console.debug(`Load saved cursor & scroll [Done]. Value: ${JSON.stringify(savedCursor)}; Note ID: ${currentNoteId}`);
  	return savedCursor;
}

/**
 * Restores cursor/scroll position of provided note from memory.
 * Skips restore if:
 * - no cursor/scroll position was found in memory;
 * - note is opened in editor other than "code view" (Markdown);
 * - error happened (not re-thrown) meaning editor is likely not available.
 * Uses custom 'CodeMirror 6' commands registered in `cursorTracker.ts`.
 * @see ./cursorTracker.ts for custom 'CodeMirror 6' commands.
 * @param noteId - ID of currently opened note.
 * @returns boolean indicating if note is loaded properly:
 *          - true if no cursor/scroll position found in memory, or if restore went well;
 *          - false if editor is not "code view", or there was error during positions restore.
 */
async function restoreCursorPosition(noteId: string): Promise<boolean> {
	console.debug(`Restore cursor position [In Progress]. Note ID: ${noteId}.`);
	const savedCursor = await loadCursorPosition(noteId);
	// setting that controls whether the editor displays notes in "code view" (Markdown source) or another mode, like
	// the rich text (WYSIWYG) editor.
	const isCodeView = await joplin.settings.globalValue('editor.codeView');
	if (!isCodeView) return false;  // Only proceed if in code view
	if (!savedCursor) {
		return true;
	}

	try {
		await joplin.commands.execute('editor.focus');
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
	} catch (error) {
		// If the command fails, it means the editor is not available
		console.debug(`Restore cursor position [Failed]. Note ID: ${noteId}. Reason: editor is not available`);
		return false;
	}
	console.debug(`Restore cursor position [Done]. Note ID: ${noteId}.`);
	return true;
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

/**
 * Checks if manual note folder switch happened rather than user navigated to new folder
 * through cross-note link.
 * When user clicks on note folder Joplin core code loads some note out of the folder and
 * then plugin comes in to overwrite it with last opened note in this folder.
 *
 * lastRecordedNoteId - during folder click Joplin API returns empty value when current note is requested, we record
 * empty value in lastRecordedNoteId to indicate folder selection.
 * lastRecordedFolderId - new folder ID recorded during folder click;
 * beforeLastRecordedFolderId - previous folder ID.
 * @returns true if: no lastRecordedNoteId (folder click) and new folder ID differs from prev. folder ID.
 */
async function isNewFolderManuallySelected(): Promise<boolean> {
	return (lastRecordedNoteId?.length < 1)
		&& lastRecordedFolderId?.length > 0
		&& beforeLastRecordedFolderId?.length > 0
		&& beforeLastRecordedFolderId !== lastRecordedFolderId;
}

/**
 * Extracts a raw note ID from a string that may be either a plain ID
 * or a Joplin markdown link in the format [title](:/noteId).
 */
export function parseNoteId(input: string): string {
	if (!input) return '';
	const match = input.match(/\(:\/([a-fA-F0-9]+)\)/);
	return match ? match[1] : input.trim();
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