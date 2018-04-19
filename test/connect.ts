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

describe('Basic Connectivity', function () {

    let PORT = 1424;
    let uri = `nats://localhost:${PORT}`;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });


    it('should perform basic connect with port', () => {
        let nc = NATS.connect(PORT);
        expect(nc).to.exist;
        nc.close();
    });

    it('should perform basic connect with uri', () => {
        let nc = NATS.connect(uri);
        expect(nc).to.exist;
        nc.close();
    });

    it('should perform basic connect with options arg', () => {
        let nc = NATS.connect({'url': uri} as NatsConnectionOptions);
        expect(nc).to.exist;
        nc.close();
    });

    it('should emit a connect event', (done) => {
        let nc = NATS.connect(PORT);
        nc.on('connect', (client) => {
            expect(client).to.be.eql(nc);
            nc.close();
            done();
        });
    });

    it('should emit error if no server available', (done) => {
        let nc = NATS.connect('nats://localhost:22222');
        nc.on('error', function () {
            nc.close();
            done();
        });
    });

    it('should emit connecting events and try repeatedly if configured and no server available', (done) => {
        let nc = NATS.connect({
            'url': 'nats://localhost:22222',
            'waitOnFirstConnect': true,
            'reconnectTimeWait': 100,
            'maxReconnectAttempts': 20
        } as NatsConnectionOptions);
        let connectingEvents = 0;
        nc.on('error', function () {
            nc.close();
            done('should not have produced error');
        });
        nc.on('reconnecting', function () {
            connectingEvents++;
        });
        setTimeout(function () {
            expect(connectingEvents).to.be.equal(5);
            done();
        }, 550);
    });


    it('should still receive publish when some servers are invalid', (done) => {
        let natsServers = ['nats://localhost:22222', uri, 'nats://localhost:22223'];
        let ua = NATS.connect({
            servers: natsServers
        } as NatsConnectionOptions);
        let ub = NATS.connect({
            servers: natsServers
        } as NatsConnectionOptions);
        let recvMsg: string;
        ua.subscribe('topic1', {}, (msg) => {
            recvMsg = msg.toString();
        });
        setTimeout(function () {
            ub.publish('topic1', 'hello');
        }, 100);
        setTimeout(function () {
            expect(recvMsg).to.be.equal('hello');
            ua.close();
            ub.close();
            done();
        }, 200);
    });


    it('should still receive publish when some servers[noRandomize] are invalid', function (done) {
        let natsServers = ['nats://localhost:22222', uri, 'nats://localhost:22223'];
        let ua = NATS.connect({
            servers: natsServers,
            noRandomize: true
        } as NatsConnectionOptions);
        let ub = NATS.connect({
            servers: natsServers,
            noRandomize: true
        } as NatsConnectionOptions);
        let recvMsg: string;
        ua.subscribe('topic1', {}, (msg) => {
            recvMsg = msg.toString();
        });
        setTimeout(function () {
            ub.publish('topic1', 'hello');
        }, 100 * 1);
        setTimeout(function () {
            expect(recvMsg).to.be.equal('hello');
            ua.close();
            ub.close();
            done();
        }, 100 * 2);
    });


    it('should add a new cluster server', (done) => {
        let servers = [uri, 'nats://localhost:22223'];
        let nc = NATS.connect({
            servers: servers.slice(0, 1)
        } as NatsConnectionOptions);
        let contains = 0;

        nc.on('connect', function (client) {
            client.servers.addServer(servers[1]);
            client.servers.getServers().forEach((_server: any) => {
                if (servers.indexOf(_server.url.href) !== -1) {
                    contains++;
                }
            });
            expect(contains).to.be.equal(servers.length);
            done();
        });
    });
});
