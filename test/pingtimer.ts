/*
 * Copyright 2018 The NATS Authors
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
 *
 */

import * as NATS from '../src/nats'
import {NatsConnectionOptions} from '../src/nats'
import * as mockserver from './support/mock_server';
import {expect} from 'chai'

describe('Ping Timer', function () {
    this.timeout(10000);
    let PORT = 1966;
    let server: mockserver.ScriptedServer;

    before(function (done) {
        server = new mockserver.ScriptedServer(PORT);
        server.on('listening', done);
        server.start();
    });

    after((done) => {
        server.stop(done);
    });

    it('should reconnect if server doesnt ping', (done) => {
        let opts = {
            port: PORT,
            pingInterval: 200,
            maxReconnectAttempts: 1
        } as NATS.NatsConnectionOptions;

        let nc = NATS.connect(opts);
        nc.on('reconnect', () => {
            nc.close();
            done();
        })
    });

    it('timer pings are sent', (done) => {
        let opts = {
            port: PORT,
            pingInterval: 200,
            maxPingOut: 5,
            maxReconnectAttempts: 1
        } as NatsConnectionOptions;

        let nc = NATS.connect(opts);

        let pingTimerFired = false;
        nc.on('pingtimer', () => {
            pingTimerFired = true;
        });

        nc.on('reconnect', () => {
            nc.close();
            expect(pingTimerFired).to.be.true;
            done();
        });
    });

    it('configured number of missed pings is honored', (done) => {
        let nc = NATS.connect({
            port: PORT,
            pingInterval: 200,
            maxPingOut: 5,
            maxReconnectAttempts: 1
        } as NatsConnectionOptions);

        let maxOut = 0;
        nc.on('pingcount', (c) => {
            maxOut = Math.max(maxOut, c);
        });

        nc.on('reconnect', () => {
            nc.close();
            expect(maxOut).be.equal(5);
            done();
        });
    });
});
