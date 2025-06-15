import type * as containerDesktopAPI from '@podman-desktop/api';
import { Exec } from './exec';

const exec = new Exec();

export const extensionApi = {
  process: {
    exec: (
      command: string,
      args?: string[],
      options?: containerDesktopAPI.RunOptions,
    ): Promise<containerDesktopAPI.RunResult> => {
      return exec.exec(command, args, options);
    },
  } as typeof containerDesktopAPI.process,
};
