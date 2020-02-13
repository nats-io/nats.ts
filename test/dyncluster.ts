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

import {addClusterMember, SC, Server, startServer, stopServer} from './helpers/nats_server_control';
import test, {ExecutionContext} from 'ava';
import {Client, connect} from '../src/nats';
import {Lock} from './helpers/latch';
import {delay} from "../src/util";

test.before(async (t) => {
    t.context = {servers: []};
});

test.after.always((t) => {
    (t.context as SC).servers.forEach((s) => {
        stopServer(s);
    });
});

function registerServer(t: ExecutionContext, s: Server): Server {
    //@ts-ignore
    t.context.servers.push(s);
    return s;
}

async function addClusterServer(t: ExecutionContext, server: Server): Promise<Server> {
    let s = await addClusterMember(server);
    return registerServer(t, s);
}

function countImplicit(nc: Client): number {
    let count = 0;
    //@ts-ignore
    nc.protocolHandler.servers.getServers().forEach(function (s) {
        if (s.implicit) {
            count++;
        }
    });
    return count;
}


test('updates add', async (t) => {
    let s1 = registerServer(t, await startServer());
    t.plan(4);
    let lock = new Lock();
    let nc = await connect(s1.nats);
    //@ts-ignore
    let servers = nc.protocolHandler.servers;
    t.is(servers.length(), 1);
    nc.on('serversChanged', (change) => {
        t.is(servers.length(), 2);
        t.is(change.added.length, 1);
        t.is(countImplicit(nc), 1);
        lock.unlock();
    });
    await addClusterServer(t, s1);
    return lock.latch;
});

test('updates remove', async (t) => {
    t.plan(4);
    let s1 = registerServer(t, await startServer());
    let s2 = await addClusterServer(t, s1);

    let lock = new Lock();
    let nc = await connect(s2.nats);
    //@ts-ignore
    let servers = nc.protocolHandler.servers;
    nc.on('connect', () => {
        t.is(servers.length(), 2);
        nc.on('serversChanged', (change) => {
            t.is(servers.length(), 1);
            t.is(change.deleted.length, 1);
            t.is(countImplicit(nc), 0);
            lock.unlock();
        });

        setTimeout(() => {
            stopServer(s1);
        }, 200);
    });

    return lock.latch;
});

test('reconnects to gossiped server', async (t) => {
    t.plan(1);
    let s1 = registerServer(t, await startServer());
    let s2 = await addClusterServer(t, s1);

    let lock = new Lock();
    let nc = await connect(s2.nats);
    //@ts-ignore
    let servers = nc.protocolHandler.servers;

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(s2);
        }, 200);

    });

    nc.on('reconnect', () => {
        t.is(servers.getCurrentServer().url.href, s1.nats);
        lock.unlock();
    });

    return lock.latch;
});

test('fails after maxReconnectAttempts when servers killed', async (t) => {
    t.plan(4);
    let s1 = registerServer(t, await startServer());
    let s2 = await addClusterServer(t, s1);
    await delay(100);

    let lock = new Lock();
    let nc = await connect({url: s2.nats, maxReconnectAttempts: 10, reconnectTimeWait: 50});

    let disconnects = 0;
    let reconnectings = 0;
    nc.on('connect', (c, url) => {
        t.is(url, s2.nats);
        process.nextTick(() => {
            stopServer(s2);
        });
    });

    nc.on('disconnect', () => {
        disconnects++;
    });

    nc.on('reconnect', (c, url) => {
        t.is(url, s1.nats);
        nc.on('reconnecting', () => {
            reconnectings++;
        });
        process.nextTick(() => {
            stopServer(s1);
        });
    });

    nc.on('close', () => {
        t.is(reconnectings, 20);
        t.is(disconnects, 2);
        lock.unlock();
    });

    return lock.latch;
});