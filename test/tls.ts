/*
 * Copyright 2018-2020 The NATS Authors
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

import {SC, startServer, stopServer} from './helpers/nats_server_control'
import test from 'ava'
import {join} from 'path'
import {Client, connect, ErrorCode} from '../src/nats'
import {readFileSync} from 'fs'
import {TLSSocket} from 'tls'
import * as url from 'url'

let serverCert = join(__dirname, '../../test/helpers/certs/server.pem')
let serverKey = join(__dirname, '../../test/helpers/certs/key.pem')
let caCert = join(__dirname, '../../test/helpers/certs/ca.pem')
let clientCert = join(__dirname, '../../test/helpers/certs/client-cert.pem')
let clientKey = join(__dirname, '../../test/helpers/certs/client-key.pem')

test.before(async (t) => {
  //@ts-ignore
  let server = await startServer()
  let tls = await startServer(['--tlscert', serverCert, '--tlskey', serverKey, '--tlscacert', caCert])
  let tlsverify = await startServer(['--tlsverify', '--tlscert', serverCert, '--tlskey', serverKey, '--tlscacert', caCert])

  t.context = {
    server: server,
    tls: tls,
    tlsverify: tlsverify,
    cacert: readFileSync(caCert),
    clientcert: readFileSync(clientCert),
    clientkey: readFileSync(clientKey)
  }
})

test.after.always((t) => {
  let sc = t.context as SC
  stopServer(sc.server)
  //@ts-ignore
  stopServer(sc.tls)
  //@ts-ignore
  stopServer(sc.tlsverify)
})

test('error if server does not support TLS', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  return connect({url: sc.server.nats, tls: true})
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch((err) => {
    t.truthy(err)
    t.regex(err.message, /Server does not support a secure/)
  })
})

test('error if server requires TLS', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  // tls urls, make tls required, so, make it so it looks like a reg nats server
  //@ts-ignore
  const u = url.parse(sc.tls.nats)
  //@ts-ignore
  return connect({url: `nats://${u.host}`, tls: false})
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch(err => {
    t.truthy(err)
    t.regex(err.message, /Server requires a secure/)
  })
})

test.serial('no error if server requires TLS - but tls is undefined', async (t) => {
  // this affects all the tests, so this test must be run serially
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
  t.plan(1)
  let sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tls.nats})
  .then((nc) => {
    t.pass()
    nc.close()
  })
  .catch((err) => {
    t.log(err)
    t.fail('should have not failed')
  })
  .finally(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  })
})

test('reject without proper CA', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tls.nats, tls: true})
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch((err) => {
    t.truthy(err)
    t.regex(err.message, /unable to verify the first certificate/)
  })
})

test('connect if authorized is overridden', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tls.nats, tls: {rejectUnauthorized: false}})
  .then((nc) => {
    //@ts-ignore
    t.true(nc.nc.stream instanceof TLSSocket)
    //@ts-ignore
    t.false(nc.nc.stream.authorized)
    nc.close()
  })
  .catch((err) => {
    t.fail(err.toString())
  })
})

test('connect with proper ca and be authorized', async (t) => {
  t.plan(2)
  const sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tls.nats, tls: {ca: [sc.cacert]}})
  .then((nc) => {
    //@ts-ignore
    t.true(nc.nc.stream instanceof TLSSocket)
    //@ts-ignore
    t.true(nc.nc.stream.authorized)
    nc.close()
  })
  .catch((err) => {
    t.fail(err.toString())
  })
})

test('reject without proper cert if required by server', (t) => {
  t.plan(2)
  let sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tlsverify.nats, tls: true})
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch((err) => {
    t.truthy(err)
    t.regex(err.message, /Server requires a client certificate/)
  })
})

test('authorized with proper cert', (t) => {
  t.plan(2)
  let sc = t.context as SC
  //@ts-ignore
  return connect({url: sc.tls.nats, tls: {ca: [sc.cacert], key: [sc.clientkey], cert: [sc.clientcert]}})
  .then((nc: Client) => {
    //@ts-ignore
    t.true(nc.nc.stream instanceof TLSSocket)
    //@ts-ignore
    t.true(nc.nc.stream.authorized)
    nc.close()
  })
})

test('handle openssl error', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  // pass the wrong cert/ca to fail it
  //@ts-ignore
  return connect({url: sc.tls.nats, tls: {key: sc.clientkey, cert: sc.cacert, ca: sc.clientcert}})
  .then((nc) => {
    t.fail('should have failed to connect')
    nc.close()
  })
  .catch((err) => {
    t.is(err.code, ErrorCode.OPENSSL_ERR)
  })
})

