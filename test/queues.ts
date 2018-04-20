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

describe('Queues', () => {

    let PORT = 1425;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should deliver a message to single member of a queue group', (done) => {
        let nc = NATS.connect(PORT);
        let received = 0;
        nc.subscribe('foo', {'queue': 'myqueue'}, () => {
            received += 1;
        });
        nc.publish('foo', () => {
            expect(received).to.be.equal(1);
            nc.close();
            done();
        });
    });

    it('should deliver a message to only one member of a queue group', (done) => {
        let nc = NATS.connect(PORT);
        let received = 0;
        for (let i = 0; i < 5; i++) {
            nc.subscribe('foo', {'queue': 'myqueue'}, () => {
                received += 1;
            });
        }
        nc.publish('foo', () => {
            expect(received).to.be.equal(1);
            nc.close();
            done();
        });
    });

    it('should allow queue subscribers and normal subscribers to work together', (done) => {
        let nc = NATS.connect(PORT);
        let expected = 4;
        let received = 0;

        function recv(): void {
            received += 1;
            if (received == expected) {
                nc.close();
                done();
            }
        }

        nc.subscribe('foo', {'queue': 'myqueue'}, recv);
        nc.subscribe('foo', {}, recv);
        nc.publish('foo');
        nc.publish('foo');
        nc.flush();
    });

    it('should spread messages out equally (given random)', (done) => {
        let nc = NATS.connect(PORT);
        let total = 5000;
        let numSubscribers = 10;
        let avg = total / numSubscribers;
        let allowedVariance = total * 0.05;
        let received = new Array(numSubscribers);

        for (let i = 0; i < numSubscribers; i++) {
            received[i] = 0;
            nc.subscribe('foo.bar', {'queue': 'spreadtest'}, (function (index) {
                return () => {
                    received[index] += 1;
                };
            }(i)));
        }

        for (let i = 0; i < total; i++) {
            nc.publish('foo.bar', 'ok');
        }

        nc.flush(() => {
            for (let i = 0; i < numSubscribers; i++) {
                expect(Math.abs(received[i] - avg)).to.be.below(allowedVariance);
            }
            nc.close();
            done();
        });
    });

    it('should deliver only one mesage to queue subscriber regardless of wildcards', (done) => {
        let nc = NATS.connect(PORT);
        let received = 0;
        nc.subscribe('foo.bar', {'queue': 'wcqueue'}, () => {
            received += 1;
        });
        nc.subscribe('foo.*', {'queue': 'wcqueue'}, () => {
            received += 1;
        });
        nc.subscribe('foo.>', {'queue': 'wcqueue'}, () => {
            received += 1;
        });
        nc.publish('foo.bar', () => {
            expect(received).to.be.equal(1);
            nc.close();
            done();
        });
    });

    it('should deliver to multiple queue groups', (done) => {
        let nc = NATS.connect(PORT);
        let received1 = 0;
        let received2 = 0;
        let count = 10;

        nc.subscribe('foo.bar', {'queue': 'r1'}, () => {
            received1 += 1;
        });
        nc.subscribe('foo.bar', {'queue': 'r2'}, () => {
            received2 += 1;
        });

        for (let i = 0; i < count; i++) {
            nc.publish('foo.bar');
        }

        nc.flush(() => {
            expect(received1).to.be.equal(count);
            expect(received2).to.be.equal(count);
            nc.close();
            done();
        });
    });
});
