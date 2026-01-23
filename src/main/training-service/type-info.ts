import type { Channels } from '../ipc-data-type';

export const channel: Channels = 'training-service';

export const installTrainingServiceHandle = `${channel}install`;

export const startTrainingServiceHandle = `${channel}start`;

export const removeTrainingServiceHandle = `${channel}remove`;

export const updateCourseTrainingServiceHandle = `${channel}updateCourse`;

export const courseHaveNewVersionTrainingServiceHandle = `${channel}courseHaveNewVersion`;

export const logsTrainingServiceHandle = `${channel}logs`;

export const trainingWebURL = 'http://127.0.0.1:7100/';
