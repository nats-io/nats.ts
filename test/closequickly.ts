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
import * as child_process from "child_process";
import Timer = NodeJS.Timer;

describe('Close functionality', () => {

    let PORT = 8459;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        server = nsc.start_server(PORT, [], done);
    });

    // Shutdown our server after we are done
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('close quickly', (done) => {
        let nc = NATS.connect({
            port: PORT
        } as NatsConnectionOptions);

        let timer: Timer | null;

        nc.flush(() => {
            nc.subscribe("started", {}, () => {
                nc.publish("close");
            });

            timer = setTimeout(() => {
                done(new Error("process didn't exit quickly"));
            }, 10000);
        });

        let child = child_process.execFile('ts-node', ['./test/support/exiting_client.ts', PORT.toString()], (error) => {
            if (error) {
                nc.close();
                done(error);
            }
        });

        child.on('exit', (code, signal) => {
            if (timer) {
                clearTimeout(timer);
            }
            nc.close();
            if (code !== 0) {
                done(new Error(`Process didn't return a zero code: ${code} signal: ${signal}`));
            } else {
                done();
            }
        });
    });
});
