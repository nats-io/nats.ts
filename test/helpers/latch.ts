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
 */

export class Lock {
    latch: Promise<any>;
    count: number;
    unlock!: Function;

    constructor(count: number = 1) {
        this.count = count;
        let lock = this;
        this.latch = new Promise((resolve) => {
            this.unlock = function () {
                lock.count -= 1;
                if (lock.count === 0) {
                    resolve();
                }
            };
        });
    }
}

export function wait(millis: number = 100): Promise<any> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, millis);
    });
}

export function sleep(ms: number) {
    let start = new Date().getTime(),
        expire = start + ms;
    while (new Date().getTime() < expire) {
        // spinning...
    }
}