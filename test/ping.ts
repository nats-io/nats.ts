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
import {Client, connect, NatsConnectionOptions, ErrorCode} from '../src/nats';
import {Lock} from './helpers/latch';
import * as mockserver from './helpers/mock_server';


test.before(async (t) => {
    let server = new mockserver.ScriptedServer(0);
    try {
        await server.start();
    } catch (ex) {
        t.log(ex);
    }
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    t.context.server.stop();
});

test('reconnect if no ping', async (t) => {
    let lock = new Lock();
    t.plan(2);
    //@ts-ignore
    let port = t.context.server.port;
    let nc = await connect({port: port, pingInterval: 200, maxReconnectAttempts: 1, reconnectTimeWait: 100,
    });
    nc.on('reconnect', () => {
        nc.close();
        t.pass();
        if (timer) {
            clearTimeout(timer);
        }
        lock.unlock();
    });

    nc.on('error', (err) => {
        t.is(err.code, ErrorCode.NATS_PROTOCOL_ERR);
    });

    let timer = setTimeout(() => {
        t.fail('should have reconnected');
        lock.unlock();
    }, 5000);

    return lock.latch;
});

test('timer pings are sent', async (t) => {
    let lock = new Lock();
    t.plan(2);

    //@ts-ignore
    let port = t.context.server.port;
    let opts = {
        port: port,
        pingInterval: 200,
        maxPingOut: 3,
        reconnectTimeWait: 100,
        maxReconnectAttempts: 1
    } as NatsConnectionOptions;

    let nc: Client;
    try {
        nc = await connect(opts);
    } catch (ex) {
        t.log(ex);
        return;
    }
    let fired = false;
    nc.on('pingtimer', () => {
        fired = true;
    });

    nc.on('error', (err) => {
        t.is(err.code, ErrorCode.NATS_PROTOCOL_ERR);
    });

    nc.on('reconnect', () => {
        t.true(fired);
        nc.close();
        if (timer) {
            clearTimeout(timer);
        }
        lock.unlock();
    });

    let timer = setTimeout(() => {
        t.fail('should have reconnected');
        lock.unlock();
    }, 5000);

    return lock.latch;
});
