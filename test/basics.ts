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
import {connect} from "../src/nats";
import {Lock} from "./helpers/latch";
import {createInbox} from "../src/util";
import * as NATS from "../src/nats";

test.before(async (t) => {
    let server = await startServer();
    // let server = await startServer("", ['--', '-p', '4222']);
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});

test('fail connect', async (t) => {
    await t.throws(connect);
});

test('sub and unsub', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let sid = nc.subscribe(createInbox(), {}, () => {});
    t.truthy(sid);
    nc.unsubscribe(sid);
    nc.flush(() => {
        lock.unlock();
    });
    return lock.latch;
});

test('basic publish', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.publish(createInbox());
    nc.flush(() => {
        t.pass();
        lock.unlock();
    });
    return lock.latch;
});

test('subscription callback', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    nc.subscribe(subj, {max: 1}, () => {
        t.pass();
        lock.unlock();
    });
    nc.publish(subj);
    return lock.latch;
});

test('subscription message in callback', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";

    nc.subscribe(subj, {}, (msg) => {
        t.is(msg, payload);
        lock.unlock();
    });
    nc.publish(subj, payload);
    return lock.latch;
});

test('subscription message has reply', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";
    const replyInbox = createInbox();

    nc.subscribe(subj, {}, (msg, inbox) => {
        t.is(inbox, replyInbox);
        lock.unlock();
    });
    nc.publish(subj, payload, replyInbox);
    return lock.latch;
});

test('subscription message has subject', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    nc.subscribe(subj, {}, (msg, inbox, subject) => {
        t.is(subject, subj);
        lock.unlock();
    });
    nc.publish(subj);
    return lock.latch;
});

test('subscription message has sid', async (t) => {
    t.plan(1);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    let sub = nc.subscribe(subj, {}, (msg, inbox, subject, sid) => {
        t.is(sid, sub);
        lock.unlock();
    });
    nc.publish(subj);
    return lock.latch;
});

test('request reply', async (t) => {
    t.plan(2);
    let lock = new Lock(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";
    const response = payload.split("").reverse().join("");

    nc.subscribe(subj, {}, (msg, inbox) => {
        t.is(msg, payload);
        nc.publish(inbox, response);
    });

    nc.request(subj, payload, {}, 1000, (msg) => {
        t.is(msg, response);
        lock.unlock();
    });

    return lock.latch;
});