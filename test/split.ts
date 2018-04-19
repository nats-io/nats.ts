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

describe('Split Messages', () => {

    let PORT = 1427;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should properly handle large # of messages from split buffers', (done) => {
        let nc = NATS.connect(PORT);
        let data = 'Hello World!';
        let received = 0;
        let expected = 10000;

        nc.subscribe('foo', {}, (msg) => {
            expect(msg).to.exist;
            expect(msg).to.be.equal(data);
            expect(msg.toString().length).to.be.equal(data.length);

            received += 1;
            if (received == expected) {
                nc.close();
                done();
            }
        });

        for (let i = 0; i < expected; i++) {
            nc.publish('foo', data);
        }
    });

    it('should properly handle large # of utf8 messages from split buffers', (done) => {
        let nc = NATS.connect(PORT);

        // Use utf8 string to make sure encoding works too.
        let data = '½ + ¼ = ¾';
        let received = 0;
        let expected = 10000;

        nc.subscribe('foo', {}, (msg) => {
            expect(msg).to.exist;
            expect(msg).to.be.equal(data);
            expect(msg.toString().length).to.be.equal(data.length);

            received += 1;
            if (received == expected) {
                done();
            }
        });

        for (let i = 0; i < expected; i++) {
            nc.publish('foo', data);
        }
    });

});
