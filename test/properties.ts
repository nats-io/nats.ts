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
import {expect} from 'chai'
import {NatsConnectionOptions} from "../lib/src/nats";
import * as _ from 'lodash';
import * as nsc from "./support/nats_server_control";
import {Server} from "../lib/test/support/nats_server_control";

describe('Base Properties', () => {

    it('should have a version property', () => {
        expect(NATS.VERSION).to.match(/[0-9]+\.[0-9]+\.[0-9]+/);
    });

    it('should have the same version as package.json', () => {
        let pkg = require('../package.json');
        expect(NATS.VERSION).to.be.equal(pkg.version);
    });

    it('should have a connect function', () => {
        expect(NATS.connect).to.be.a('function');
    });

    it('should have a createInbox function', () => {
        expect(NATS.createInbox).to.be.a('function');
    });
});

describe('Connection Properties', () => {
    let PORT = 5683;
    let server: Server;
    let nc: NATS.Client;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], () => {
            nc = NATS.connect(PORT);
            expect(nc).to.exist;
            done();
        });
    });

    // Shutdown our server
    after((done) => {
        nc.close();
        nsc.stop_server(server, done);
    });

    it('should have a publish function', () => {
        expect(nc.publish).to.be.a('function');
    });

    it('should have a subscribe function', () => {
        expect(nc.subscribe).to.be.a('function');
    });

    it('should have an unsubscribe function', () => {
        expect(nc.unsubscribe).to.be.a('function');
    });

    it('should have a request function', () => {
        expect(nc.request).to.be.a('function');
    });

    it('should have a requestOne function', () => {
        expect(nc.requestOne).to.be.a('function');
    });

    it('should have an options hash with proper fields', () => {
        expect(nc).to.haveOwnProperty('options');

        let props = [
            'encoding',
            'maxPingOut',
            'maxReconnectAttempts',
            'noRandomize',
            'pedantic',
            'reconnect',
            'reconnectTimeWait',
            'tls',
            'url',
            'useOldRequestStyle',
            'verbose',
            'waitOnFirstConnect'
        ];

        props.forEach((pn) => {
            //@ts-ignore
            expect(nc.options).to.haveOwnProperty(pn);
        });
        //@ts-ignore
        expect(nc.options.useOldRequestStyle).to.be.false;
    });

    it('should have an parsed url', () => {
        expect(nc).to.haveOwnProperty('url');
        //@ts-ignore
        let url = nc.url;
        expect(url).to.exist;
        expect(url).to.haveOwnProperty('protocol');
        expect(url).to.haveOwnProperty('host');
        expect(url).to.haveOwnProperty('port');
    });

    it('should allow options to be overridden', () => {
        let options = {
            'url': `nats://localhost:${PORT}`,
            'verbose': true,
            'pedantic': true,
            'reconnect': false,
            'maxReconnectAttempts': 22,
            'reconnectTimeWait': 11,
            'useOldRequestStyle': true,
        } as NatsConnectionOptions;

        console.log(options.url);

        nc = NATS.connect(options);
        nc.on('error', () => {
        }); // Eat error

        _.forIn(options, (v, k) => {
            //@ts-ignore
            expect(nc.options).to.haveOwnProperty(k);
            //@ts-ignore
            expect(nc.options[k]).to.be.equal(v);
        });
    });
});
