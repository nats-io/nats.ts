/*
 * Copyright 2018-2019 The NATS Authors
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

import {Msg, Req} from './nats';
import {createInbox} from './util';
import {NatsError} from './error';

/**
 * @hidden
 */
export class MuxSubscriptions {
    baseInbox!: string;
    reqs: { [key: string]: Req } = {};
    length: number = 0;

    init(): string {
        this.baseInbox = `${createInbox()}.`;
        return this.baseInbox;
    }

    add(r: Req) {
        if (!isNaN(r.received)) {
            r.received = 0;
        }
        this.length++;
        this.reqs[r.token] = r;
    }

    get(token: string): Req | null {
        if (token in this.reqs) {
            return this.reqs[token];
        }
        return null;
    }

    cancel(r: Req): void {
        if (r && r.timeout) {
            clearTimeout(r.timeout);
            delete r.timeout;
        }
        if (r.token in this.reqs) {
            delete this.reqs[r.token];
            this.length--;
        }
    }

    getToken(m?: Msg): string | null {
        let s = '';
        if (m) {
            s = m.subject || '';
        }
        if (s.indexOf(this.baseInbox) === 0) {
            return s.substring(this.baseInbox.length);
        }
        return null;
    }

    dispatcher() {
        let mux = this;
        return (error: NatsError | null, m: Msg): void => {
            let token = mux.getToken(m);
            if (token) {
                let r = mux.get(token);
                if (r) {
                    r.received++;
                    r.callback(error, m);
                    if (r.max && r.received >= r.max) {
                        mux.cancel(r);
                    }
                }
            }
        }
    };
}