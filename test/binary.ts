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

/* jslint node: true */
/* global describe: false, before: false, after: false, it: false */
'use strict';

import * as NATS from '../src/nats';
import * as nsc from './support/nats_server_control';
import * as crypto from 'crypto';
import {expect} from 'chai'
import {Server} from "../lib/test/support/nats_server_control";
import {NatsConnectionOptions} from "../lib/src/nats";


describe('Binary', () => {

    let PORT = 1432;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });


    function binaryDataTests(done: Function, nc: NATS.Client) {
        // try some invalid utf-8 byte sequences
        let invalid2octet = new Buffer('\xc3\x28', 'binary');
        let invalidsequenceidentifier = new Buffer('\xa0\xa1', 'binary');
        let invalid3octet = new Buffer('\xe2\x28\xa1', 'binary');
        let invalid4octet = new Buffer('\xf0\x90\x28\xbc', 'binary');
        let bigBuffer = crypto.randomBytes(128 * 1024);

        // make sure embedded nulls don't cause truncation
        let embeddednull = new Buffer('\x00\xf0\x00\x28\x00\x00\xf0\x9f\x92\xa9\x00', 'binary');

        let count = 6;

        function finished() {
            if (--count <= 0) {
                nc.close();
                done();
            }
        }

        nc.subscribe('invalid2octet', {}, (msg) => {
            expect(msg).lengthOf(2);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(invalid2octet);
            } else {
                expect(msg).to.be.equal(invalid2octet.toString('binary'));
            }
            finished();
        });

        nc.subscribe('invalidsequenceidentifier', {}, (msg) => {
            expect(msg).lengthOf(2);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(invalidsequenceidentifier);
            } else {
                expect(msg).to.be.equal(invalidsequenceidentifier.toString('binary'));
            }
            finished();
        });

        nc.subscribe('invalid3octet', {}, (msg) => {
            expect(msg).lengthOf(3);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(invalid3octet);
            } else {
                expect(msg).to.be.equal(invalid3octet.toString('binary'));
            }
            finished();
        });

        nc.subscribe('invalid4octet', {}, (msg) => {
            expect(msg).lengthOf(4);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(invalid4octet);
            } else {
                expect(msg).to.be.equal(invalid4octet.toString('binary'));
            }
            finished();
        });

        nc.subscribe('embeddednull', {}, (msg) => {
            expect(msg).lengthOf(11);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(embeddednull);
            } else {
                expect(msg).to.be.equal(embeddednull.toString('binary'));
            }
            finished();
        });

        nc.subscribe('bigbuffer', {}, (msg) => {
            expect(msg).lengthOf(bigBuffer.length);
            //@ts-ignore
            if (nc.options.preserveBuffers) {
                expect(msg).to.be.eql(bigBuffer);
            } else {
                expect(msg).to.be.equal(bigBuffer.toString('binary'));
            }
            finished();
        });

        nc.publish('invalid2octet', invalid2octet);
        nc.publish('invalidsequenceidentifier', invalidsequenceidentifier);
        nc.publish('invalid3octet', invalid3octet);
        nc.publish('invalid4octet', invalid4octet);
        nc.publish('embeddednull', embeddednull);
        nc.publish('bigbuffer', bigBuffer);
    }

    it('should allow sending and receiving binary data', (done) => {
        let nc = NATS.connect({
            'url': 'nats://localhost:' + PORT,
            'encoding': 'binary'
        } as NatsConnectionOptions);
        binaryDataTests(done, nc);
    });

    it('should allow sending binary buffers', (done) => {
        let nc = NATS.connect({
            'url': 'nats://localhost:' + PORT,
            'preserveBuffers': true
        } as NatsConnectionOptions);
        binaryDataTests(done, nc);
    });

    it('should not append control characters on chunk processing', (done) => {
        let nc = NATS.connect({
            'url': 'nats://localhost:' + PORT,
            'preserveBuffers': true
        } as NatsConnectionOptions);
        let buffer = crypto.randomBytes(1024);

        let count = 0;
        let finished = () => {

            if (++count === 100) {
                nc.close();
                done();
            }
        };

        nc.subscribe('trailingData', {}, (msg) => {
            expect(msg).to.be.eql(buffer);
            finished();
        });

        for (let i = 0; i <= 100; i++) {
            nc.publish('trailingData', buffer);
        }
    });
});
