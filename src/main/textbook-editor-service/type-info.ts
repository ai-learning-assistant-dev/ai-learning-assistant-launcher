import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'textbook-editor-service';

export const queryTextbookEditorServiceHandle = `${channel}query`;

export const installTextbookEditorServiceHandle = `${channel}install`;

export const startTextbookEditorServiceHandle = `${channel}start`;

export const removeTextbookEditorServiceHandle = `${channel}remove`;

export const updateTextbookEditorServiceHandle = `${channel}update`;

export const haveNewVersionTextbookEditorServiceHandle = `${channel}haveNewVersion`;

export const logsTextbookEditorServiceHandle = `${channel}logs`;

export const textbookEditorWebURL = 'http://127.0.0.1:7200/';
