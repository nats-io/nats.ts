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

import {ErrorCode, NatsError} from "./error";
import {Msg, Payload} from "./nats";
import {CR_LF_LEN} from "./const";

/**
 * @hidden
 */
export class MsgBuffer {
    msg: Msg;
    length: number;
    payload: Payload;
    error?: NatsError;
    private readonly encoding: BufferEncoding;
    private buf!: Buffer | null;

    constructor(chunks: RegExpExecArray, payload: Payload, encoding: BufferEncoding) {
        this.msg = {} as Msg;
        this.encoding = encoding;
        this.msg.subject = chunks[1];
        this.msg.sid = parseInt(chunks[2], 10);
        this.msg.reply = chunks[4];
        this.msg.size = parseInt(chunks[5], 10);
        this.length = this.msg.size + CR_LF_LEN;
        this.payload = payload;
    }

    fill(data: Buffer) {
        if (!this.buf) {
            this.buf = data;
        } else {
            this.buf = Buffer.concat([this.buf, data]);
        }
        this.length -= data.byteLength;

        if (this.length === 0) {
            this.buf = this.buf.slice(0, this.buf.byteLength - 2);
            switch (this.payload) {
                case Payload.JSON:
                    this.msg.data = this.buf.toString();
                    try {
                        this.msg.data = JSON.parse(this.msg.data);
                    } catch (ex) {
                        this.error = NatsError.errorForCode(ErrorCode.BAD_JSON, ex);
                    }
                    break;
                case Payload.STRING:
                    this.msg.data = this.buf.toString(this.encoding);
                    break;
                case Payload.BINARY:
                    this.msg.data = this.buf;
                    break;
            }
            this.buf = null;
        }
    }
}