import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'native-training-service';

export const installNativeTrainingServiceHandle = `${channel}install`;

export const startNativeTrainingServiceHandle = `${channel}start`;

export const removeNativeTrainingServiceHandle = `${channel}remove`;

export const updateCourseNativeTrainingServiceHandle = `${channel}updateCourse`;

export const courseHaveNewVersionNativeTrainingServiceHandle = `${channel}courseHaveNewVersion`;

export const logsNativeTrainingServiceHandle = `${channel}logs`;

export const trainingWebURL = 'http://127.0.0.1:7100/';
