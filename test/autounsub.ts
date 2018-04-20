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

describe('Max responses and Auto-unsub', () => {

    let PORT = 1422;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should only received max responses requested', (done) => {
        let nc = NATS.connect(PORT);
        let WANT = 10;
        let SEND = 20;
        let received = 0;

        nc.subscribe('foo', {
            'max': WANT
        }, () => {
            received += 1;
        });
        for (let i = 0; i < SEND; i++) {
            nc.publish('foo');
        }
        nc.flush(() => {
            expect(received).to.exist;
            expect(received).to.be.equal(WANT);
            nc.close();
            done();
        });
    });

    it('should only received max responses requested (client support)', (done) => {
        let nc = NATS.connect(PORT);
        let WANT = 10;
        let SEND = 20;
        let received = 0;

        let sid = nc.subscribe('foo', {}, () => {
            received += 1;
        });
        for (let i = 0; i < SEND; i++) {
            nc.publish('foo');
        }
        nc.unsubscribe(sid, WANT);

        nc.flush(() => {
            expect(received).to.exist;
            expect(received).to.be.equal(WANT);
            nc.close();
            done();
        });
    });

    it('should not complain when unsubscribing an auto-unsubscribed sid', (done) => {
        let nc = NATS.connect(PORT);
        let SEND = 20;
        let received = 0;

        let sid = nc.subscribe('foo', {
            'max': 1
        }, () => {
            received += 1;
        });
        for (let i = 0; i < SEND; i++) {
            nc.publish('foo');
        }

        nc.flush(() => {
            nc.unsubscribe(sid);
            expect(received).to.exist;
            expect(received).to.be.equal(1);
            nc.close();
            done();
        });
    });

    it('should allow proper override to a lesser value ', (done) => {
        let nc = NATS.connect(PORT);
        let SEND = 20;
        let received = 0;

        let sid = nc.subscribe('foo', {}, () => {
            received += 1;
            nc.unsubscribe(sid, 1);
        });
        nc.unsubscribe(sid, SEND);

        for (let i = 0; i < SEND; i++) {
            nc.publish('foo');
        }

        nc.flush(() => {
            expect(received).to.exist;
            expect(received).to.be.equal(1);
            nc.close();
            done();
        });
    });

    it('should allow proper override to a higher value', (done) => {
        let nc = NATS.connect(PORT);
        let WANT = 10;
        let SEND = 20;
        let received = 0;

        let sid = nc.subscribe('foo', {}, () => {
            received += 1;
        });
        nc.unsubscribe(sid, 1);
        nc.unsubscribe(sid, WANT);

        for (let i = 0; i < SEND; i++) {
            nc.publish('foo');
        }

        nc.flush(() => {
            expect(received).to.exist;
            expect(received).to.be.equal(WANT);
            nc.close();
            done();
        });
    });

    it('should only receive N msgs in request mode with multiple helpers', (done) => {
        let nc = NATS.connect(PORT);
        let received = 0;

        // Create 5 helpers
        for (let i = 0; i < 5; i++) {
            nc.subscribe('help', {}, (msg, reply) => {
                nc.publish(reply, 'I can help!');
            });
        }

        nc.request('help', "", {'max': 1}, () => {
            received += 1;
            nc.flush(() => {
                expect(received).to.exist;
                expect(received).to.be.equal(1);
                nc.close();
                done();
            });
        });

    });

    function requestSubscriptions(nc: NATS.Client, done: Function) {
        let received = 0;

        nc.subscribe('help', {}, (msg, reply) => {
            nc.publish(reply, 'I can help!');
        });

        for (let i = 0; i < 5; i++) {
            nc.request('help', "", {'max': 1}, () => {
                received += 1;
            });
        }
        nc.flush(() => {
            setTimeout(() => {
                expect(received).to.be.equal(5);
                //@ts-ignore
                let expected_subs = (nc.options.useOldRequestStyle ? 1 : 2);
                //@ts-ignore
                let keys = Object.keys(nc.subs);
                expect(keys).to.have.lengthOf(expected_subs);
                nc.close();
                done();
            }, 100);
        });
    }

    it('should not leak subscriptions when using max', (done) => {
        let nc = NATS.connect(PORT);
        requestSubscriptions(nc, done);
    });

    it('oldRequest should not leak subscriptions when using max', (done) => {
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        requestSubscriptions(nc, done);
    });

    function requestGetsWantedNumberOfMessages(nc: NATS.Client, done: Function) {
        let received = 0;

        nc.subscribe('help', {}, (msg, reply) => {
            nc.publish(reply, 'I can help!');
            nc.publish(reply, 'I can help!');
            nc.publish(reply, 'I can help!');
            nc.publish(reply, 'I can help!');
            nc.publish(reply, 'I can help!');
            nc.publish(reply, 'I can help!');
        });

        nc.request('help', "", {max: 3}, () => {
            received++;
        });

        nc.flush(() => {
            setTimeout(() => {
                expect(received).to.be.equal(3);
                nc.close();
                done();
            }, 100);
        });
    }

    it('request should received specified number of messages', (done) => {
        /* jshint loopfunc: true */
        let nc = NATS.connect(PORT);
        requestGetsWantedNumberOfMessages(nc, done);
    });

    it('old request should received specified number of messages', (done) => {
        /* jshint loopfunc: true */
        let nc = NATS.connect({port: PORT, useOldRequestStyle: true} as NatsConnectionOptions);
        requestGetsWantedNumberOfMessages(nc, done);
    });
});
