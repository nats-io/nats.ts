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
import {expect} from 'chai'
import {Server} from "../lib/test/support/nats_server_control";
import {NatsConnectionOptions} from "../lib/src/nats";

describe('JSON payloads', () => {

    let PORT = 1423;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should pub/sub with json', (done) => {
        let nc = NATS.connect({
            json: true,
            port: PORT
        } as NatsConnectionOptions);

        let payload = {
            field: 'hello',
            body: 'world'
        };

        nc.subscribe('foo', {}, (msg, reply, subj, sid) => {
            expect(msg).to.be.eql(payload);
            nc.unsubscribe(sid);
            nc.close();
            done();
        });

        nc.publish('foo', payload);
    });

    it('should pub/sub fail not json', (done) => {
        let nc = NATS.connect({
            json: true,
            port: PORT
        } as NatsConnectionOptions);
        try {
            nc.publish('foo', 'hi');
        } catch (err) {
            nc.close();
            expect(err.message).to.be.equal('Message should be a JSON object');
            done();
        }
    });

    it('should pub/sub array with json', (done) => {
        let nc = NATS.connect({
            json: true,
            port: PORT
        } as NatsConnectionOptions);

        let payload = ['one', 'two', 'three'];

        nc.subscribe('foo', {}, (msg, reply, subj, sid) => {
            expect(msg).to.be.eql(payload);
            nc.unsubscribe(sid);
            nc.close();
            done();
        });

        nc.publish('foo', payload);
    });
});
