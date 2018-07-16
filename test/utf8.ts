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
import {connect, NatsConnectionOptions} from "../src/nats";
import {join} from 'path';
import {createInbox} from "../src/util";
import {NatsError} from "../src/error";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});


test('pub sub with utf8 payloads by default', async (t) => {
    t.plan(5);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    // ½ + ¼ = ¾: 9 characters, 12 bytes
    let data = '\u00bd + \u00bc = \u00be';
    t.is(data.length, 9);
    t.is(Buffer.byteLength(data), 12);

    let subj = createInbox();
    let sub = nc.subscribe(subj, (err, msg) => {
-       t.is(msg.data.length, 9);
        t.is(Buffer.byteLength(msg.data), 12);
        t.is(msg.data, data);
    }, {max: 1});
    nc.publish(subj, data);
    await nc.flush();
});

test('override encoding', async (t) => {
    t.plan(5);
    let sc = t.context as SC;
    let opts = {url: sc.server.nats, encoding: "ascii"} as NatsConnectionOptions;
    let nc = await connect(opts);

    // ½ + ¼ = ¾: 9 characters, 12 bytes
    let data = '\u00bd + \u00bc = \u00be';
    let plain_data = 'Hello World';

    t.is(data.length, 9);
    t.is(Buffer.byteLength(data), 12);

    let subj1 = createInbox();
    let sub1 = nc.subscribe(subj1, (err, msg) => {
        t.is(msg.data.length, 12);
        t.not(msg.data, data);
    }, {max: 1});
    nc.publish(subj1, data);

    let subj2 = createInbox();
    let sub2 = nc.subscribe(subj2, (err, msg) => {
        t.is(msg.data, plain_data);
    }, {max: 1});
    nc.publish(subj2, plain_data);

    await nc.flush();
});

test('unsupported encoding', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    let opts = {url: sc.server.nats, encoding: "foobar"} as NatsConnectionOptions;
    let error = connect(opts);
    await t.throws(error, {instanceOf: NatsError, code: 'INVALID_ENCODING'});
});

