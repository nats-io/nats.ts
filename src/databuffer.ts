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

const EMPTY_BUF = Buffer.allocUnsafe(0);
const CR = 13;
const LF = 10;

enum ParserState {
    START,
    CR
}

/**
 * @hidden
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
        if (n === undefined) {
            n = this.byteLength;
        }

        if (this.byteLength >= n) {
            this.pack();
            let v = this.buffers.pop();
            if (v) {
                let d = v.slice(0, n);
                if (this.byteLength > n) {
                    this.buffers.push(v.slice(n));
                }
                this.byteLength -= n;
                return d;
            }
        }
        return EMPTY_BUF;
    }

    fill(data: Buffer): void {
        if (data) {
            this.buffers.push(data);
            this.byteLength += data.byteLength;
        }
    }

    protoLen(): number {
        let ps = ParserState.START;
        let offset = 0;
        for(let j=0; j < this.buffers.length; j++) {
            let cb = this.buffers[j];
            for (let i = 0; i < cb.byteLength; i++) {
                let v = cb.readUInt8(i);
                switch(ps) {
                    case ParserState.START:
                        switch(v) {
                            case CR:
                                ps = ParserState.CR;
                                break;
                            default:
                        }
                        break;
                    case ParserState.CR:
                        switch(v) {
                            case LF:
                                // we want a length not an index
                                return offset+i+1;
                            default:
                                ps = ParserState.START;
                        }
                        break;
                }
            }
            offset += cb.byteLength;
        }
        return -1;
    }

    peek(): Buffer {
        if (this.buffers.length) {
            this.pack();
            return this.buffers[0];
        }
        return EMPTY_BUF;
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