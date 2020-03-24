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
import test, {ExecutionContext} from 'ava'
import {connect} from '../src/nats'


test.before(async (t) => {
  const s1 = await startServer()
  const s2 = await startServer()
  t.context = {server: s1, servers: [s1, s2]}
})

test.after.always((t) => {
  (t.context as SC).servers.forEach((s) => {
    stopServer(s)
  })
})

function getServers(t: ExecutionContext<any>): string[] {
  const a: string[] = []
  const servers = (t.context as SC).servers
  servers.forEach((s) => {
    a.push(s.nats)
  })
  return a
}

test('has multiple servers', async (t) => {
  t.plan(1)

  const a = getServers(t)
  const nc = await connect({servers: a})

  // @ts-ignore
  const servers = nc.nc.servers
  t.is(servers.length(), a.length)
  nc.close()
})

test('connects to first valid server', async (t) => {
  const a = getServers(t)
  a.splice(0, 0, 'nats://localhost:7')
  return connect({servers: a})
  .then((nc) => {
    t.pass()
    nc.close()
  })
})

test('reject if no valid server', async (t) => {
  t.plan(1)
  const a = ['nats://localhost:7']
  return connect({servers: a, reconnectTimeWait: 50})
  .then(() => {
    t.fail('should have not connected')
  })
  .catch((err) => {
    t.is(err?.code, 'CONN_ERR')
  })
})

test('throws if no valid server', async (t) => {
  t.plan(1)
  const a = ['nats://localhost:7', 'nats://localhost:9']
  return connect({servers: a, reconnectTimeWait: 50})
  .then(() => {
    t.fail('should have not connected')
  })
  .catch((err) => {
    t.is(err?.code, 'CONN_ERR')
  })

})

test('random server connections', async (t) => {
  const first = getServers(t)[0]
  let count = 0
  let other = 0
  for (let i = 0; i < 100; i++) {
    const nc = await connect({servers: getServers(t)})
    // @ts-ignore
    const s = nc.nc.servers.getCurrent()
    // @ts-ignore
    if (s.toString() === first) {
      count++
    } else {
      other++
    }
    nc.close()
  }

  t.is(count + other, 100)
  t.true(count >= 35)
  t.true(count <= 65)
})

test('no random server if noRandomize', async (t) => {
  const servers = getServers(t)
  const first = servers[0].toString()
  for (let i = 0; i < 100; i++) {
    const nc = await connect({servers, noRandomize: true})
    // @ts-ignore
    const s = nc.nc.servers.getCurrent()
    t.is(s.toString(), first.toString())
    nc.close()
  }
})