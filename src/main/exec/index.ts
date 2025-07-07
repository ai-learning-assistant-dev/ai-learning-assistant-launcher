/** ********************************************************************
 * Copyright (C) 2023 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ********************************************************************** */

// eslint-disable-next-line max-classes-per-file
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';

import type { RunError, RunOptions, RunResult } from '@podman-desktop/api';
import * as sudo from 'sudo-prompt';

import { app } from 'electron';
import path from 'path';
import { isLinux, isMac, isWindows } from './util';
import iconv from 'iconv-lite';

export const appPath = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : app.getAppPath();

export const macosExtraPath =
  '/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin';

function bufferToString(data: Buffer | string, encoding?: string) {
  if (data) {
    if (Buffer.isBuffer(data)) {
      return iconv.decode(data, encoding);
    } else {
      return data;
    }
  } else {
    return '';
  }
}

class RunErrorImpl extends Error implements RunError {
  constructor(
    override readonly name: string,
    override readonly message: string,
    readonly exitCode: number,
    readonly command: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly cancelled: boolean,
    readonly killed: boolean,
  ) {
    super(message);
    Object.setPrototypeOf(this, RunErrorImpl.prototype);
  }
}

let globalDefaultEncoding = 'utf8';

export async function autoAdaptEncodingForWindows() {
  if (isWindows()) {
    const output = await new Exec().exec('chcp', []);
    console.debug('autoAdaptEncodingForWindows', output);
    if (output.stdout.indexOf('936') >= 0) {
      globalDefaultEncoding = 'gbk';
    } else if (output.stdout.indexOf('65001') >= 0) {
      globalDefaultEncoding = 'utf8';
    }
    console.debug(`set exec default encoding to ${globalDefaultEncoding}`);
  }
}

export class Exec {
  constructor() {}

  exec(
    command: string,
    args?: string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    let env = { ...process.env };

    if (options?.env) {
      env = Object.assign(env, options.env);
    }

    if (isMac() || isWindows()) {
      env.PATH = getInstallationPath(env.PATH);
    }

    let encoding = 'utf8';

    if (options && options.encoding) {
      encoding = options.encoding;
    } else {
      if (isWindows()) {
        encoding = globalDefaultEncoding;
      }
    }

    console.debug('exec', command, args, options);

    // do we have an admin task ?
    // if yes, will use sudo-prompt on windows and osascript on mac and pkexec on linux
    if (options?.isAdmin) {
      if (isWindows()) {
        return new Promise<RunResult>((resolve, reject) => {
          // Convert the command array to a string for sudo prompt
          // the name is used for the prompt

          // convert process.env to { [key: string]: string; }'
          const sudoEnv = env as { [key: string]: string };
          /*
           * sudo prompt verify keys and does not support keys with special characters
           * ( or ) on Windows
           * See https://github.com/jorangreef/sudo-prompt/blob/c3cc31a51bc50fe21fadcbf76a88609c0c77026f/index.js#L96
           */
          for (const key of Object.keys(sudoEnv)) {
            if (!/^[a-zA-Z_]\w*$/.test(key)) {
              delete sudoEnv[key];
            }
          }
          const sudoOptions = {
            name: 'Admin usage',
            env: sudoEnv,
          };
          const sudoCommand = `${command} ${(args ?? []).join(' ')}`;

          const callback = (
            error?: Error,
            stdout?: string | Buffer,
            stderr?: string | Buffer,
          ): void => {
            if (error) {
              console.debug('sudo-prompt-error', {
                error,
                out: bufferToString(stdout, encoding),
                err: bufferToString(stderr, encoding),
              });
              // need to return a RunError
              const errResult: RunError = new RunErrorImpl(
                error.name,
                `Failed to execute command: ${error.message}`,
                1,
                sudoCommand,
                bufferToString(stdout, encoding),
                bufferToString(stderr, encoding),
                false,
                false,
              );

              reject(errResult);
            }
            const result: RunResult = {
              command,
              stdout: bufferToString(stdout, encoding),
              stderr: bufferToString(stderr, encoding),
            };
            // in case of success
            resolve(result);
          };

          console.debug(`Executing command with sudo: ${sudoCommand}`);

          sudo.exec(sudoCommand, sudoOptions, callback);
        });
      }
      if (isMac()) {
        args = [
          '-e',
          `do shell script "${command} ${(args ?? []).join(
            ' ',
          )}" with prompt "Podman Desktop requires admin privileges " with administrator privileges`,
        ];
        command = 'osascript';
      } else if (isLinux()) {
        args = [command, ...(args ?? [])];
        command = 'pkexec';
      }
    }

    if (env.FLATPAK_ID) {
      const customEnvVariables: string[] = [];
      for (const envVar in options?.env) {
        customEnvVariables.push(`--env=${envVar}=${options.env[envVar]}`);
      }
      args = ['--host', ...customEnvVariables, command, ...(args ?? [])];
      command = 'flatpak-spawn';
    }

    let cwd: string;
    if (options?.cwd) {
      cwd = options.cwd;
    }

    let shell = undefined;
    if (options?.shell) {
      shell = options.shell;
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      console.debug(`Executing command: ${command} ${args?.join(' ')}`);

      const childProcess: ChildProcessWithoutNullStreams = spawn(
        command,
        args,
        { env, cwd, shell },
      );

      options?.token?.onCancellationRequested(() => {
        if (!childProcess.killed) {
          childProcess.kill();
          options?.logger?.error('Execution cancelled');
          const errResult: RunError = new RunErrorImpl(
            'Execution cancelled',
            'Failed to execute command: Execution cancelled',
            1,
            command,
            stdout.trim(),
            stderr.trim(),
            true,
            childProcess.killed,
          );
          reject(errResult);
        }
        options?.logger?.error(
          'Failed to execute cancel: Process has been already killed',
        );
        const errResult: RunError = new RunErrorImpl(
          'Failed to execute cancel: Process has been already killed',
          'Failed to execute cancel: Process has been already killed',
          1,
          command,
          stdout.trim(),
          stderr.trim(),
          false,
          childProcess.killed,
        );
        reject(errResult);
      });

      // childProcess.stdout.setEncoding(options?.encoding ?? 'utf8');
      // childProcess.stderr.setEncoding(options?.encoding ?? 'utf8');

      childProcess.stdout.on('data', (data) => {
        stdout += bufferToString(data, encoding);
        options?.logger?.log(data);
      });

      childProcess.stderr.on('data', (data) => {
        stderr += bufferToString(data, encoding);
        options?.logger?.warn(data);
      });

      childProcess.on('error', (error) => {
        options?.logger?.error(`Failed to execute command: ${error.message}`);
        const errResult: RunError = new RunErrorImpl(
          error.name,
          `Failed to execute command: ${error.message}`,
          1,
          command,
          stdout.trim(),
          stderr.trim(),
          false,
          childProcess.killed,
        );
        reject(errResult);
      });

      childProcess.on('close', (exitCode) => {
        if (exitCode === 0) {
          const result: RunResult = {
            command,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          };
          resolve(result);
        } else {
          options?.logger?.error(
            `Command execution failed with exit code ${exitCode}`,
          );
          const errResult: RunError = new RunErrorImpl(
            `Command execution failed with exit code ${exitCode}`,
            `command: ${command}\n` +
              `exitCode: ${exitCode}\n` +
              `stdout: ${stdout.trim()}\n` +
              `stderr: ${stderr.trim()}\n`,
            exitCode ?? 1,
            command,
            stdout.trim(),
            stderr.trim(),
            false,
            childProcess.killed,
          );
          reject(errResult);
        }
      });
    });
  }
}

export function getInstallationPath(envPATH?: string): string {
  envPATH ??= process.env.PATH;

  if (isWindows()) {
    return `c:\\Program Files\\RedHat\\Podman;${envPATH}`;
  }
  if (isMac()) {
    if (!envPATH) {
      return macosExtraPath;
    }
    return macosExtraPath.concat(':').concat(envPATH);
  }
  return envPATH ?? '';
}
