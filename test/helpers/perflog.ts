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

import {appendFile} from 'fs';
import {VERSION} from '../../src/nats';

export function log(file: string, op: string, count: number, time: number, extra = "") {
    appendFile(file, [op, count, time, new Date().toDateString(), VERSION, extra].join(",") + "\n", function (err) {
        if (err) {
            console.log(err);
        }
        process.exit();
    });
}
