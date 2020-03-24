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

import test from 'ava'
import {Client, connect, ConnectionOptions} from '../src/nats'
import {Lock} from './helpers/latch'
import * as net from "net"
import {SC, startServer, stopServer} from "./helpers/nats_server_control"
import url from "url"


test.before(async (t) => {
  const server = await startServer()
  t.context = {server}
})

test.after.always((t) => {
  // @ts-ignore
  stopServer(t.context.server)
})

test('timer pings are sent', async (t) => {
  const lock = new Lock()
  t.plan(1)
  const sc = t.context as SC
  const u = new url.URL(sc.server.nats)
  const nc = await connect({port: parseInt(u.port, 10), pingInterval: 100} as ConnectionOptions)
  nc.on('pingtimer', () => {
    t.pass()
    nc.close()
    lock.unlock()
  })
  return lock.latch
})

test('missed timer pings reconnect', (t) => {
  let conn: Client
  const lock = new Lock()
  t.plan(4)
  const srv = net.createServer((c) => {
    let firstPing = true
    c.write(`INFO ${JSON.stringify({
      server_id: 'TEST',
      version: '0.0.0',
      host: '127.0.0.1',
      // @ts-ignore
      port: srv.address.port,
      auth_required: false
    })}\r\n`)
    c.on('data', (d) => {
      const r = d.toString()
      const lines = r.split('\r\n')
      lines.forEach((line) => {
        if (line === '') {
          return
        }
        if (/^CONNECT\s+/.test(line)) {
          // nothing
        } else if (/^PING/.test(line)) {
          if (firstPing) {
            c.write('PONG\r\n')
            firstPing = false
          }
        } else if (/^PONG/.test(line)) {
          // nothing
        } else if (/^INFO\s+/i.test(line)) {
          // nothing
        } else {
          // unknown
        }
      })
    })
  })

  srv.listen(0, () => {
    // @ts-ignore
    const {port} = srv.address()
    connect({
      port,
      reconnectTimeWait: 250,
      pingInterval: 100,
      maxReconnectAttempts: 1
    } as ConnectionOptions).then((nc) => {
      conn = nc
      nc.on('reconnect', () => {
        t.pass()
        nc.close()
        srv.close()
        lock.unlock()
      })
      nc.on('pingcount', () => {
        t.pass()
      })
    })
    srv.on('error', (err) => {
      t.fail(err.message)
    })
  })
  return lock.latch
})
