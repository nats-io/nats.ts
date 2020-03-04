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

import test from 'ava';
import {SC, startServer, stopServer} from './helpers/nats_server_control';
import {connect, SubEvent, ErrorCode} from '../src/nats';
import {Lock} from './helpers/latch';
import {createInbox} from "nats";

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});

test('connection drains and closes when no subs', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats});
    return nc.drain()
        .then((err) => {
            t.falsy(err)
            t.true(nc.isClosed())
        })
});

test('connection drain', async (t) => {
    t.plan(4)
    let sc = t.context as SC
    let subj = createInbox()

    let nc1 = await connect({url: sc.server.nats})
    let drained = false
    let s1 = await nc1.subscribe(subj, () => {
        if (! drained) {
            t.pass()
            drained = true
            nc1.drain()
        }
    }, {queue: 'q1'})

    let nc2 = await connect({url: sc.server.nats})
    let s2 = await nc2.subscribe(subj, () => {}, {queue: 'q1'});

    await nc1.flush();
    await nc2.flush();

    for (let i = 0; i < 10000; i++) {
        nc2.publish(subj);
    }

    return nc2.drain()
        .then(() => {
            t.is(s1.getReceived() + s2.getReceived(), 10000);
            t.true(s1.getReceived() >= 1, 's1 got more than one message');
            t.true(s2.getReceived() >= 1, 's2 got more than one message');
        })
        .catch((err) => {
            t.log(err)
        })

});

test('subscription drain', async (t) => {
    t.plan(6);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    let subj = createInbox();
    let c1 = 0;
    let s1 = await nc.subscribe(subj, () => {
        c1++;
        if (!s1.isDraining()) {
            // resolve when done
            s1.drain()
                .then(() => {
                    t.pass();
                    lock.unlock();
                });
        }
    }, {queue: 'q1'});

    let c2 = 0;
    await nc.subscribe(subj, () => { c2++;}, {queue: 'q1'});


    // first notification is the unsubscribe notification
    // for the drained subscription
    let handled = false;
    nc.on('unsubscribe', (se: SubEvent) => {
        if (!handled) {
            t.is(se.sid, s1.getID());
            handled = true;
        }
    });

    for (let i = 0; i < 10000; i++) {
        nc.publish(subj);
    }
    await nc.flush();
    await lock.latch;

    t.is(c1 + c2, 10000);
    t.true(c1 >= 1, 's1 got more than one message');
    t.true(c2 >= 1, 's2 got more than one message');
    t.true(s1.isCancelled());
    nc.close();
});

test('publisher drain', async (t) => {
    t.plan(4);
    let lock = new Lock();
    let sc = t.context as SC
    let subj = createInbox()

    const nc1 = await connect({url: sc.server.nats})
    const s1 = await nc1.subscribe(subj, () => {
        if (s1.getReceived() === 1) {
            for (let i = 0; i < 100; i++) {
                nc1.publish(subj)
            }
            nc1.drain().then(() => {
                t.pass()
                lock.unlock()
            })
            .catch((ex) => {
                t.fail(ex)
                lock.unlock()
            });
        }
    }, {queue: 'q1'})

    const nc2 = await connect({url: sc.server.nats});
    const s2 = await nc2.subscribe(subj, () => {}, {queue: 'q1'})

    await nc1.flush()
    await nc2.flush()

    for (let i = 0; i < 10000; i++) {
        nc2.publish(subj);
    }
    await nc2.drain();
    await lock.latch

    t.is(s1.getReceived() + s2.getReceived(), 10100);
    t.true(s1.getReceived() >= 1, 's1 got more than one message');
    t.true(s2.getReceived() >= 1, 's2 got more than one message');
});

test('publish after drain fails', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let subj = createInbox();
    let nc = await connect({url: sc.server.nats});
    nc.subscribe(subj, () => {});
    await nc.drain();
    try {
        nc.publish(subj);
    } catch (err) {
        t.is(err.code, ErrorCode.CONN_CLOSED);
    }
    nc.close();
});

test('reject reqrep during connection drain', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let subj = 'xxxx';

    // start a service for replies
    let nc1 = await connect(sc.server.nats);
    await nc1.subscribe(subj + 'a', (err, msg) => {
        if (msg.reply) {
            nc1.publish(msg.reply, 'ok');
        }
    });
    nc1.flush();

    // start a client, and initialize requests
    let nc2 = await connect(sc.server.nats);
    // start a mux subscription
    await nc2.request(subj + 'a', 1000, 'initialize the request');

    let first = true;
    nc2.subscribe(subj, async (err, msg) => {
        if (first) {
            first = false;
            nc2.drain();
            try {
                // should fail
                await nc2.request(subj + 'a', 1000);
                t.fail('shouldn\'t have been able to request');
                lock.unlock();
            } catch (err) {
                t.is(err.code, ErrorCode.CONN_DRAINING);
                lock.unlock();
            }
        }
    });
    // publish a trigger for the drain and requests
    for (let i = 0; i < 2; i++) {
        nc2.publish(subj, 'here');
    }
    nc2.flush();
    await lock.latch;
});

test('reject drain on closed', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc1 = await connect(sc.server.nats);
    nc1.close();
    await t.throwsAsync(() => {
        return nc1.drain();
    }, {code: ErrorCode.CONN_CLOSED});
});

test('reject subscribe on draining', async (t) => {
    t.plan(1)
    let sc = t.context as SC
    let nc1 = await connect(sc.server.nats)
    nc1.drain()
    return nc1.subscribe('foo', () => {})
        .then(() => {
            t.fail('subscribe should have failed')
        })
        .catch((err) => {
            t.truthy(err)
        })
})

test('drain cancels subs and emits', async (t) => {
    t.plan(2);
    const sc = t.context as SC;
    const nc = await connect(sc.server.nats);
    const sub = await nc.subscribe('foo', () => {});
    nc.on('unsubscribe', () => {
        t.pass()
    })
    return sub.drain()
        .then(() => {
            t.truthy(sub.isCancelled())
        })
});

test('connection is closed after drain', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc1 = await connect(sc.server.nats);
    await nc1.subscribe('foo', () => {});
    await nc1.drain();
    t.true(nc1.isClosed());
});

test('closed is fired after drain', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc1 = await connect(sc.server.nats);
    nc1.on('close', () => {
        lock.unlock();
        t.pass();
    });
    await nc1.drain();
    await lock.latch;
});

test('reject subscription drain on closed', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc1 = await connect(sc.server.nats);
    let sub = await nc1.subscribe('foo', () => {});
    nc1.close();
    await t.throwsAsync(() => {
        return sub.drain();
    }, {code: ErrorCode.CONN_CLOSED});
});

test('reject subscription drain on draining sub', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc1 = await connect(sc.server.nats);
    let subj = createInbox();
    let sub = await nc1.subscribe(subj, async () => {
        sub.drain();
        await t.throwsAsync(() => {
            return sub.drain();
        }, {code: ErrorCode.SUB_DRAINING});
    });
    nc1.publish(subj);
    await nc1.flush();
});
