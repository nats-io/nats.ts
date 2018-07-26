/*
 * Copyright 2018 The NATS Authors
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
 */

export class DataBuffer {
    buffers: Buffer[] = [];
    byteLength: number = 0;


    pack(): void {
        if (this.buffers.length > 1) {
            let v = Buffer.concat(this.buffers, this.byteLength);
            this.buffers = [v];
        }
    }

    drain(n?: number): Buffer {
        if (this.buffers.length) {
            this.pack();
            let v = this.buffers.pop();
            if (v) {
                let max = this.byteLength;
                if (n === undefined || n > max) {
                    n = max;
                }
                let d = v.slice(0, n);
                if (max > n) {
                    this.buffers.push(v.slice(n));
                }
                this.byteLength = max - n;
                return d;
            }
        }
        return Buffer.allocUnsafe(0);
    }

    fill(data: Buffer): void {
        if (data) {
            this.buffers.push(data);
            this.byteLength += data.byteLength;
        }
    }

    peek(): Buffer {
        if (this.buffers.length) {
            this.pack();
            return this.buffers[0];
        }
        return Buffer.allocUnsafe(0);
    }

    size(): number {
        return this.byteLength;
    }

    length(): number {
        return this.buffers.length;
    }

    reset(): Buffer[] {
        let a = this.buffers;
        this.buffers = [];
        this.byteLength = 0;
        return a;
    }

}