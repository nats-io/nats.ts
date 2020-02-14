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

import {SC, startServer, stopServer} from './helpers/nats_server_control';
import test, {ExecutionContext} from 'ava';
import {connect} from '../src/nats';
import {Lock} from './helpers/latch';


test.before(async (t) => {
    let s1 = await startServer();
    let s2 = await startServer();
    t.context = {server: s1, servers: [s1, s2]};
});

test.after.always((t) => {
    (t.context as SC).servers.forEach((s) => {
        stopServer(s);
    });
});

function getServers(t: ExecutionContext<any>): string[] {
    let a: string[] = [];
    let servers = (t.context as SC).servers;
    servers.forEach((s) => {
        a.push(s.nats);
    });
    return a;
}

test('has multiple servers', async (t) => {
    t.plan(1);

    let a = getServers(t);
    let nc = await connect({servers: a});

    //@ts-ignore
    let servers = nc.protocolHandler.servers;
    t.is(servers.length(), a.length);
    nc.close();
});

test('connects to first valid server', async (t) => {
    let lock = new Lock();
    let a = getServers(t);
    a.splice(0, 0, 'nats://localhost:7');
    let nc = await connect({servers: a});
    nc.on('connect', () => {
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('reject if no valid server', async (t) => {
    t.plan(1);
    let a = ['nats://localhost:7'];
    await t.throwsAsync(() => {
        return connect({servers: a, reconnectTimeWait: 50});
    }, {code: 'ECONNREFUSED'});
});

test('throws if no valid server', async (t) => {
    t.plan(1);
    let a = ['nats://localhost:7', 'nats://localhost:9'];
    try {
        await connect({servers: a, reconnectTimeWait: 50});
    } catch (ex) {
        t.is(ex.code, 'ECONNREFUSED');
    }
});

test('random server connections', async (t) => {
    let first = getServers(t)[0];
    let count = 0;
    let other = 0;
    for (let i = 0; i < 100; i++) {
        let nc = await connect({servers: getServers(t)});
        //@ts-ignore
        let s = nc.protocolHandler.servers.getCurrentServer();
        //@ts-ignore
        if (s.toString() === first) {
            count++;
        } else {
            other++;
        }
        nc.close();
    }

    t.is(count + other, 100);
    t.true(count >= 35);
    t.true(count <= 65);
});

test('no random server if noRandomize', async (t) => {
    let servers = getServers(t);
    let first = servers[0].toString();
    for (let i = 0; i < 100; i++) {
        let nc = await connect({servers: servers, noRandomize: true});
        //@ts-ignore
        let s = nc.protocolHandler.currentServer;
        t.is(s.toString(), first.toString());
        nc.close();
    }
});