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
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {Client, connect} from "../src/nats";
import {join} from 'path';
import url from 'url';
import {Lock} from "./helpers/latch";
import {createInbox} from "../src/util";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});

test('connect with port', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let u = new url.URL(sc.server.nats);
    let port = parseInt(u.port, 10);

    let nc = await connect(port);
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect with url argument', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let nc = await connect(sc.server.nats);
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect with url in options', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let nc = await connect({url: sc.server.nats});
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('should receive when some servers are invalid', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let servers = ["nats://localhost:7", sc.server.nats];

    let nc = await connect({servers: servers, noRandomize: true});
    let subj = createInbox();
    let sub = await nc.subscribe(subj, (err, msg) => {
        if(err) {
            t.fail(err.message);
        } else {
            t.pass();
            nc.close();
            lock.unlock();
        }
    });

    nc.publish(subj);
    return lock.latch;
});

test('reconnect events', async (t) => {
    t.plan(4);
    let lock = new Lock();

    let server = await startServer();

    let nc = await connect({
        url: server.nats,
        waitOnFirstConnect: true,
        reconnectTimeWait: 100,
        maxReconnectAttempts: 20
    });

    let stopTime = 0;
    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server, () => {
                stopTime = Date.now();
            });
        }, 100);
    });

    // we get a disconnect event for the initial connection
    // and for each of the failed reattempts
    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    nc.on('error', (err) => {
        console.log(err);
        t.fail('on error should not have produced error: ' + err);
    });

    let connecting = 0;
    nc.on('reconnecting', () => {
        connecting++;
    });

    nc.on('close', () => {
        let elapsed = Date.now() - stopTime;
        t.is(connecting, 20);
        t.is(disconnects, 21);
        t.true(elapsed >= 2000);
        t.true(elapsed <= 3000);
        lock.unlock();
    });

    return lock.latch;
});