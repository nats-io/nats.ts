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

import test, {ExecutionContext} from "ava";
import {connect, NatsConnectionOptions, Payload, VERSION} from "../src/nats";
import {SC, Server, startServer, stopServer} from "./helpers/nats_server_control";
import {Lock} from "./helpers/latch";
import {createInbox} from "../src/util";
import {ErrorCode} from "../src/error";
import * as mockserver from "./helpers/mock_server";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server, servers: [server]};
});

test.after.always((t) => {
    (t.context as SC).servers.forEach((s) => {
        stopServer(s);
    })
});

function registerServer(t: ExecutionContext, s: Server) : Server {
    //@ts-ignore
    t.context.servers.push(s);
    return s;
}

test('VERSION is semver', (t) => {
    t.regex(VERSION, /[0-9]+\.[0-9]+\.[0-9]+/);
});

test('VERSION matches package.json', (t) => {
    // we are getting build in lib/test
    let pkg = require('../../package.json');
    t.is(pkg.version, VERSION);
});

test('connect is a function', (t) => {
    t.is(typeof connect, 'function');
});

test('default connect properties', async (t) => {
    let lock = new Lock();
    let sc = t.context as SC;
    let c = await connect(sc.server.nats);
    c.on('connect', () => {
        //@ts-ignore
        let opts = c.protocolHandler.options as NatsConnectionOptions;
        t.is(opts.verbose, false);
        t.is(opts.pedantic, false);
        t.is(opts.user, undefined);
        t.is(opts.pass, undefined);
        t.is(opts.token, undefined);
        t.is(opts.name, undefined);
        lock.unlock();
    });
    return lock.latch;
});

test('configured options', async (t) => {

    let s1 = registerServer(t, await startServer(["--user", "me", "--pass", "secret"]));


    let nco = {} as NatsConnectionOptions;
    nco.encoding = "ascii";
    nco.maxPingOut = 42;
    nco.maxReconnectAttempts = 24;
    nco.name = "test";
    nco.noRandomize = true;
    nco.pass = "secret";
    nco.payload = Payload.STRING;
    nco.pedantic = true;
    nco.pingInterval = 1000;
    nco.reconnect = false;
    nco.reconnectTimeWait = 987;
    nco.url = s1.nats;
    nco.user = "me";
    nco.verbose = true;
    nco.waitOnFirstConnect = true;
    nco.yieldTime = 10;

    let lock = new Lock();
    let nc = await connect(nco);

    nc.on('connect', () => {
        //@ts-ignore
        let opts = nc.protocolHandler.options;
        t.is(opts.encoding, nco.encoding);
        t.is(opts.maxPingOut, nco.maxPingOut);
        t.is(opts.maxReconnectAttempts, nco.maxReconnectAttempts);
        t.is(opts.name, nco.name);
        t.is(opts.noRandomize, nco.noRandomize);
        t.is(opts.pass, nco.pass);
        t.is(opts.payload, nco.payload);
        t.is(opts.pedantic, nco.pedantic);
        t.is(opts.pingInterval, nco.pingInterval);
        t.is(opts.reconnect, nco.reconnect);
        t.is(opts.reconnectTimeWait, nco.reconnectTimeWait);
        t.is(opts.token, nco.token);
        t.is(opts.user, nco.user);
        t.is(opts.verbose, nco.verbose);
        t.is(opts.waitOnFirstConnect, nco.waitOnFirstConnect);
        t.is(opts.yieldTime, nco.yieldTime);
        nc.close();

        lock.unlock();
    });

    return lock.latch;
});



test('noEcho', async(t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let subj = createInbox();
    let cp = connect({url: sc.server.nats, noEcho: true});
    cp.then(async (nc) => {
        let c2 = 0;
        let sub2 = nc.subscribe(subj, ()=> {
            c2++;
        });
        nc.publish(subj);
        await nc.flush();
        t.is(c2, 0);
        nc.close();
        lock.unlock();
    }).catch((err) => {
        if(err.code === ErrorCode.NO_ECHO_NOT_SUPPORTED) {
            t.pass();
        } else {
            t.fail(err);
        }
        lock.unlock();
    });
    await lock.latch;
});


test('noEcho not supported', async(t) => {
    let lock = new Lock();
    let server = new mockserver.ScriptedServer(0);
    try {
        await server.start();
    } catch(ex) {
        t.fail('failed to start the mock server');
        return;
    }
    t.plan(1);

    let nc = await connect({port: server.port, noEcho: true, reconnect: false});
    nc.on('error', (err) => {
        t.is(err.code, ErrorCode.NO_ECHO_NOT_SUPPORTED);
        lock.unlock();
    });

    // test times out if it were to connect
    await lock.latch;
});
