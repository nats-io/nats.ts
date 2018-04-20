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
import * as fs from 'fs';


describe('TLS', () => {

    let PORT = 1442;
    let TLSPORT = 1443;
    let TLSVERIFYPORT = 1444;

    let server: Server;
    let tlsServer: Server;
    let tlsVerifyServer: Server;

    // Start up our own nats-server for each test
    // We will start a plain, a no client cert, and a client cert required.
    before((done) => {
        server = nsc.start_server(PORT, [], () => {
            let flags = ['--tls', '--tlscert', './test/certs/server-cert.pem',
                '--tlskey', './test/certs/server-key.pem'
            ];
            tlsServer = nsc.start_server(TLSPORT, flags, () => {
                let flags = ['--tlsverify', '--tlscert', './test/certs/server-cert.pem',
                    '--tlskey', './test/certs/server-key.pem',
                    '--tlscacert', './test/certs/ca.pem'
                ];
                tlsVerifyServer = nsc.start_server(TLSVERIFYPORT, flags, done);
            });
        });
    });


    // Shutdown our server after each test.
    after((done) => {
        nsc.stop_cluster([server, tlsServer, tlsVerifyServer], done);
    });

    it('should error if server does not support TLS', (done) => {
        let nc = NATS.connect({
            port: PORT,
            tls: true
        } as NatsConnectionOptions);
        nc.on('error', function(err) {
            expect(err).to.exist;
            expect(err).to.match(/Server does not support a secure/);
            nc.close();
            done();
        });
    });

    it('should error if server requires TLS', (done) => {
        let nc = NATS.connect(TLSPORT);
        nc.on('error', function(err) {
            expect(err).to.exist;
            expect(err).to.match(/Server requires a secure/);
            nc.close();
            done();
        });
    });

    it('should reject without proper CA', (done) => {
        let nc = NATS.connect({
            port: TLSPORT,
            tls: true
        } as NatsConnectionOptions);
        nc.on('error', function(err) {
            expect(err).to.exist;
            expect(err).to.match(/unable to verify the first certificate/);
            nc.close();
            done();
        });
    });

    it('should connect if authorized is overridden', (done) => {
        let tlsOptions = {
            rejectUnauthorized: false,
        };
        let nc = NATS.connect({
            port: TLSPORT,
            tls: tlsOptions
        } as NatsConnectionOptions);

        expect(nc).to.exist;
        nc.on('connect', function(client) {
            expect(client).to.be.eql(nc);
            //@ts-ignore
            expect(nc.stream.authorized).to.be.false;
            nc.close();
            done();
        });
    });

    it('should connect with proper ca and be authorized', (done) => {
        let tlsOptions = {
            ca: [fs.readFileSync('./test/certs/ca.pem')]
        };
        let nc = NATS.connect({
            port: TLSPORT,
            tls: tlsOptions
        } as NatsConnectionOptions);

        expect(nc).to.exist;
        nc.on('connect', function(client) {
            expect(client).to.be.eql(nc);
            //@ts-ignore
            expect(nc.stream.authorized).to.be.true;
            nc.close();
            done();
        });
    });

    it('should reject without proper cert if required by server', (done) => {
        let nc = NATS.connect({
            port: TLSVERIFYPORT,
            tls: true
        } as NatsConnectionOptions);
        nc.on('error', function(err) {
            expect(err).to.exist;
            expect(err).to.match(/Server requires a client certificate/);
            nc.close();
            done();
        });
    });


    it('should be authrorized with proper cert', (done) => {
        let tlsOptions = {
            key: fs.readFileSync('./test/certs/client-key.pem'),
            cert: fs.readFileSync('./test/certs/client-cert.pem'),
            ca: [fs.readFileSync('./test/certs/ca.pem')]
        };
        let nc = NATS.connect({
            port: TLSPORT,
            tls: tlsOptions
        } as NatsConnectionOptions);
        nc.on('connect', function(client) {
            expect(client).to.be.eql(nc);
            //@ts-ignore
            expect(nc.stream.authorized).to.be.true;
            nc.close();
            done();
        });
    });

});
