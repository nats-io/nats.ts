/*
 * Copyright 2018-2020 The NATS Authors
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

import test from 'ava'
import {Lock, sleep} from './helpers/latch'
import {SC, startServer, stopServer} from './helpers/nats_server_control'
import {connect} from '../src/nats'
import {next} from 'nuid'
import {Payload} from 'nats'

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});

test('should yield to other events', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.JSON, yieldTime: 5});
    let lock = new Lock();
    let last: number = -1;

    let yields = 0;
    nc.on('yield', () => {
        yields++;
    });

    let interval = setInterval(() => {
        if (last > 0) {
            clearInterval(interval);
            nc.close();
            // yielded before the last message
            t.true(last < 256);
            // and we also got notifications that yields happen
            t.truthy(yields);
            lock.unlock();
        }
    }, 10);

    let subj = next();
    nc.subscribe(subj, (err, msg) => {
        last = msg.data;
        // take some time
        sleep(1);
    });

    for (let i = 0; i < 256; i++) {
        nc.publish(subj, i);
    }
    nc.flush();
    await lock.latch;
    nc.close();
});
