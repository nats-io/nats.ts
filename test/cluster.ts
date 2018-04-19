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
import * as url from 'url';

describe('Cluster', () => {

    let WAIT = 20;
    let ATTEMPTS = 4;

    let PORT1 = 15621;
    let PORT2 = 15622;

    let s1Url = `nats://localhost:${PORT1}`;
    let s2Url = `nats://localhost:${PORT2}`;
    let s1: Server;
    let s2: Server;

    // Start up our own nats-server
    before((done) => {
        s1 = nsc.start_server(PORT1, [], () => {
            s2 = nsc.start_server(PORT2, [], () => {
                done();
            });
        });
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_cluster([s1, s2], done);
    });

    it('should accept servers options', (done) => {
        let nc = NATS.connect({
            'servers': [s1Url, s2Url]
        } as NatsConnectionOptions);
        expect(nc).to.exist;
        expect(nc).to.haveOwnProperty('options');
        //@ts-ignore
        expect(nc.options).to.haveOwnProperty('servers');
        expect(nc).to.haveOwnProperty('servers');
        //@ts-ignore
        expect(nc.servers).to.exist;
        //@ts-ignore
        expect(nc.servers.servers).to.be.an('array');
        //@ts-ignore
        expect(nc.servers.servers).to.have.lengthOf(2);
        expect(nc).to.haveOwnProperty('url');
        nc.flush(() => {
            nc.close();
            done();
        });
    });

    it('should randomly connect to servers by default', (done) => {
        let conns: NATS.Client[] = [];
        let s1Count = 0;
        for (let i = 0; i < 100; i++) {
            let nc = NATS.connect({
                'servers': [s1Url, s2Url]
            } as NatsConnectionOptions);
            conns.push(nc);
            //@ts-ignore
            let nurl = url.format(nc.url);
            if (nurl === s1Url) {
                s1Count++;
            }
        }
        for (let i = 0; i < 100; i++) {
            conns[i].close();
        }
        expect(s1Count).to.be.within(35, 65);
        done();
    });

    it('should connect to first valid server', (done) => {
        let nc = NATS.connect({
            'servers': ['nats://localhost:21022', s1Url, s2Url]
        } as NatsConnectionOptions);
        nc.on('error', function(err) {
            done(err);
        });
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });

    it('should emit error if no servers are available', (done) => {
        let nc = NATS.connect({
            'servers': ['nats://localhost:21022', 'nats://localhost:21023']
        } as NatsConnectionOptions);
        nc.on('error', function () {
            nc.close();
            done();
        });
        nc.on('reconnecting', function () {
            // This is an error
            done('Should not receive a reconnect event');
        });
    });

    it('should not randomly connect to servers if noRandomize is set', (done) => {
        let conns: NATS.Client[] = [];
        let s1Count = 0;
        for (let i = 0; i < 100; i++) {
            let nc = NATS.connect({
                'noRandomize': true,
                'servers': [s1Url, s2Url]
            } as NatsConnectionOptions);
            conns.push(nc);
            //@ts-ignore
            let nurl = url.format(nc.url);
            if (nurl === s1Url) {
                s1Count++;
            }
        }
        for (let i = 0; i < 100; i++) {
            conns[i].close();
        }
        expect(s1Count).to.be.equal(100);
        done();
    });

    it('should fail after maxReconnectAttempts when servers killed', (done) => {
        let nc = NATS.connect({
            'noRandomize': true,
            'servers': [s1Url, s2Url],
            'reconnectTimeWait': WAIT,
            'maxReconnectAttempts': ATTEMPTS
        } as NatsConnectionOptions);
        let startTime: number;
        let numAttempts = 0;
        nc.on('connect', () => {
            nsc.stop_server(s1, function(){
                startTime = Date.now();
            });
        });
        nc.on('reconnect', () => {
            nsc.stop_server(s2);
        });
        nc.on('reconnecting', function () {
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
});
