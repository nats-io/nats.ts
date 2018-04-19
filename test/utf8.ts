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

describe('UTF8', () => {

    let PORT = 1430;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should do publish and subscribe with UTF8 payloads by default', (done) => {
        let nc = NATS.connect(PORT);
        // ½ + ¼ = ¾: 9 characters, 12 bytes
        let data = '\u00bd + \u00bc = \u00be';
        expect(data).to.have.lengthOf(9);
        expect(Buffer.byteLength(data)).to.be.equal(12);

        nc.subscribe('utf8', {}, (msg) => {
            expect(msg).to.be.equal(data);
            expect(msg).to.have.length(9);
            expect(Buffer.byteLength(msg.toString())).to.be.equal(12);
            nc.close();
            done();
        });

        nc.publish('utf8', data);
    });

    it('should allow encoding override with the encoding option', (done) => {
        let nc = NATS.connect({
            'url': `nats://localhost:${PORT}`,
            'encoding': 'ascii'
        } as NatsConnectionOptions);
        // ½ + ¼ = ¾: 9 characters, 12 bytes
        let utf8_data = '\u00bd + \u00bc = \u00be';
        let plain_data = 'Hello World';

        nc.subscribe('utf8', {}, (msg) => {
            // Should be all 12 bytes..
            expect(msg).to.have.lengthOf(12);
            // Should not be a proper utf8 string.
            expect(msg).to.not.be.equal(utf8_data);
        });

        nc.subscribe('plain', {}, (msg) => {
            expect(msg).to.be.equal(plain_data);
            nc.close();
            done();
        });

        nc.publish('utf8', utf8_data);
        nc.publish('plain', plain_data);
    });

    it('should not allow unsupported encodings', (done) => {
        try {
            //@ts-ignore - the encoding is verified by typescript
            let opts = {
                'url': `nats://localhost:${PORT}`,
                'encoding': 'foobar'
            } as NatsConnectionOptions;

            NATS.connect(opts);
            done('No error thrown, wanted Invalid Encoding Exception');
        } catch (err) {
            if (err.toString().indexOf('Invalid Encoding') < 0) {
                done('Bad Error, wanted Invalid Encoding');
            } else {
                done();
            }
        }
    });
});
