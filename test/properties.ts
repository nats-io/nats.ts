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
import {connect, NatsConnectionOptions, Payload, VERSION} from "../src/nats";
import {SC, startServer, stopServer} from "./helpers/nats_server_control";
import {Lock} from "./helpers/latch";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});

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

test.skip('configured options', async (t) => {
    let nco = {} as NatsConnectionOptions;
    nco.payload = Payload.BINARY;
    nco.name = "test";
    nco.pass = "secret";
    nco.user = "me";
    nco.token = "abc";
    nco.pedantic = true;
    nco.verbose = true;

    // let c = new Connect(nco);
    // t.is(c.verbose, nco.verbose);
    // t.is(c.pedantic, nco.pedantic);
    // //@ts-ignore
    // t.is(c.payload, nco.payload);
    // t.is(c.name, nco.name);
    // t.is(c.user, nco.user);
    // t.is(c.pass, nco.pass);
    // t.is(c.auth_token, nco.token)
});