/*
 * Copyright 2019 The NATS Authors
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

    add(request: Req): void {
        if (!isNaN(request.received)) {
            request.received = 0;
        }

        this.length++;
        this.reqs[request.token] = request;
    }

    get(token: string): Req | null {
        if (token in this.reqs) {
            return this.reqs[token];
        }

        return null;
    }

    cancel(request: Req): void {
        if (request && request.timeout) {
            clearTimeout(request.timeout);
            delete request.timeout;
        }

        if (request.token in this.reqs) {
            delete this.reqs[request.token];
            this.length--;
        }
    }

    getToken(message?: Msg): string | null {
        let subject = '';

        if (message) {
            subject = message.subject || "";
        }

        if (subject.indexOf(this.baseInbox) === 0) {
            return subject.substring(this.baseInbox.length);
        }
        
        return null;
    }

    dispatcher(): (error: NatsError | null, message: Msg) => void {
        return (error: NatsError | null, message: Msg): void => {
            let token = this.getToken(message);
            
            if (token) {
                let request = this.get(token);
                
                if (request) {
                    request.received++;
                    request.callback(error, message);
                    
                    if (request.max && request.received >= request.max) {
                        this.cancel(request);
                    }
                }
            }
        }
    }
}
