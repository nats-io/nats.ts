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
import {Server} from './support/nats_server_control';
import {expect} from 'chai'
import {NatsError} from "../src/error";

describe('Callbacks', () => {

    let PORT = 1429;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('should properly do a publish callback after connection is closed', (done) => {
        let nc = NATS.connect(PORT);
        nc.close();
        nc.publish('foo', "", "", (err) => {
            expect(err).to.exist;
            done();
        });
    });

    it('should properly do a flush callback after connection is closed', (done) => {
        let nc = NATS.connect(PORT);
        nc.close();
        nc.flush((err) => {
            expect(err).to.exist;
            done();
        });
    });

    it('request callbacks have message and reply', (done) => {
        let nc = NATS.connect(PORT);
        nc.flush(() => {
            nc.subscribe("rr", {}, (msg, reply) => {
                nc.publish(reply, "data", "foo");
            });
        });

        nc.flush(() => {
            nc.requestOne("rr", "", {}, 5000, function (msg, reply) {
                if (msg instanceof NatsError) {
                    nc.close();
                    done(new Error("Error making request " + msg));
                    return;
                }
                expect(msg).to.be.equal('data');
                expect(reply).to.be.equal('foo');
                nc.close();
                done();
            });
        });
    });
});
