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

import {EventEmitter} from 'events';
import {Sub} from './nats';

/**
 * @hidden
 */
export class Subscriptions extends EventEmitter {
    mux!: Sub;
    subs: { [key: number]: Sub } = {};
    sidCounter: number = 0;
    length: number = 0;

    constructor() {
        super();
    }

    add(subscription: Sub): Sub {
        this.sidCounter++;
        this.length++;
        subscription.sid = this.sidCounter;
        this.subs[subscription.sid] = subscription;
        
        const subscriptionEvent = {sid: subscription.sid, subject: subscription.subject, queue: subscription.queue};
        this.emit('subscribe', subscriptionEvent);
        
        return subscription;
    }

    setMux(subscription: Sub): Sub {
        this.mux = subscription;
        
        return subscription;
    }

    getMux(): Sub | null {
        return this.mux;
    }

    get(sid: number): (Sub | null) {
        if (sid in this.subs) {
            return this.subs[sid];
        }

        return null;
    }

    all(): Sub[] {
        const buf = [];
        
        for (const sid in this.subs) {
            const sub = this.subs[sid];
            
            buf.push(sub);
        }
        
        return buf;
    }

    cancel(subscription: Sub): void {
        if (subscription && subscription.timeout) {
            clearTimeout(subscription.timeout);
            delete subscription.timeout;
        }

        if (subscription.sid in this.subs) {
            const sub = this.subs[subscription.sid];
            const subscriptionEvent = {sid: sub.sid, subject: sub.subject, queue: sub.queue};
            
            delete this.subs[subscription.sid];
            
            this.length--;
            this.emit('unsubscribe', subscriptionEvent);
        }
    }

    close(): void {
        const subs = this.all();
        
        for (let i = 0; i < subs.length; i++) {
            this.cancel(subs[i]);
        }
    }
}
