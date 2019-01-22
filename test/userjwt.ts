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
import {Lock} from "./helpers/latch";
import {SC, startServer, stopServer, SERVER_MAJOR_VERSION} from "./helpers/nats_server_control";
import {connect, NatsConnectionOptions} from "../src/nats";
import {ErrorCode, NatsError} from "../src/error";
import path from 'path'
import {fromSeed} from 'ts-nkeys'

//  path for files is __dirname is ts-nats/lib/test
const confdir = path.join(__dirname, '..', '..', 'test', 'configs');
const uSeed = "SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4";
const uJWT = "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw";


test.before(async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        return;
    }
    let server = await startServer(['-c', path.join(confdir, 'operator.conf')]);
    t.context = {server: server}
});

test.after.always((t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        return;
    }
    stopServer((t.context as SC).server);
});


test('error when no nonceSigner callback is defined', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }
    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats} as NatsConnectionOptions);
    nc.on('error', (err) => {
        let ne = err as NatsError;
        t.is(ne.code, ErrorCode.SIGNATURE_REQUIRED);
        lock.unlock();
    });
    nc.on('connect', () => {
        t.fail("shouldn't have connected");
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('error if nonceSigner is not function', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore - ts requires function
    let opts = {url: sc.server.nats, nonceSigner: "BAD"} as NatsConnectionOptions;
    await t.throwsAsync(() => {
        return connect(opts)
    }, {code: ErrorCode.NONCE_SIGNER_NOTFUNC});
});

test('error if no nkey or userJWT', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }

    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({
        url: sc.server.nats, nonceSigner: function () {
        }
    } as NatsConnectionOptions);
    nc.on('error', (err) => {
        let ne = err as NatsError;
        t.is(ne.code, ErrorCode.NKEY_OR_JWT_REQ);
        lock.unlock();
    });
    nc.on('connect', () => {
        t.fail("shouldn't have connected");
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('connects with userJWT and nonceSigner', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }

    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({
        url: sc.server.nats,
        userJWT: uJWT,
        nonceSigner: function (nonce: string): Buffer {
            let sk = fromSeed(Buffer.from(uSeed));
            return sk.sign(Buffer.from(nonce));
        }
    } as NatsConnectionOptions);

    nc.on('connect', () => {
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('connects with userJWT function', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }

    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({
        url: sc.server.nats,
        userJWT: function () {
            return uJWT;
        },
        nonceSigner: function (nonce: string): Buffer {
            let sk = fromSeed(Buffer.from(uSeed));
            return sk.sign(Buffer.from(nonce));
        }
    } as NatsConnectionOptions);

    nc.on('connect', () => {
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('connects with creds file', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }

    let lock = new Lock();
    t.plan(1);
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({
        url: sc.server.nats,
        userCreds: path.join(confdir, "nkeys", "test.creds")
    } as NatsConnectionOptions);

    nc.on('connect', () => {
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});

test('fails connects with bad creds file', async (t) => {
    if (SERVER_MAJOR_VERSION < 2) {
        t.pass("skipping server version " + SERVER_MAJOR_VERSION);
        return;
    }

    let lock = new Lock();
    t.plan(2);
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({
        url: sc.server.nats,
        userCreds: path.join(confdir, "nkeys", "test.txt")
    } as NatsConnectionOptions);

    nc.on('error', (err) => {
        t.is(err.code, 'ENOENT');
        t.pass();
        nc.close();
        lock.unlock();
    });

    return lock.latch;
});