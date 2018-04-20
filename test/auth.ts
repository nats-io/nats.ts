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


describe('Authorization', () => {
    let PORT = 1421;
    let flags = ['--user', 'derek', '--pass', 'foobar'];
    let authUrl = `nats://derek:foobar@localhost:${PORT}`;
    let noAuthUrl = `nats://localhost:${PORT}`;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, flags, done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should fail to connect with no credentials ', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('error', function(err) {
            expect(err).to.exist;
            expect(err.message).to.match(/Authorization/);
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials in url', (done) => {
        let nc = NATS.connect(authUrl);
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials as options', (done) => {
        let nc = NATS.connect({
            'url': noAuthUrl,
            'user': 'derek',
            'pass': 'foobar'
        } as NatsConnectionOptions);
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials as server url', (done) => {
        let nc = NATS.connect({
            'servers': [authUrl]
        } as NatsConnectionOptions);
        nc.on('connect', function () {
            nc.close();
            done();
        });
    });
});

describe('Token Authorization', () => {
    let PORT = 1421;
    let flags = ['--auth', 'token1'];
    let authUrl = 'nats://token1@localhost:' + PORT;
    let noAuthUrl = 'nats://localhost:' + PORT;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, flags, done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should fail to connect with no credentials ', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('error', (err) => {
            expect(err).to.exist;
            expect(err).to.match(/Authorization/);
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials in url', (done) => {
        let nc = NATS.connect(authUrl);
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials as options', (done) => {
        let nc = NATS.connect({
            'url': noAuthUrl,
            'token': 'token1'
        } as NatsConnectionOptions);
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });

    it('should connect with proper credentials as server url', (done) => {
        let nc = NATS.connect({
            'servers': [authUrl]
        } as NatsConnectionOptions);
        nc.on('connect', () => {
            nc.close();
            done();
        });
    });
});
