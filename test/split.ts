/*
 * Copyright 2018-2019 The NATS Authors
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

import {SC, startServer, stopServer} from './helpers/nats_server_control';
import test from 'ava';
import {connect, Payload} from '../src/nats';
import {randomBytes} from 'crypto';
import {next} from 'nuid'


test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});

async function macro(t: any, input: any, payload: Payload) : Promise<any> {
    let max = 10000;
    t.plan(max);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, payload: payload});
    let subj = next();
    nc.subscribe(subj, (err, msg) => {
        if(err) {
            t.fail(err.message);
        }
        t.deepEqual(msg.data, input);
    }, {max: max});

    for (let i=0; i < max; i++) {
        nc.publish(subj, input);
    }
    await nc.flush();
    nc.close();
}

test('large # of utf8 messages from split buffers', macro, '½ + ¼ = ¾', Payload.STRING);
test('large # of messages from split buffers', macro, 'hello world', Payload.STRING);
test('large # of binary messages from split buffers', macro, randomBytes(50), Payload.BINARY);