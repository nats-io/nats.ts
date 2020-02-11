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
import {Client, connect, ErrorCode, NatsConnectionOptions, NatsError, Payload, SubEvent} from '../src/nats';
import {Lock} from './helpers/latch';
import {createInbox} from '../src/util';
import url from 'url';
import * as net from 'net';


test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
});

test('fail connect', async (t) => {
    await t.throwsAsync(connect);
});

test('connect with port', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let u = new url.URL(sc.server.nats);
    let nc = await connect({port: parseInt(u.port, 10)} as NatsConnectionOptions);
    nc.flush(() => {
        t.pass();
    });
    await nc.flush();
    nc.close();
});

test('pub subject is required', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    await t.throws(() => {
        //@ts-ignore
        nc.publish();
    }, {code: ErrorCode.BAD_SUBJECT});
});

test('sub subject is required', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    //@ts-ignore
    await t.throwsAsync(nc.subscribe(),
        {code: ErrorCode.BAD_SUBJECT});
});

test('sub callback is required', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    //@ts-ignore
    await t.throwsAsync(nc.subscribe('foo'),
        {code: ErrorCode.API_ERROR});
});

test('subs require connection', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.close();
    //@ts-ignore
    await t.throwsAsync(nc.subscribe('foo', () => {
        }),
        {code: ErrorCode.CONN_CLOSED});
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
    const payload = 'Hello World';

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
    const payload = 'Hello World';
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
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();

    let sub = await nc.subscribe(subj, (err, msg) => {
        //@ts-ignore
        t.is(msg.sid, sub.sid);
    }, {});
    // expecting unlimited number of messages
    t.is(sub.getMax(), -1);
    nc.publish(subj);
    await nc.flush();
});

test('subscription generates events', async (t) => {
    t.plan(3);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    let subj = createInbox();
    nc.on('subscribe', (se: SubEvent) => {
        t.is(se.subject, subj);
        t.is(se.queue, 'A');
        t.is(se.sid, 1);
    });

    nc.subscribe(subj, () => {}, {queue: 'A'});
    await nc.flush();
});

test('unsubscribe generates events', async (t) => {
    t.plan(3);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    let subj = createInbox();
    nc.on('unsubscribe', (se: SubEvent) => {
        t.is(se.subject, subj);
        t.is(se.queue, 'A');
        t.is(se.sid, 1);
    });

    let sub = await nc.subscribe(subj, () => {}, {queue: 'A'});
    sub.unsubscribe();
    await nc.flush();
});

test('unsubscribe notifications only once', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);

    let subj = createInbox();
    let count = 0;
    nc.on('unsubscribe', () => {
        count++;
    });

    await nc.subscribe(subj, () => {
    }, {queue: 'A', max: 5});
    for (let i = 0; i < 5; i++) {
        nc.publish(subj);
    }
    await nc.flush();
    t.is(count, 1);
});

test('request subject is required', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    //@ts-ignore
    await t.throwsAsync(nc.request(), {code: ErrorCode.BAD_SUBJECT});
});

test('requests require connection', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.close();
    //@ts-ignore
    await t.throwsAsync(nc.request('foo'), {code: ErrorCode.CONN_CLOSED});
});

test('request reply', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    let subj = createInbox();
    const payload = 'Hello World';
    const response = payload.split('').reverse().join('');
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
    nc.subscribe(`${s}.*`, () => {
        singleCounter++;
    });
    nc.subscribe(`${s}.foo.bar.*`, () => {
        partialCounter++;
    });
    nc.subscribe(`${s}.foo.>`, () => {
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
    //@ts-ignore
    t.truthy(p.then);
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

test('JSON messages', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.JSON} as NatsConnectionOptions);
    let subj = createInbox();
    let m = {
        boolean: true,
        string: 'CEDILA-Ç'
    };

    nc.subscribe(subj, (err, msg) => {
        t.is(err, null);
        // @ts-ignore
        t.deepEqual(msg.data, m);
    }, {max: 1});
    nc.publish(subj, m);
    await nc.flush();
    nc.close();
});

test('UTF8 messages', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.STRING} as NatsConnectionOptions);
    let subj = createInbox();
    let m = 'CEDILA-Ç';

    nc.subscribe(subj, (err, msg) => {
        t.is(err, null);
        // @ts-ignore
        t.is(msg.data, m);
    }, {max: 1});
    nc.publish(subj, m);
    await nc.flush();
    nc.close();
});

test('request removes mux', async (t) => {
    t.plan(3);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.STRING} as NatsConnectionOptions);
    let subj = createInbox();

    nc.subscribe(subj, (err, msg) => {
        t.truthy(msg);
        //@ts-ignore
        nc.publish(msg.reply);
    }, {max: 1});

    let r = await nc.request(subj);
    t.truthy(r);
    //@ts-ignore
    t.is(nc.protocolHandler.muxSubscriptions.length, 0);
    nc.close();
});

test('unsubscribe unsubscribes', async (t) => {
    t.plan(2);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: Payload.STRING} as NatsConnectionOptions);
    let subj = createInbox();

    let sub = await nc.subscribe(subj, () => {
    });
    t.is(nc.numSubscriptions(), 1);
    sub.unsubscribe();
    t.is(nc.numSubscriptions(), 0);
    nc.close();
});

test('flush cb calls error on close', async (t) => {
    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.close();
    nc.flush((err) => {
        let ne = err as NatsError;
        t.is(ne.code, ErrorCode.CONN_CLOSED);
        lock.unlock();
    });

    return lock.latch;
});

test('flush reject on close', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.close();
    //@ts-ignore
    await t.throwsAsync(() => {
        return nc.flush();
    }, {code: ErrorCode.CONN_CLOSED});
});

test('error if publish after close', async (t) => {
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.close();
    await t.throws(() => {
        nc.publish('foo');
    }, {code: ErrorCode.CONN_CLOSED});
});

test('server info', async (t) => {
    let lock = new Lock();
    t.plan(4);
    let sc = t.context as SC;
    let nc = await connect(sc.server.nats);
    nc.on('connect', (nc, url, info) => {
        t.truthy(info);
        //@ts-ignore
        t.truthy(info.client_id > 0);
        //@ts-ignore
        t.truthy(info.max_payload > 0);
        //@ts-ignore
        t.truthy(info.proto > 0);
        lock.unlock();
    });

    await lock.latch;
    nc.close();
});

test('timers are not left behind on close', async (t) => {
    let lock = new Lock();
    const s1 = await startServer();

    t.plan(3);
    let nc = await connect({
        url: s1.nats,
        reconnectTimeWait: 100,
        maxReconnectAttempts: 1
    });

    nc.on('connect', async (nc) => {
        const sub = await nc.subscribe("foo", () => {
            t.fail("shouldn't have received an error or message");
        }, {max: 1});
        sub.setTimeout(3000);

        nc.request("bar", 3000);

        await nc.flush();
        stopServer(s1);
    });

    nc.on('close', () => {
        //@ts-ignore
        t.is(nc.protocolHandler.pingTimer, undefined, "there should be no ping timer");

        //@ts-ignore
        const subcriptions = nc.protocolHandler.subscriptions;
        const subs = subcriptions.all();
        t.is(subs.length, 0, "there should be no subscriptions");

        //@ts-ignore
        const muxSubscriptions = nc.protocolHandler.muxSubscriptions;
        const muxsubs = muxSubscriptions.all();
        t.is(muxsubs.length, 0, "there should be no muxsubs");

        lock.unlock()
    });

    await lock.latch;
});

test('reconnect sends unsubs', (t) => {
    let conn : Client;
    const lock = new Lock();
    let unsubs = 0;
    let pongs = 0;
    t.plan(4);
    const srv = net.createServer((c) => {
        c.write(`INFO ${JSON.stringify({
            server_id: 'TEST',
            version: '0.0.0',
            host: '127.0.0.1',
            // @ts-ignore
            port: srv.address.port,
            auth_required: false
        })}\r\n`);
        c.on('data', (d) => {
            const r = d.toString();
            const lines = r.split('\r\n');
            lines.forEach((line) => {
                if (line === '') {
                    return
                }
                if (/^CONNECT\s+/.test(line)) {
                } else if (/^PING/.test(line)) {
                    c.write('PONG\r\n');
                } else if (/^PONG/.test(line)) {
                    if (pongs === 0) {
                        c.end();
                        c.destroy();
                    }
                    pongs++;
                } else if (/^SUB\s+/i.test(line)) {
                    c.write('MSG test 1 11\r\nHello World\r\n');
                } else if (/^UNSUB\s+/i.test(line)) {
                    unsubs++;
                    if (unsubs === 1) {
                        const args = line.split(' ');
                        t.is(args.length, 3);
                        // number of messages to when to unsub
                        t.is(args[2], '10');
                    }
                    if (unsubs === 2) {
                        const args = line.split(' ');
                        t.is(args.length, 3, args.join(':'));
                        t.is(args[2], '9');
                    }
                    // kick the client on the pong
                    c.write('PING\r\n');
                } else if (/^MSG\s+/i.test(line)) {
                } else if (/^INFO\s+/i.test(line)) {
                } else {
                    // unknown
                }
            })
        });
    });

    srv.listen(0, () => {
        // @ts-ignore
        const {port} = srv.address();
        connect({
            port: port,
            reconnect: true,
            reconnectTimeWait: 250
        }).then((nc) => {
            conn = nc;
            nc.on('connect', () => {
                nc.subscribe("test", (err, _) => {
                    if (err) {
                        t.fail(err.toString());
                    }
                }, { max: 10 });
                nc.on('error', (err) => {
                    t.fail(err.toString());
                    lock.unlock();
                });
                nc.on('reconnect', () => {
                    nc.flush(() => {
                        process.nextTick(() => {
                            nc.close();
                            srv.close();
                            lock.unlock();
                        });
                    })
                });
            });
        });
        srv.on('error', (err) => {
            t.fail(err.message);
        });
    });
    return lock.latch;
});