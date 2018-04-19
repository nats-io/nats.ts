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
import * as ncu from './support/nats_conf_utils';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {next} from 'nuid';


describe('Auth Basics', () => {

    let PORT = 6758;
    let server: Server;

    // Start up our own nats-server
    before((done) => {
        let conf = {
            authorization: {
                SUB: {
                    subscribe: "bar",
                    publish: "bar"
                },
                users: [{
                    user: 'bar',
                    password: 'bar',
                    permission: '$SUB'
                }]
            }
        };
        let cf = path.resolve(os.tmpdir(), 'conf-' + next() + '.conf');
        console.log(cf);
        fs.writeFile(cf, ncu.jsonToYaml(conf), (err) => {
            if (err) {
                done(err);
            } else {
                server = nsc.start_server(PORT, ['-c', cf], done);
            }
        });
    });

    // Shutdown our server
    after((done) => {
        nsc.stop_server(server, done);
    });

    it('bar cannot subscribe/pub foo', (done) => {
        let nc = NATS.connect({
            port: PORT,
            user: 'bar',
            pass: 'bar'
        } as NatsConnectionOptions);


        let perms = 0;
        nc.on('permission_error', () => {
            perms++;
            if (perms === 2) {
                nc.close();
                done();
            }
        });
        nc.flush(function () {
            nc.subscribe('foo', {}, () => {
                nc.close();
                done("Shouldn't be able to publish foo");
            });
            nc.publish('foo', 'foo');
        });

    });
});
