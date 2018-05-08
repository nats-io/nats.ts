/*
 * Copyright 2013-2018 The NATS Authors
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
 */

import * as NATS from '../src/nats';
import {NatsConnectionOptions} from '../src/nats';
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai'

describe('Reconnect functionality', () => {

    let PORT = 1426;
    let WAIT = 20;
    let ATTEMPTS = 4;
    let server: Server | null;

    // Start up our own nats-server
    beforeEach((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    afterEach((done) => {
        nsc.stop_server(server, done);
    });

    it('should not emit a reconnecting event if suppressed', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnect': false
        } as NatsConnectionOptions);

        expect(nc).to.exist;

        nc.on('connect', () => {
            nsc.stop_server(server);
        });
        nc.on('reconnecting', () => {
            done(new Error('Reconnecting improperly called'));
        });
        nc.on('close', () => {
            nc.close();
            done();
        });
    });

    it('should emit a disconnect and a reconnecting event after proper delay', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': WAIT
        } as NatsConnectionOptions);
        let startTime: number;
        expect(nc).to.exist;
        nc.on('connect', () => {
            nsc.stop_server(server, () => {
                startTime = Date.now();
            });
        });
        nc.on('reconnecting', () => {
            let elapsed = Date.now() - startTime;
            expect(elapsed).to.be.within(WAIT, 5 * WAIT);
            nc.close();
            done();
        });
        nc.on('disconnect', () => {
            let elapsed = Date.now() - startTime;
            expect(elapsed).to.be.within(0, 5 * WAIT);
        });
    });

    it('should emit multiple reconnecting events and fail after maxReconnectAttempts', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': WAIT,
            'maxReconnectAttempts': ATTEMPTS
        } as NatsConnectionOptions);
        let startTime: number;
        let numAttempts = 0;
        nc.on('connect', () => {
            nsc.stop_server(server, function(){
                startTime = Date.now();
            });
        });
        nc.on('reconnecting', () => {
            let elapsed = Date.now() - startTime;
            expect(elapsed).to.be.within(WAIT, 5 * WAIT);
            startTime = Date.now();
            numAttempts += 1;
        });
        nc.on('close', () => {
            expect(numAttempts).to.be.equal(ATTEMPTS);
            nc.close();
            done();
        });
    });

    it('should emit reconnecting events indefinitely if maxReconnectAttempts is set to -1', (done) => {

        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': WAIT,
            'maxReconnectAttempts': -1
        } as NatsConnectionOptions);
        let numAttempts = 0;

        // stop trying after an arbitrary amount of elapsed time
        setTimeout(() => {
            // restart server and make sure next flush works ok
            if (server === null) {
                server = nsc.start_server(PORT);
            }
        }, 1000);

        nc.on('connect', () => {
            nsc.stop_server(server, () => {
                server = null;
            });
        });
        nc.on('reconnecting', () => {
            numAttempts += 1;
            // attempt indefinitely to reconnect
            //@ts-ignore
            expect(nc.reconnects).to.be.equal(numAttempts);
            //@ts-ignore
            expect(nc.connected).to.be.false;
            //@ts-ignore
            expect(nc.wasConnected).to.be.true;
            //@ts-ignore
            expect(nc.reconnecting).to.be.true;
            // if maxReconnectAttempts is set to -1, the number of reconnects will always be greater
            //@ts-ignore
            expect(nc.reconnects).to.be.above(nc.options.maxReconnectAttempts);
        });
        nc.on('reconnect', () => {
            nc.flush(() => {
                nc.close();
                done();
            });
        });
    });

    it('should succesfully reconnect to new server', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        // Kill server after first successful contact
        nc.flush(() => {
            nsc.stop_server(server, function(){
                server = null;
            });
        });
        nc.on('reconnecting', () => {
            // restart server and make sure next flush works ok
            if (server === null) {
                server = nsc.start_server(PORT);
            }
        });
        nc.on('reconnect', () => {
            nc.flush(() => {
                nc.close();
                done();
            });
        });
    });

    it('should succesfully reconnect to new server with subscriptions', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        // Kill server after first successful contact
        nc.flush(() => {
            nsc.stop_server(server, () => {
                server = null;
            });
        });
        nc.subscribe('foo', {}, () => {
            nc.close();
            done();
        });
        nc.on('reconnecting', () => {
            // restart server and make sure next flush works ok
            if (server === null) {
                server = nsc.start_server(PORT);
            }
        });
        nc.on('reconnect', () => {
            nc.publish('foo');
        });
    });

    it('should succesfully reconnect to new server with queue subscriptions correctly', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        // Kill server after first successful contact
        nc.flush(() => {
            nsc.stop_server(server, () => {
                server = null;
            });
        });
        let received = 0;
        // Multiple subscribers
        for (let i = 0; i < 5; i++) {
            nc.subscribe('foo', {'queue': 'myReconnectQueue'}, () => {
                received += 1;
            });
        }
        nc.on('reconnecting', () => {
            // restart server and make sure next flush works ok
            if (server === null) {
                server = nsc.start_server(PORT);
            }
        });
        nc.on('reconnect', () => {
            nc.publish('foo', () => {
                expect(received).to.be.equal(1);
                nc.close();
                done();
            });
        });
    });

    it('should properly resync with inbound buffer non-nil', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);

        // Send lots of data to ourselves
        nc.on('connect', () => {
            let sid = nc.subscribe('foo', {}, () => {
                // Kill server on first message, inbound should still be full.
                nsc.stop_server(server, () => {
                    nc.unsubscribe(sid);
                    server = nsc.start_server(PORT);
                });
            });
            let b = Buffer.allocUnsafe(4096).toString();
            for (let i = 0; i < 1000; i++) {
                nc.publish('foo', b);
            }
        });

        nc.on('reconnect', () => {
            nc.flush(() => {
                nc.close();
                done();
            });
        });
    });

    it('should not crash when sending a publish with a callback after connection loss', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': WAIT
        } as NatsConnectionOptions);
        let startTime: number;
        expect(nc).to.exist;
        nc.on('connect', () => {
            nsc.stop_server(server, () => {
                startTime = Date.now();
            });
        });
        nc.on('disconnect', () => {
            nc.publish('foo', 'bar', 'reply', () => {
                // fails to get here, but should not crash
            });
            server = nsc.start_server(PORT);
        });
        nc.on('reconnect', () => {
            nc.flush(() => {
                nc.close();
                done();
            });
        });
    });

    it('should execute callbacks if published during reconnect', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        nc.on('reconnecting', () => {
            // restart server
            if (server === null) {
                nc.publish('foo', () => {
                    nc.close();
                    done();
                });
                server = nsc.start_server(PORT);
            }
        });
        nc.on('connect', () => {
            let s = server;
            server = null;
            nsc.stop_server(s);
        });
    });

    it('should not lose messages if published during reconnect', (done) => {
        // This checks two things if the client publishes while reconnecting:
        // 1) the message is published when the client reconnects
        // 2) the client's subscriptions are synced before the message is published
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        nc.subscribe('foo', {}, () => {
            nc.close();
            done();
        });
        nc.on('reconnecting', () => {
            // restart server
            if (server === null) {
                nc.publish('foo');
                server = nsc.start_server(PORT);
            }
        });
        nc.on('connect', () => {
            let s = server;
            server = null;
            nsc.stop_server(s);
        });
    });

    it('should emit reconnect before flush callbacks are called', (done) => {
        let nc = NATS.connect({
            'port': PORT,
            'reconnectTimeWait': 100
        } as NatsConnectionOptions);
        let reconnected = false;
        nc.on('reconnecting', () => {
            // restart server
            if (server === null) {
                nc.flush(() => {
                    nc.close();
                    if (!reconnected) {
                        done(new Error('Flush callback called before reconnect emitted'));
                    }
                    done();
                });
                server = nsc.start_server(PORT);
            }
        });
        nc.on('reconnect', () => {
            reconnected = true;
        });
        nc.on('connect', () => {
            let s = server;
            server = null;
            nsc.stop_server(s);
        });
    });
});
