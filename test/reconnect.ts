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

import test from 'ava';
import {SC, startServer, stopServer, Server} from './helpers/nats_server_control';
import {connect} from '../src/nats';
import url from 'url';
import {Lock} from './helpers/latch';
import {createInbox} from '../src/util';

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server, servers: []};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
    //@ts-ignore
    t.context.servers.forEach((s) => {
        stopServer(s);
    });
});

function registerServer(s: Server, t: any) {
    t.context.servers.push(s);
}

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

    let servers = ['nats://localhost:7', sc.server.nats];

    let nc = await connect({servers: servers, noRandomize: true});
    let subj = createInbox();
    let sub = await nc.subscribe(subj, (err, msg) => {
        if (err) {
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
    t.plan(5);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);


    let nc = await connect({
        url: server.nats,
        waitOnFirstConnect: true,
        reconnectTimeWait: 100,
        maxReconnectAttempts: 10
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
    nc.on('disconnect', (url) => {
        if (disconnects === 0) {
            t.is(url, server.nats);
        }
        disconnects++;
    });

    nc.on('error', (err) => {
        console.log(err);
        t.fail('on error should not have produced error: ' + err);
    });

    let reconnecting = 0;
    nc.on('reconnecting', () => {
        reconnecting++;
    });

    nc.on('close', () => {
        let elapsed = Date.now() - stopTime;
        t.is(reconnecting, 10, 'reconnecting count');
        t.is(disconnects, 1, 'disconnect count');
        t.true(elapsed >= 10 * 100);
        t.true(elapsed <= 15 * 100);
        lock.unlock();
    });

    return lock.latch;
});

test('reconnect not emitted if suppressed', async (t) => {
    t.plan(2);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);

    let nc = await connect({
        url: server.nats,
        reconnect: false
    });

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server);
        }, 100);
    });

    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    let reconnecting = false;
    nc.on('reconnecting', () => {
        reconnecting = true;
    });

    nc.on('close', () => {
        t.is(disconnects, 1);
        t.false(reconnecting);
        lock.unlock();
    });

    return lock.latch;
});

test('reconnecting after proper delay', async (t) => {
    t.plan(2);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);

    let nc = await connect({
        url: server.nats,
        reconnectTimeWait: 500,
        maxReconnectAttempts: 1
    });

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server);
        }, 100);
    });

    let disconnect = 0;
    nc.on('disconnect', () => {
        disconnect = Date.now();
    });

    nc.on('reconnecting', () => {
        nc.close();
        let elapsed = Date.now() - disconnect;
        t.true(elapsed >= 475);
        t.true(elapsed <= 2500);
        lock.unlock();
    });

    return lock.latch;
});

test('indefinite reconnects', async (t) => {
    let lock = new Lock();
    t.plan(3);

    let server: Server | null;
    server = await startServer();
    registerServer(server, t);

    let u = new url.URL(server.nats);
    let port = parseInt(u.port, 10);

    let nc = await connect({
        url: server.nats,
        reconnectTimeWait: 100,
        maxReconnectAttempts: -1
    });

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server, () => {
                server = null;
            });
        }, 100);
    });

    setTimeout(async () => {
        server = await startServer(['-p', port.toString()]);
        registerServer(server, t);
    }, 1000);


    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    let reconnectings = 0;
    nc.on('reconnecting', () => {
        reconnectings++;
    });

    let reconnects = 0;
    nc.on('reconnect', () => {
        reconnects++;
        nc.flush(() => {
            nc.close();
            t.true(reconnectings >= 5);
            t.is(reconnects, 1);
            t.is(disconnects, 1);
            lock.unlock();
        });
    });

    return lock.latch;
});