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
import * as nsc from './support/nats_server_control';
import {Server} from './support/nats_server_control';
import {expect} from 'chai'


describe('Timeout and max received events for subscriptions', () => {
    let PORT = 1428;

    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should perform simple timeouts on subscriptions', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            let startTime = Date.now();
            let sid = nc.subscribe('foo');
            nc.timeout(sid, 50, 1, () => {
                let elapsed = Date.now() - startTime;
                expect(elapsed).to.be.within(45, 75);
                nc.close();
                done();
            });
        });
    });

    it('should not timeout if exepected has been received', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            let sid = nc.subscribe('foo');
            nc.timeout(sid, 50, 1, () => {
                done(new Error('Timeout improperly called'));
            });
            nc.publish('foo', () => {
                nc.close();
                done();
            });
        });
    });


    it('should not timeout if unsubscribe is called', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            let count = 0;
            let sid = nc.subscribe('bar', {}, () => {
                count++;
                if (count === 1) {
                    nc.unsubscribe(sid);
                }
            });
            nc.timeout(sid, 1000, 2, () => {
                done(new Error('Timeout improperly called'));
            });
            nc.publish('bar', '');
            nc.flush();
            setTimeout(() => {
                // terminate the test
                done();
            }, 1500);
        });
    });

    it('timeout should unsubscribe', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            let count = 0;
            let sid = nc.subscribe('bar', {}, () => {
                count++;
            });
            nc.timeout(sid, 250, 2, () => {
                process.nextTick(() => {
                    nc.publish('bar');
                    nc.flush();
                });
            });
            setTimeout(() => {
                nc.close();
                expect(count).to.equal(0);
                done();
            }, 1000);
        });
    });


    it('should perform simple timeouts on requests', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            nc.request('foo', "", {max: 1, timeout: 1000}, (err) => {
                expect(err).to.be.instanceOf(NATS.NatsError);
                //@ts-ignore
                expect(err.code).to.be.equal(NATS.REQ_TIMEOUT);
                nc.close();
                done();
            });
        });
    });

    it('should perform simple timeouts on requests without specified number of messages', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', () => {
            nc.subscribe('foo', {}, (msg, reply) => {
                nc.publish(reply);
            });

            let responses = 0;
            nc.request('foo', "", {max: 2, timeout: 1000}, (err) => {
                if (!err.hasOwnProperty('code')) {
                    responses++;
                    return;
                }
                expect(responses).to.be.equal(1);
                expect(err).to.be.instanceOf(NATS.NatsError);
                //@ts-ignore
                expect(err.code).to.be.equal(NATS.REQ_TIMEOUT);
                nc.close();
                done();
            });
        });
    });

    it('should override request autoset timeouts', (done) => {
        let nc = NATS.connect(PORT);
        let calledOnRequestHandler = false;
        nc.on('connect', () => {
            let sid = nc.request('foo', "", {max: 2, timeout: 1000}, () => {
                calledOnRequestHandler = true;
            });

            nc.timeout(sid, 1500, 2, function (v) {
                expect(calledOnRequestHandler).to.be.false;
                expect(v).to.be.equal(sid);
                nc.close();
                done();
            });
        });
    });
});
