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

import test from 'ava';
import {connect, Payload} from '../src/nats';
import {next} from 'nuid';
import {Lock} from './helpers/latch';
import {SC, startServer, stopServer} from './helpers/nats_server_control';
import {randomBytes} from 'crypto';


test.before(async (t) => {
    let server = await startServer();
    t.context = {server: server};
});

test.after.always((t) => {
    stopServer((t.context as SC).server);
});

async function macro(t: any, input: any): Promise<any> {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    let subj = next();
    let nc = await connect({url: sc.server.nats, payload: Payload.BINARY});

    nc.subscribe(subj, (err, msg) => {
        if (err) {
            t.fail(err);
        }
        t.true(Buffer.isBuffer(msg.data));
        t.deepEqual(msg.data, input);
        lock.unlock();
    }, {max: 1});
    nc.publish(subj, input);
    nc.flush();
    return lock.latch;
}

let invalid2octet = Buffer.from([0xc3, 0x28]);
let invalidsequenceidentifier = Buffer.from([0xa0, 0xa1]);
let invalid3octet = Buffer.from([0xe2, 0x28, 0xa1]);
let invalid4octet = Buffer.from([0xf0, 0x90, 0x28, 0xbc]);
let embeddednull = Buffer.from([0x00, 0xf0, 0x00, 0x28, 0x00, 0x00, 0xf0, 0x9f, 0x92, 0xa9, 0x00]);
let bigBuffer = randomBytes(128 * 1024);

test('invalid2octet', macro, invalid2octet);
test('invalidsequenceidentifier', macro, invalidsequenceidentifier);
test('invalid3octet', macro, invalid3octet);
test('invalid4octet', macro, invalid4octet);
test('embeddednull', macro, embeddednull);
test('bigbuffer', macro, bigBuffer);

test('no control characters on chunk processing', async (t) => {
    let count = 25;
    t.plan(count);
    let sc = t.context as SC;
    let subj = next();
    let nc = await connect({url: sc.server.nats, payload: Payload.BINARY});

    let data = randomBytes(1032);
    let lock = new Lock(count);
    let sub = await nc.subscribe(subj, (err, msg) => {
        t.deepEqual(msg.data, data);
        lock.unlock();
    });

    for (let i = 0; i < count; i++) {
        nc.publish(subj, data);
    }

    return lock.latch;
});
