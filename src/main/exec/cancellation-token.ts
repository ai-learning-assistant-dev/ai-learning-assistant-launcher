import { EventEmitter } from 'events';
import {
  CancellationTokenSource,
  CancellationToken,
} from '@podman-desktop/api';

export class CancellationTokenSourceImpl implements CancellationTokenSource {
  private _isCancellationRequested = false;
  private _eventEmitter = new EventEmitter();

  get token(): CancellationToken {
    return {
      get isCancellationRequested(): boolean {
        return this._isCancellationRequested;
      },
      onCancellationRequested: (
        listener: (e: any) => void,
        thisArgs?: any,
        disposables?: any[],
      ) => {
        this._eventEmitter.on('cancellationRequested', listener);
        return {
          dispose: () => {
            this._eventEmitter.removeListener(
              'cancellationRequested',
              listener,
            );
          },
        };
      },
    };
  }

  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this._eventEmitter.emit('cancellationRequested');
    }
  }

  dispose(): void {
    this._eventEmitter.removeAllListeners();
  }
}
