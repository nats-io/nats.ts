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
import {join} from 'path';
import {Client, connect} from '../src/nats';
import {Lock} from './helpers/latch';
import {readFileSync} from 'fs';

let serverCert = join(__dirname, '../../test/helpers/certs/server-cert.pem');
let serverKey = join(__dirname, '../../test/helpers/certs/server-key.pem');
let caCert = join(__dirname, '../../test/helpers/certs/ca.pem');
let clientCert = join(__dirname, '../../test/helpers/certs/client-cert.pem');
let clientKey = join(__dirname, '../../test/helpers/certs/client-key.pem');

test.before(async (t) => {
    let server = await startServer();
    let tls = await startServer(['--tlscert', serverCert, '--tlskey', serverKey]);
    let tlsverify = await startServer(['--tlsverify', '--tlscert', serverCert, '--tlskey', serverKey, '--tlscacert', caCert]);

    t.context = {server: server, tls: tls, tlsverify: tlsverify, cacert: readFileSync(caCert), clientcert: readFileSync(clientCert), clientkey: readFileSync(clientKey)};
});

test.after.always((t) => {
    let sc = t.context as SC;
    stopServer(sc.server);
    //@ts-ignore
    stopServer(sc.tls);
    //@ts-ignore
    stopServer(sc.tlsverify);
});

test('error if server does not support TLS', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    let nc = await connect({url: sc.server.nats, tls: true});
    nc.on('error', (err) => {
        t.truthy(err);
        t.regex(err.message, /Server does not support a secure/);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('error if server requires TLS', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats, tls: false});
    nc.on('error', (err) => {
        t.truthy(err);
        t.regex(err.message, /Server requires a secure/);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('no error if server requires TLS - but tls is undefined', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats});
    nc.on('error', (err) => {
        // we will get an error because tls is unset, so there
        // will be a tls upgrade, however the test certificate
        // is not trusted, so tls handshake will fail to verify
        // the certificate
        t.truthy(err);
        t.regex(err.message, /unable to verify the first certificate/);
        lock.unlock();
    });

    return lock.latch;
});

test('reject without proper CA', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats, tls: true});
    nc.on('error', (err) => {
        t.truthy(err);
        // FIXME: this an Error thrown by the connection
        t.regex(err.message, /unable to verify the first certificate/);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect if authorized is overridden', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats, tls: {rejectUnauthorized: false}});
    nc.on('connect', (c) => {
        //@ts-ignore
        t.is(c, nc);
        //@ts-ignore
        t.false(nc.protocolHandler.transport.isAuthorized());
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('connect with proper ca and be authorized', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats, tls: {ca: [sc.cacert]}});
    nc.on('connect', (c) => {
        t.is(c, nc);
        //@ts-ignore
        t.true(nc.protocolHandler.transport.isAuthorized());
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('reject without proper cert if required by server', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tlsverify.nats, tls: true});
    nc.on('error', (err) => {
        t.truthy(err);
        t.regex(err.message, /Server requires a client certificate/);
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

test('authorized with proper cert', async (t) => {
    t.plan(2);
    let lock = new Lock();
    let sc = t.context as SC;
    //@ts-ignore
    let nc = await connect({url: sc.tls.nats, tls: {ca: [sc.cacert]}, key: [sc.clientkey], cert: [sc.clientcert]});
    nc.on('connect', (c: Client) => {
        t.is(c, nc);
        //@ts-ignore
        t.true(nc.protocolHandler.transport.isAuthorized());
        nc.close();
        lock.unlock();
    });
    return lock.latch;
});

