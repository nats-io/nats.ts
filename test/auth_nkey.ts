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

import test from 'ava';
import {Lock} from './helpers/latch';
import {SC, startServer, stopServer, serverVersion} from './helpers/nats_server_control';
import {connect, ConnectionOptions} from '../src/nats';
import path from 'path';
import {next} from 'nuid';
import {fromSeed} from 'ts-nkeys';
import {jsonToNatsConf, writeFile} from './helpers/nats_conf_utils';

const uSeed = 'SUAEL6GG2L2HIF7DUGZJGMRUFKXELGGYFMHF76UO2AYBG3K4YLWR3FKC2Q';
const uPub = 'UD6OU4D3CIOGIDZVL4ANXU3NWXOW5DCDE2YPZDBHPBXCVKHSODUA4FKI';

test.before(async (t) => {
    if (serverVersion()[0] < 2) {
        return;
    }
    let conf = {
        authorization: {
            users: [
                {nkey: uPub}
            ]
        }
    };

    let confDir = (process.env.TRAVIS) ? process.env.TRAVIS_BUILD_DIR : process.env.TMPDIR;
    //@ts-ignore
    let fp = path.join(confDir, next() + '.conf');
    writeFile(fp, jsonToNatsConf(conf));

    let server = await startServer(['-c', fp]);
    t.context = {server: server};
});

test.after.always((t) => {
    if (serverVersion()[0] < 2) {
        return;
    }
    stopServer((t.context as SC).server);
});

test('basic nkey authentication', async (t) => {
    if (serverVersion()[0] < 2) {
        t.pass('skipping server version ' + serverVersion());
        return;
    }
    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;

    let nc = await connect({
        url: sc.server.nats,
        nkey: uPub,
        nonceSigner: function (nonce: any): Buffer {
            let sk = fromSeed(Buffer.from(uSeed));
            return sk.sign(Buffer.from(nonce));
        }
    } as ConnectionOptions);
    nc.on('error', (err) => {
        t.fail(`should have connected ${err}`);
        lock.unlock();
    });
    nc.on('connect', () => {
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});
