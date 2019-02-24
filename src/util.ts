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

import * as nuid from 'nuid';

/**
 * Create a properly formatted inbox subject.
 */
export function createInbox(): string {
    return `_INBOX.${nuid.next()}`;
}

/**
 * Extends given target with all sources. This mutates the target-object
 * @hidden
 */
export function extend(target: any, ...sources: any[]): any {
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];

        Object.keys(source).forEach((key) => {
            target[key] = source[key];
        });
    }

    return target;
}

/**
 * Shuffles the entries of given array. This mutates given array
 * @hidden
 */
export function shuffle(target: any[]) {
    for (let i = target.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [target[i], target[j]] = [target[j], target[i]];
    }

    return target;
}

/**
 * Settles all promises in given array to a single promise. Given promise will resolve
 * with the list of results of all sub-promises, regardless of their success of failure
 */
export function settle(values: any[]): Promise<any[]> {
    if (Array.isArray(values)) {
        return Promise.all(values.map((value) => Promise.resolve(value).then(_resolve, _resolve)));
    } else {
        return Promise.reject(new TypeError('argument requires an array of promises'));
    }
}

/**
 * An identity function, that helps with promise handling
 */
function _resolve(value: any): any {
    return value;
}
