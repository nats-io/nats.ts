/*
 * Copyright 2019 The NATS Authors
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

import test from "ava";
import {addClusterMember, SC, startServer, stopServer} from "./helpers/nats_server_control";
import {connect} from "../src/nats";
import {join} from 'path';
import {Lock} from "./helpers/latch";
import {readFileSync} from "fs";


test.before(async (t) => {
    let cert = join(__dirname, "../../test/helpers/certs/noip-cert.pem");
    let key = join(__dirname, "../../test/helpers/certs/noip-key.pem");
    let ca = join(__dirname, "../../test/helpers/certs/ca.pem");


    t.context = {servers: [], ca: readFileSync(ca)};
    let flags = ['--tls', '--tlscert', cert, '--tlskey', key];
    let s1 = await startServer(flags);
    //@ts-ignore
    t.context.servers.push(s1);
    let s2 = await addClusterMember(s1, flags);
    //@ts-ignore
    t.context.servers.push(s2);
});

test.after.always((t) => {
    (t.context as SC).servers.forEach((s) => {
        stopServer(s);
    })
});

test('tls connect with ips', async (t) => {
    t.plan(1);
    //@ts-ignore
    let s1 = t.context.servers[0];

    let lock = new Lock();

    try {
        let nc = await connect({
            url: `tls://localhost:${s1.port}`,
            tls: {
                //@ts-ignore
                ca: t.context.ca
            },
            reconnectTimeWait: 500
        });

        nc.on('connect', () => {
            //@ts-ignore
            if (nc.protocolHandler.servers.length() > 1) {
                stopServer(s1)
            } else {
                nc.on('serversChanged', (sc) => {
                    //@ts-ignore
                    if (nc.protocolHandler.servers.length() > 1) {
                        stopServer(s1)
                    }
                });
            }
        });

        nc.on('reconnect', () => {
            //@ts-ignore
            nc.close();
            t.pass();
            lock.unlock();
        });
    } catch (err) {
        console.log(err);
        t.fail(err);
        lock.unlock()
    }

    return lock.latch;
});
