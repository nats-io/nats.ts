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

    function testPubSub(input: any, expected?: any) {
        if (expected === undefined) {
            expected = input;
        }

        return (done: Function) => {
            const nc = NATS.connect({
                json: true,
                port: PORT
            } as NatsConnectionOptions);

            nc.subscribe('pubsub', {}, (msg: any, reply, subj, sid) => {
                expect(msg).to.deep.equal(expected);
                nc.unsubscribe(sid);
                nc.close();

                done();
            });

            nc.publish('pubsub', input);
        };
    }

    function testReqRep(input: any, expected?: any, useOldRequestStyle = false) {
        if (expected === undefined) {
            expected = input;
        }

        return (done: Function) => {
            const nc = NATS.connect({
                json: true,
                port: PORT,
                useOldRequestStyle: useOldRequestStyle
            } as NatsConnectionOptions);

            nc.subscribe('reqrep', { max: 1 }, (msg, reply) => {
                nc.publish(reply, msg);
            });

            nc.request('reqrep', input, {max: 1}, (msg: any) => {
                expect(msg).to.deep.equal(expected);
                nc.close();

                done();
            });
        };
    }

    it('should pub/sub fail with circular json', function(done) {
        let a = {};
        // @ts-ignore
        a.a = a;
        const nc = NATS.connect({
            json: true,
            port: PORT
        } as NatsConnectionOptions);

        try {
            nc.publish('foo', a);
        } catch (err) {
            nc.close();
            expect(err.message).to.be.equal('Message should be a non-circular JSON-serializable value');
            done();
        }
    });

    const testInputs = {
        json: {
            field: 'hello',
            body: 'world'
        },
        'empty array': [],
        array: [1, -2.3, 'foo', false],
        true: true,
        false: false,
        null: null,
        number: -123.45,
        'empty string': '',
        string: 'abc'
    };

    // Cannot use Object.entries because it's behind a flag in Node 6
    Object.getOwnPropertyNames(testInputs).forEach(function(name: string) {
        let data = (testInputs as any)[name];
        it(`should pub/sub with ${name}`, testPubSub(data));
        it(`should req/rep with ${name}`, testReqRep(data));
        it(`should req/rep with ${name} oldrr`, testReqRep(data, undefined, true));

        // undefined must be serialized as null
        it('should pub/sub with undefined', testPubSub(undefined, null));
        it('should req/rep with undefined', testReqRep(undefined, null));
        it('should req/rep with undefined oldrr', testReqRep(undefined, null, true));
    });
});
