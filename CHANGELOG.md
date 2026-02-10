# [v0.4.2](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.4.2)
*Released on 2026-02-10*

- added: accept markdown link format for home note ID setting (#9)
- fixed: handle errors from openNote and toggleVisiblePanes commands (#9)
- fixed: move editor.focus inside try/catch in restoreCursorPosition (#9)

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.4.1...v0.4.2

---

# [v0.4.1](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.4.1)
*Released on 2026-01-14T05:01:12Z*

- improved: cursor restore with debounce

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.4.0...v0.4.1

---

# [v0.4.0](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.4.0)
*Released on 2025-07-11T05:04:55Z*

- fixed: restore last active note only when new folder is manually selected (#4 by @executed)
- fixed: cross-note anchor (hash) navigation (#4 by @executed)
- misc minor improvements (#4 by @executed)

---

# [v0.3.2](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.3.2)
*Released on 2025-04-13T15:09:14Z*

- added: setting: restoreScrollPosition
    - when this setting is off, the scroll position will not be set by the plugin
    - if the preview pane is visible, setting this off will not change the app's behaviour, for the most part
    - at the same time, it will let Joplin scroll to note headings (closes #3)

---

# [v0.3.1](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.3.1)
*Released on 2025-03-24T15:55:22Z*

- improved: error handling

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.3.0...v0.3.1

---

# [v0.3.0](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.3.0)
*Released on 2025-03-18T08:27:43Z*

this version adds **mobile support**.
you may need to adjust the plugin's delay settings on your mobile device to optimise performance.

- mobile-only features
    - switch to edit mode
        - when opening a note, the plugin will optionally open the editor (instead of the viewer), and bring the cursor to the last edited line.
        - this version utilises recent upgrades made to the Joplin plugin API in v3.2.
    - you will find the `Go to home note` command on the editor toolbar.
- supported features
    - save cursor and selection.
    - home note / last active note on startup.
    - you may sync the cursor between the mobile and desktop apps by enabling `Sync data using note properties (Experimental)`, but beware of sync conflicts!
- unsupported features
    - saved scroll position.
    - opening the last active note in a notebook, as the plugin API does not have an event listener for folder selection.

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.2.5...v0.3.0

---

# [v0.2.5](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.5)
*Released on 2024-11-30T09:19:15Z*

- fixed: do not try to get cursor in the rich text editor

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.2.4...v0.2.5

---

# [v0.2.4](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.4)
*Released on 2024-11-21T03:58:52Z*

- added: setting startHomeNote
- fixed: ensure that go to home opens the home note

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.2.3...v0.2.4

---

# [v0.2.3](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.3)
*Released on 2024-11-17T07:47:23Z*

- added: command: go to home
- added: setting: saveFolderNote
    - may be used to disable / enable the last active note for each notebook

---

# [v0.2.2](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.2)
*Released on 2024-11-12T01:48:09Z*

- added: setting Delay before starting the plugin (in ms)
- improved: settings descriptions

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.2.1...v0.2.2

---

# [v0.2.1](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.1)
*Released on 2024-11-11T07:59:13Z*

- added: save cursor position across sessions in settings data (default)
- added: clear user data from notes when not using this method to save the cursor
- added: commands: clearUserData, clearSettingsData
- added: setting restoreDelay: Delay before setting cursor and scroll position (in ms)
- improved: increased default restoreDelay to handle slower clients
- improved: 2-step scroll
- improved: update saveSelection on setting change
- fixed: update cursor position only after restored previous cursor

**Full Changelog**: https://github.com/alondmnt/joplin-plugin-resume-note/compare/v0.2.0...v0.2.1

---

# [v0.2.0](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.2.0)
*Released on 2024-11-09T13:16:34Z*

- added: save scroll position independently from cursor
- added: save cursor selection (can be disabled in the settings)
- improved: setScroll in content script
- refactored: CodeMirror content script

---

# [v0.1.1](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.1.1)
*Released on 2024-11-03T07:46:05Z*

- renamed: Sticky Note -> Resume Note

---

# [v0.1.0](https://github.com/alondmnt/joplin-plugin-resume-note/releases/tag/v0.1.0)
*Released on 2024-11-02T02:11:37Z*

- Save and restore the last active note in each folder
- Save and restore the cursor position in the Markdown editor for each note
    - Optionally use note properties to sync across devices and Joplin sessions
- Set a home note or load the last active note on startup

---
