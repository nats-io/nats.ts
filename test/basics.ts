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
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let sub = await nc.subscribe(createInbox(), () => {
    }, {});
    t.truthy(sub);
    sub.unsubscribe();
    await nc.flush();
    nc.close();
});

test('basic publish', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.publish(createInbox());
    nc.flush(() => {
        t.pass();
    });
    await nc.flush();
    nc.close();
});

test('subscription callback', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    await nc.subscribe(subj, () => {
        t.pass();
    }, {max: 1});
    nc.publish(subj);
    await nc.flush();
    nc.close();
});

test('subscription message in callback', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";

    await nc.subscribe(subj, (err, msg) => {
        t.is(err, null);
        //@ts-ignore
        t.is(msg.data, payload);

    }, {});
    nc.publish(subj, payload);
    await nc.flush();
    nc.close();
});

test('subscription message has reply', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";
    const replyInbox = createInbox();
    await nc.subscribe(subj, (err, msg) => {
        //@ts-ignore
        t.is(msg.reply, replyInbox);
    }, {});
    nc.publish(subj, payload, replyInbox);
    await nc.flush();
    nc.close();
});

test('subscription message has subject', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    await nc.subscribe(subj, (err, msg) => {
        //@ts-ignore
        t.is(msg.subject, subj);
    }, {});
    nc.publish(subj);
    await nc.flush();
});

test('subscription has exact subject', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    await nc.subscribe(`${subj}.*.*.*`, (err, msg) => {
        //@ts-ignore
        t.is(msg.subject, `${subj}.1.2.3`);
    }, {});
    nc.publish(`${subj}.1.2.3`);
    await nc.flush();
});

test('subscription message has sid', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    let sub = await nc.subscribe(subj, (err, msg) => {
        //@ts-ignore
        t.is(msg.sid, sub.sid);
    }, {});
    nc.publish(subj);
    await nc.flush();
});

test('request reply', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = "Hello World";
    const response = payload.split("").reverse().join("");
    await nc.subscribe(subj, (err, msg) => {
        //@ts-ignore
        t.is(msg.data, payload);
        //@ts-ignore
        nc.publish(msg.reply, response);
    }, {});

    let msg = await nc.request(subj, 1000, payload);
    t.is(msg.data, response);
    nc.close();
});

test('wildcard subscriptions', async (t) => {
    t.plan(3);
    let single = 3;
    let partial = 2;
    let full = 5;

    let singleCounter = 0;
    let partialCounter = 0;
    let fullCounter = 0;

    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    let s = createInbox();
    let singleSub = await nc.subscribe(`${s}.*`, () => {
        singleCounter++;
    });
    let partialSub = await nc.subscribe(`${s}.foo.bar.*`, () => {
        partialCounter++;
    });
    let fullSub = await nc.subscribe(`${s}.foo.>`, () => {
        fullCounter++;
    });

    nc.publish(`${s}.bar`);
    nc.publish(`${s}.baz`);
    nc.publish(`${s}.foo.bar.1`);
    nc.publish(`${s}.foo.bar.2`);
    nc.publish(`${s}.foo.baz.3`);
    nc.publish(`${s}.foo.baz.foo`);
    nc.publish(`${s}.foo.baz`);
    nc.publish(`${s}.foo`);

    await nc.flush();
    t.is(singleCounter, single);
    t.is(partialCounter, partial);
    t.is(fullCounter, full);

    nc.close();
});

test('flush can be a promise', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let p = nc.flush();
    t.true(p instanceof Promise);
    await p;
    nc.close();
});

test('flush can be a callback', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let p = nc.flush(() => {
        t.pass();
        lock.unlock();
    });

    t.is(p, undefined);
    await lock.latch;

    nc.close();
});

test('unsubscribe after close', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let sub = await nc.subscribe(createInbox(), () => {
    });
    nc.close();
    sub.unsubscribe();
    t.pass();
});

test('no data after unsubscribe', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    let received = 0;
    let sub = await nc.subscribe(subj, () => {
        received++;
        sub.unsubscribe();
    });
    nc.publish(subj);
    nc.publish(subj);
    nc.publish(subj);
    await nc.flush();
    t.is(received, 1);
    nc.close();
});

