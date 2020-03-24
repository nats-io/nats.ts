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

import {addClusterMember, SC, Server, startServer, stopServer} from './helpers/nats_server_control'
import test, {ExecutionContext} from 'ava'
import {Client, connect} from '../src/nats'
import {Lock} from './helpers/latch'
import {delay} from "../src/util"

test.before(async (t) => {
  t.context = {servers: []}
})

test.after.always((t) => {
  (t.context as SC).servers.forEach((s) => {
    stopServer(s)
  })
})

function registerServer(t: ExecutionContext, s: Server): Server {
  // @ts-ignore
  t.context.servers.push(s)
  return s
}

async function addClusterServer(t: ExecutionContext, server: Server): Promise<Server> {
  const s = await addClusterMember(server)
  return registerServer(t, s)
}

function countImplicit(nc: Client): number {
  let count = 0
  // @ts-ignore
  nc.nc.servers.getAll().forEach((s) => {
    if (s.implicit) {
      count++
    }
  })
  return count
}


test('updates add', async (t) => {
  const s1 = registerServer(t, await startServer())
  t.plan(4)
  const lock = new Lock()
  const nc = await connect(s1.nats)
  // @ts-ignore
  const servers = nc.nc.servers
  t.is(servers.length(), 1)
  nc.on('serversChanged', (change) => {
    t.is(servers.length(), 2)
    t.is(change.added.length, 1)
    t.is(countImplicit(nc), 1)
    lock.unlock()
  })
  await addClusterServer(t, s1)
  return lock.latch
})

test('updates remove', async (t) => {
  t.plan(2)
  const s1 = registerServer(t, await startServer())
  let s2: Server
  const lock = new Lock()

  let changes = 0
  const nc = await connect(s1.nats)
  nc.on('serversChanged', (sc) => {
    if (sc.added.length) {
      t.pass()
      changes += sc.added.length
      setTimeout(() => {
        // tslint:disable-next-line:no-empty
        stopServer(s2, () => {})
      }, 600)
    }
    if (sc.deleted.length) {
      t.pass()
      changes += sc.added.length
      setTimeout(() => {
        nc.close()
        lock.unlock()
      }, 0)
    }
  })

  setTimeout(async () => {
    s2 = await addClusterServer(t, s1)
  }, 250)

  return lock.latch
})

test('reconnects to gossiped server', async (t) => {
  t.plan(1)
  const s1 = registerServer(t, await startServer())
  const s2 = await addClusterServer(t, s1)

  const lock = new Lock()
  const nc = await connect(s2.nats)
  // @ts-ignore
  const servers = nc.nc.servers

  setTimeout(() => {
    stopServer(s2)
  }, 200)

  nc.on('reconnect', () => {
    t.is(servers.getCurrent().url.href, s1.nats)
    lock.unlock()
  })

  return lock.latch
})

test('fails after maxReconnectAttempts when servers killed', async (t) => {
  t.plan(4)
  const s1 = registerServer(t, await startServer())
  const s2 = await addClusterServer(t, s1)
  await delay(100)

  const lock = new Lock()
  const nc = await connect({url: s2.nats, maxReconnectAttempts: 10, reconnectTimeWait: 50})
  // @ts-ignore
  t.is(nc.nc.servers.getCurrent().toString(), s2.nats)

  process.nextTick(() => {
    stopServer(s2)
  })

  let disconnects = 0
  let reconnectings = 0

  nc.on('disconnect', () => {
    disconnects++
  })

  let firstReconnect = true
  nc.on('reconnect', (c) => {
    if (firstReconnect) {
      firstReconnect = false
      t.is(c.servers.getCurrent().toString(), s1.nats)
      process.nextTick(() => {
        stopServer(s1)
      })
    }
  })

  nc.on('reconnecting', () => {
    reconnectings++
  })

  nc.on('close', () => {
    t.is(reconnectings, 20)
    t.is(disconnects, 2)
    lock.unlock()
  })

  return lock.latch
})
