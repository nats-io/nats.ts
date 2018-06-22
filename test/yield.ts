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

import test from "ava";
import {Lock, wait} from "./helpers/latch";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {connect} from "../src/nats";
import {next} from 'nuid';
import {join} from 'path';

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});

test('should yield to other events', async (t) => {
    t.plan(4);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, yieldTime: 5});

    let lock = new Lock();
    let start = Date.now();

    setTimeout(() => {
        let delta = Date.now() - start;
        nc.close();
        t.true(delta >= 0);
        t.true(25 >= delta);
        t.true(i >= 0);
        t.true(256 >= i);
        lock.unlock();
    }, 10);

    let subj = next();
    nc.subscribe(subj, async () => {
        await wait(1);
    });

    let data = next();
    let i: number;
    for (i = 0; i < 256; i++) {
        nc.publish(subj, data);
    }

    await lock.latch;

    nc.close();
});
