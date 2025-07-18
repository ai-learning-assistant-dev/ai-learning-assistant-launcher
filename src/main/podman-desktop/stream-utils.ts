/**********************************************************************
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
 ***********************************************************************/

// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer } from 'buffer';
import { decode, encode } from 'iconv-lite';

// if multiplexed, we have:
// header := [8]byte{STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4}

export function isMultiplexedLog(log: string): boolean {
  const zero1 = log.charCodeAt(1);
  const zero2 = log.charCodeAt(2);
  const zero3 = log.charCodeAt(3);

  // not multiplexed if 0 0 0 bytes are not set to zero (means it's not multiplexed)
  if (zero1 !== 0 && zero2 !== 0 && zero3 !== 0) {
    return false;
  }

  return true;
  // TODO 后面这段判断在中文上有bug，所以先直接返回，以后再来找原因

  // else try to figure out the length
  const size1 = log.charCodeAt(4);
  const size2 = log.charCodeAt(5);
  const size3 = log.charCodeAt(6);
  const size4 = log.charCodeAt(7);

  // console.log(size1,size2,size3,size4)

  // SIZE1, SIZE2, SIZE3, SIZE4 are the four bytes of the uint32 size encoded as big endian.
  const length = Buffer.from([size1, size2, size3, size4]).readInt32BE();
  const potentialLength = log.substring(8).length;
  return length === potentialLength;
}

export function cleanMultiplexedLog(logs: string) {
  return logs
    .split('\n')
    .map((data) => {
      let content;
      if (isMultiplexedLog(data + '\n')) {
        content = data.substring(8);
      } else {
        content = data;
      }
      return content;
    })
    .join('\n');
}
