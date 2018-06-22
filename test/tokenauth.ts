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

import {connect} from "../src/nats";
import test from "ava";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {Lock, wait} from "./helpers/latch";
import {ErrorCode, NatsError} from "../src/error";


test.before(async (t) => {
    let server = await startServer("", ['--', '--auth', 'tokenxxxx']);
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});


test('token no auth', async (t) => {
    t.plan(3);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats});
    nc.on('error', (err) => {
        t.truthy(err);
        t.regex(err.message, /Authorization/);
        let ne = err as NatsError;
        t.is(ne.code, ErrorCode.AUTHORIZATION_VIOLATION);
        lock.unlock();
    });
    return lock.latch;
});

test('token bad auth', async (t) => {
    t.plan(3);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, token: 'bad'});
    nc.on('error', (err) => {
        t.truthy(err);
        t.regex(err.message, /Authorization/);
        let ne = err as NatsError;
        t.is(ne.code, ErrorCode.AUTHORIZATION_VIOLATION);
        lock.unlock();
    });
    return lock.latch;
});

test('token auth', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, token: 'tokenxxxx'});
    nc.on('error', (err) => {
        t.fail(err);
    });
    await wait(500);
    nc.close();
    t.pass();
});
