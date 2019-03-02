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

import {settle} from '../src/util';
import test from 'ava';

function settleMacro(t: any, input: any[], fails: boolean = false, output?: any[]): Promise<any> {
    t.plan(1);
    return settle(input)
        .then((values) => {
            if (fails) {
                t.fail('should not have resolved');
            } else {
                output = output || input;
                t.deepEqual(values, output);
            }
        })
        .catch((ex) => {
            if (fails) {
                t.pass();
            } else {
                t.fail(ex);
            }
        });
}

function testPromise(value: any, ok: boolean = true): Promise<any> {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (ok) {
                resolve(value);
            } else {
                reject(value);
            }
        }, 0);
    });
}

//@ts-ignore - "a" shouldn't work - prevent the compiler from failing
test('requires array', settleMacro, 'a', true);
test('empty array', settleMacro, []);
test('values', settleMacro, [1, 'two', true, {a: 'b'}]);
test('mixed', settleMacro, [testPromise('bad', false), testPromise(2), 3], false, ['bad', 2, 3]);
test('all resolve', settleMacro, [testPromise('a'), testPromise(2), testPromise(true)], false, ['a', 2, true]);
test('all reject', settleMacro, [testPromise('a', false), testPromise(2, false), testPromise(true, false)], false, ['a', 2, true]);
