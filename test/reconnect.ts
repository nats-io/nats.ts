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
import {SC, startServer, stopServer, Server} from './helpers/nats_server_control';
import {connect} from '../src/nats';
import url from 'url';
import {Lock} from './helpers/latch';
import {createInbox} from '../src/util';
import { Socket, createServer } from 'net'

test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server, servers: []};
});

test.after.always((t) => {
    // @ts-ignore
    stopServer(t.context.server);
    //@ts-ignore
    t.context.servers.forEach((s) => {
        stopServer(s);
    });
});

function registerServer(s: Server, t: any) {
    t.context.servers.push(s);
}

test('connect with port', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;
    let u = new url.URL(sc.server.nats);
    let port = parseInt(u.port, 10);

    let nc = await connect(port);
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect with url argument', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let nc = await connect(sc.server.nats);
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect with url in options', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let nc = await connect({url: sc.server.nats});
    nc.on('connect', (c) => {
        t.truthy(c);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('should receive when some servers are invalid', async (t) => {
    t.plan(1);
    let lock = new Lock();
    let sc = t.context as SC;

    let servers = ['nats://localhost:7', sc.server.nats];

    let nc = await connect({servers: servers, noRandomize: true});
    let subj = createInbox();
    await nc.subscribe(subj, (err) => {
        if (err) {
            t.fail(err.message);
        } else {
            t.pass();
            nc.close();
            lock.unlock();
        }
    });

    nc.publish(subj);
    return lock.latch;
});

test('reconnect events', async (t) => {
    t.plan(2);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);

    let nc = await connect({
        url: server.nats,
        waitOnFirstConnect: true,
        reconnectTimeWait: 100,
        maxReconnectAttempts: 10
    });

    let reconnecting = 0;
    let stopTime = 0;
    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server, () => {
                stopTime = Date.now();
            });
        }, 100);
    });

    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    nc.on('reconnecting', () => {
        reconnecting++;
    });

    nc.on('error', (err) => {
        t.fail('on error should not have produced error: ' + err);
    });

    nc.on('close', () => {
        t.is(reconnecting, 10, 'reconnecting count');
        t.is(disconnects, 1, 'disconnect count');
        lock.unlock();
    });

    return lock.latch;
});

test('reconnect not emitted if suppressed', async (t) => {
    t.plan(2);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);

    let nc = await connect({
        url: server.nats,
        reconnect: false
    });

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server);
        }, 100);
    });

    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    let reconnecting = false;
    nc.on('reconnecting', () => {
        reconnecting = true;
    });

    nc.on('close', () => {
        t.is(disconnects, 1);
        t.false(reconnecting);
        lock.unlock();
    });

    return lock.latch;
});

test('reconnecting after proper delay', async (t) => {
    t.plan(2);
    let lock = new Lock();

    let server = await startServer();
    registerServer(server, t);
    let nc = await connect({
        url: server.nats,
        reconnectTimeWait: 500,
        maxReconnectAttempts: 1
    });

    let serverLastConnect = 0;
    nc.on('connect', () => {
        //@ts-ignore
        serverLastConnect = nc.protocolHandler.servers.getCurrentServer().lastConnect;
        setTimeout(() => {
            stopServer(server);
        }, 100);
    });

    let disconnect = 0;
    nc.on('disconnect', () => {
        disconnect = Date.now();
    });

    nc.on('reconnecting', () => {
        let elapsed = Date.now() - serverLastConnect;
        t.true(elapsed >= 485);
        t.true(elapsed <= 600);
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('indefinite reconnects', async (t) => {
    let lock = new Lock();
    t.plan(3);

    let server: Server | null;
    server = await startServer();
    registerServer(server, t);

    let u = new url.URL(server.nats);
    let port = parseInt(u.port, 10);

    let nc = await connect({
        url: server.nats,
        reconnectTimeWait: 100,
        maxReconnectAttempts: -1
    });

    nc.on('connect', () => {
        setTimeout(() => {
            stopServer(server, () => {
                server = null;
            });
        }, 100);
    });

    setTimeout(async () => {
        server = await startServer(['-p', port.toString()]);
        registerServer(server, t);
    }, 1000);


    let disconnects = 0;
    nc.on('disconnect', () => {
        disconnects++;
    });

    let reconnectings = 0;
    nc.on('reconnecting', () => {
        reconnectings++;
    });

    let reconnects = 0;
    nc.on('reconnect', () => {
        reconnects++;
        nc.flush(() => {
            nc.close();
            t.true(reconnectings >= 5);
            t.is(reconnects, 1);
            t.is(disconnects, 1);
            lock.unlock();
        });
    });

    return lock.latch;
});

test('jitter', async(t) => {
    t.plan(2)
    let lock = new Lock();
    let socket: Socket | null = null
    const srv = createServer((c: Socket) => {
        // @ts-ignore
        socket = c
        c.write('INFO ' + JSON.stringify({
            server_id: 'TEST',
            version: '0.0.0',
            host: '127.0.0.1',
            // @ts-ignore
            port: srv.address.port,
            auth_required: false
        }) + '\r\n')
        c.on('data', (d: string) => {
            const r = d.toString()
            const lines = r.split('\r\n')
            lines.forEach((line) => {
                if (line === '\r\n') {
                    return
                }
                if (/^CONNECT\s+/.test(line)) {
                } else if (/^PING/.test(line)) {
                    c.write('PONG\r\n')

                    process.nextTick(()=> {
                        // @ts-ignore
                        socket.destroy()
                    })
                } else if (/^SUB\s+/i.test(line)) {
                } else if (/^PUB\s+/i.test(line)) {
                } else if (/^UNSUB\s+/i.test(line)) {
                } else if (/^MSG\s+/i.test(line)) {
                } else if (/^INFO\s+/i.test(line)) {
                }
            })
        })
        c.on('error', () => {
            // we are messing with the server so this will raise connection reset
        })
    })
    // @ts-ignore
    srv.sockets = []
    srv.listen(0, async () => {
        // @ts-ignore
        const p = srv.address().port
        connect({
            url: 'nats://localhost:' + p,
            reconnect: true,
            reconnectTimeWait: 100,
            reconnectJitter: 100
        }).then(async (nc) => {
            const durations: number[] = []
            let startTime: number

            nc.on('reconnect', () => {
                const elapsed = Date.now() - startTime
                durations.push(elapsed)
                if (durations.length === 10) {
                    const sum = durations.reduce((a, b) => {
                        return a + b
                    }, 0)
                    t.true(sum >= 1000 && 2000 >= sum, `${sum} >= 1000 && 2000 >= ${sum}`)
                    const extra = sum - 1000
                    t.true(extra >= 100 && 900 >= extra, `${extra} >= 100 && 900 >= ${extra}`)
                    srv.close(() => {
                        nc.close()
                        lock.unlock()
                    })
                }
            })
            nc.on('disconnect', () => {
                startTime = Date.now()
            })
        })

    })
    return lock.latch
})
