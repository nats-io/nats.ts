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
import {Lock, wait} from './helpers/latch'
import {SC, startServer, stopServer} from './helpers/nats_server_control'
import {connect, ErrorCode} from '../src/nats'
import * as net from "net"
import {ConnectionOptions, createInbox} from "nats"

test.before(async (t) => {
  let server = await startServer()
  t.context = {server: server}
})

test.after.always((t) => {
  stopServer((t.context as SC).server)
})

test('subscription timeouts', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let sub = await nc.subscribe(createInbox(), (err) => {
    //@ts-ignore
    t.is(err.code, ErrorCode.TIMEOUT_ERR)
    let elapsed = Date.now() - start
    t.true(elapsed >= 45 && elapsed <= 100)
    nc.close()
    lock.unlock()
  })
  let start = Date.now()
  sub.setTimeout(50)

  return lock.latch
})

test('sub cancel timeout, cancels timeout', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let subj = createInbox()
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      t.fail()
    }
  })
  sub.setTimeout(1000)
  t.true(sub.hasTimeout())
  sub.cancelTimeout()
  t.false(sub.hasTimeout())
  await wait(1000)
  nc.close()
})

test('cancel timeout', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let subj = createInbox()
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      t.fail()
    }
  })
  sub.setTimeout(500)
  t.true(sub.hasTimeout())
  sub.cancelTimeout()
  await wait(500)
  t.false(sub.hasTimeout())
  nc.close()
})

test('message cancels subscription timeout', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let subj = createInbox()
  let count = 0
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      t.fail('no timeout expected')
    } else {
      count++
    }
  })
  sub.setTimeout(250)
  t.true(sub.hasTimeout())
  nc.publish(subj)
  await nc.flush()
  t.false(sub.hasTimeout())
  await wait(250)
  nc.close()
})

test('max message cancels subscription timeout', async (t) => {
  t.plan(3)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()
  let subj = createInbox()
  let count = 0
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      t.fail()
    } else {
      count++
      if (count === 2) {
        t.true(sub.isCancelled())
        nc.close()
        lock.unlock()
      }
    }
  }, {max: 2})
  sub.setTimeout(500)
  t.true(sub.hasTimeout())
  nc.publish(subj)
  nc.publish(subj)
  await wait(500)
  t.false(sub.hasTimeout())
  return lock.latch
})

test('timeout if expected is not received', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let subj = createInbox()
  let count = 0
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      t.is(err.code, ErrorCode.TIMEOUT_ERR)
      t.is(sub.getReceived(), 1)
      nc.close()
      lock.unlock()
    } else {
      count++
    }
  })
  sub.setTimeout(100, 2)
  nc.publish(subj)

  return lock.latch
})

test('no timeout if unsubscribed', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let subj = createInbox()
  let sub = await nc.subscribe(subj, () => {
    sub.unsubscribe()
  })
  sub.unsubscribe(10)
  sub.setTimeout(50)
  nc.publish(subj)
  await nc.flush()
  setTimeout(() => {
    // shouldn't expect anything because it is unsubscribed
    t.true(sub.isCancelled())
    lock.unlock()
  }, 100)

  await lock.latch
})

test('sub timeout returns false if no sub', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)

  let sub = await nc.subscribe(createInbox(), () => {
  })
  sub.unsubscribe()
  t.false(sub.setTimeout(10))
  nc.close()
})


test('timeout unsubscribes', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let subj = createInbox()
  let count = 0
  let sub = await nc.subscribe(subj, (err) => {
    if (err) {
      process.nextTick(() => {
        nc.publish(subj)
        nc.flush()
      })
    } else {
      count++
    }
  })
  sub.setTimeout(50)

  setTimeout(() => {
    t.is(count, 0)
    lock.unlock()
  }, 100)

  await lock.latch
})

test('connectTimeout is honored', async (t) => {
  t.plan(2)
  try {
    await connect({
      servers: ['nats://connect.ngs.global'],
      timeout: 1
    })
  } catch (ex) {
    t.is(ex.code, ErrorCode.CONN_ERR)
    t.is(ex.chainedError.code, ErrorCode.CONN_TIMEOUT)
  }
})

test('connection timeout - socket timeout', (t) => {
  const srv = net.createServer(() => {
  })
  let lock = new Lock()
  t.plan(2)
  srv.listen(0, async () => {
    // @ts-ignore
    const {port} = srv.address()
    return connect({port: port, timeout: 500} as ConnectionOptions)
    .then((nc) => {
      nc.close()
      t.fail('should have not connected')
      lock.unlock()
    })
    .catch((err) => {
      t.is(err.code, ErrorCode.CONN_ERR)
      t.is(err.chainedError.code, ErrorCode.CONN_TIMEOUT)
      srv.close()
      lock.unlock()
    })
  })
  return lock.latch
})

test('subscription timers are cleared', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let subj = createInbox()
  let sub = await nc.subscribe(subj, () => {
    t.fail("shouldn't have been called")
  })
  sub.setTimeout(100)
  setTimeout(() => {
    lock.unlock()
  }, 500)
  nc.close()

  await lock.latch
  t.pass()
})

test('request timers are cleared', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let lock = new Lock()

  let subj = createInbox()
  nc.request(subj, 100)
  setTimeout(() => {
    lock.unlock()
  }, 500)

  nc.close()
  await lock.latch
  // will get unhandled rejection
  t.pass()
})
