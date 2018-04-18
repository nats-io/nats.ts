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
import {sleep} from './support/sleep';


describe('Yield', () => {
    let PORT = 1469;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should yield to other events', (done) => {
        let nc = NATS.connect({
            port: PORT,
            yieldTime: 5
        } as NatsConnectionOptions);

        let start = Date.now();

        let timer = setInterval(() => {
            let delta = Date.now() - start;
            nc.close();
            clearTimeout(timer);
            expect(delta).to.be.within(10, 25);
            done();
        }, 10);

        nc.subscribe('foo', {}, () => {
            sleep(1);
        });

        for (let i = 0; i < 256; i++) {
            nc.publish('foo', 'hello world');
        }
    });
});
