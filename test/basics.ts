/*
 * Copyright 2018-2020 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License")
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
import {SC, startServer, stopServer} from './helpers/nats_server_control'
import {connect, ConnectionOptions, createInbox, ErrorCode, NatsError, Sub, SubEvent, Payload} from '../src/nats'
import url from 'url'


test.before(async (t) => {
  let server = await startServer()
  t.context = {server: server}
})

test.after.always((t) => {
  // @ts-ignore
  stopServer(t.context.server)
})

test('fail connect', async (t) => {
  await t.throwsAsync(connect)
})

test('connect with port', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let u = new url.URL(sc.server.nats)
  return connect({port: parseInt(u.port, 10)} as ConnectionOptions)
  .then((nc) => {
    return nc.flush()
    .then(() => {
      nc.close()
      t.pass()
    })
  })
})

test('pub subject is required', (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    t.throws(() => {
      //@ts-ignore
      nc.publish()
    }, {code: ErrorCode.BAD_SUBJECT})
  })
})

test('sub callback is required', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    //@ts-ignore
    nc.subscribe(createInbox())
    .catch((ex: NatsError) => {
      t.is(ex.code, ErrorCode.API_ERROR)
    })
    .finally(() => {
      nc.close()
    })
  })
})

test('sub subject is required', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    //@ts-ignore
    nc.subscribe('', () => {
    })
    .catch((err) => {
      t.is(err.code, ErrorCode.BAD_SUBJECT)
    })
  })
})


test('subs require connection', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    nc.close()
    nc.subscribe(createInbox(), () => {
    })
    .catch((err) => {
      t.is(err?.code, ErrorCode.CONN_CLOSED)
    })
  })

})

test('sub and unsub', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  return nc.subscribe(createInbox(), () => {
  })
  .then((sub) => {
    t.truthy(sub)
    sub.unsubscribe()
    nc.flush()
    .then(() => {
      nc.close()
    })
  })
})

test('basic publish', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    nc.publish(createInbox())
    return nc.flush()
    .then(() => {
      t.pass()
      nc.close()
    })
  })
})


test('subscription message', async (t) => {
  t.plan(5)
  let sc = t.context as SC
  const subj = createInbox()
  const payload = 'Hello World'
  const reply = createInbox()
  let sub: Sub
  let sid: number
  return connect(sc.server.nats)
  .then((nc) => {
    return nc.subscribe(subj, (err, m) => {
      t.is(err, null)
      t.is(m?.data, payload)
      t.is(m?.subject, subj)
      t.is(m?.reply, reply)
      sid = m?.sid
    }).then((s) => {
      sub = s
      nc.publish(subj, payload, reply)
      return nc.flush()
    }).then(() => {
      t.is(sub.getID(), sid)
      nc.close()
    })
  })
})

test('subscription generates events', async (t) => {
  t.plan(3)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    let subj = createInbox()
    nc.on('subscribe', (se: SubEvent) => {
      t.is(se.subject, subj)
      t.is(se.queue, 'A')
      t.is(se.sid, 1)
    })
    return nc.subscribe(subj, () => {
    }, {queue: 'A'})
    .then(() => {
      return nc.flush()
    })
    .then(() => {
      nc.close()
    })
  })
})

test('unsubscribe generates events', async (t) => {
  t.plan(3)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    let subj = createInbox()
    nc.on('unsubscribe', (se: SubEvent) => {
      t.is(se.subject, subj)
      t.is(se.queue, 'A')
      t.is(se.sid, 1)
    })
    return nc.subscribe(subj, () => {
    }, {queue: 'A'})
    .then((sub) => {
      sub.unsubscribe()
      return nc.flush()
    })
    .then(() => {
      nc.close()
    })
  })
})


test('request subject is required', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    //@ts-ignore
    return nc.request()
  })
  .catch((err) => {
    t.is(err?.code, ErrorCode.BAD_SUBJECT)
  })
})

test('requests require connection', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    nc.close()
    nc.request(createInbox())
    .catch((err) => {
      t.is(err?.code, ErrorCode.CONN_CLOSED)
    })
  })
})

test('request reply', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let subj = createInbox()
  const payload = 'Hello World'
  const response = payload.split('').reverse().join('')
  await nc.subscribe(subj, (err, msg) => {
    //@ts-ignore
    t.is(msg.data, payload)
    //@ts-ignore
    nc.publish(msg.reply, response)
  }, {})

  let msg = await nc.request(subj, 1000, payload)
  t.is(msg.data, response)
  nc.close()
})

test('wildcard subscriptions', async (t) => {
  t.plan(3)
  let single = 3
  let partial = 2
  let full = 5

  let singleCounter = 0
  let partialCounter = 0
  let fullCounter = 0

  let sc = t.context as SC
  let nc = await connect(sc.server.nats)

  let s = createInbox()
  nc.subscribe(`${s}.*`, () => {
    singleCounter++
  })
  nc.subscribe(`${s}.foo.bar.*`, () => {
    partialCounter++
  })
  nc.subscribe(`${s}.foo.>`, () => {
    fullCounter++
  })

  nc.publish(`${s}.bar`)
  nc.publish(`${s}.baz`)
  nc.publish(`${s}.foo.bar.1`)
  nc.publish(`${s}.foo.bar.2`)
  nc.publish(`${s}.foo.baz.3`)
  nc.publish(`${s}.foo.baz.foo`)
  nc.publish(`${s}.foo.baz`)
  nc.publish(`${s}.foo`)

  await nc.flush()
  t.is(singleCounter, single)
  t.is(partialCounter, partial)
  t.is(fullCounter, full)

  nc.close()
})

test('flush is a promise', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let p = nc.flush()
  //@ts-ignore
  t.truthy(p.then)
  await p
  nc.close()
})

test('unsubscribe after close', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let sub = await nc.subscribe(createInbox(), () => {
  })
  nc.close()
  sub.unsubscribe()
  t.pass()
})

test('no data after unsubscribe', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  let subj = createInbox()
  let received = 0
  let sub = await nc.subscribe(subj, () => {
    received++
    sub.unsubscribe()
  })
  nc.publish(subj)
  nc.publish(subj)
  nc.publish(subj)
  await nc.flush()
  t.is(received, 1)
  nc.close()
})

test('JSON messages', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect({url: sc.server.nats, payload: Payload.JSON} as ConnectionOptions)
  let subj = createInbox()
  let m = {
    boolean: true,
    string: 'CEDILA-Ç'
  }

  nc.subscribe(subj, (err, msg) => {
    t.is(err, null)
    // @ts-ignore
    t.deepEqual(msg.data, m)
  }, {max: 1})
  nc.publish(subj, m)
  await nc.flush()
  nc.close()
})

test('UTF8 messages', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect({url: sc.server.nats} as ConnectionOptions)
  let subj = createInbox()
  let m = 'CEDILA-Ç'

  nc.subscribe(subj, (err, msg) => {
    t.is(err, null)
    // @ts-ignore
    t.is(msg.data, m)
  }, {max: 1})
  nc.publish(subj, m)
  await nc.flush()
  nc.close()
})

test('request removes mux', async (t) => {
  t.plan(4)
  let sc = t.context as SC
  let nc = await connect({url: sc.server.nats} as ConnectionOptions)
  let subj = createInbox()

  nc.subscribe(subj, (err, msg) => {
    t.falsy(err)
    t.truthy(msg)
    //@ts-ignore
    nc.publish(msg.reply)
  }, {max: 1})

  let r = await nc.request(subj)
  t.truthy(r)
  //@ts-ignore
  t.is(nc.nc.reqs.length, 0)
  nc.close()
})

test('unsubscribe unsubscribes', async (t) => {
  t.plan(2)
  let sc = t.context as SC
  let nc = await connect({url: sc.server.nats} as ConnectionOptions)
  let subj = createInbox()

  let sub = await nc.subscribe(subj, () => {
  })
  t.is(nc.numSubscriptions(), 1)
  sub.unsubscribe()
  t.is(nc.numSubscriptions(), 0)
  nc.close()
})

test('flush cb calls error on close', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  nc.close()
  return nc.flush()
  .then(() => {
    t.fail('should have not been able to flush')
  }).catch((err) => {
    t.is(err?.code, ErrorCode.CONN_CLOSED)
  })
})

test('flush reject on close', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  nc.close()
  //@ts-ignore
  await t.throwsAsync(() => {
    return nc.flush()
  }, {code: ErrorCode.CONN_CLOSED})
})

test('error if publish after close', async (t) => {
  t.plan(1)
  let sc = t.context as SC
  let nc = await connect(sc.server.nats)
  nc.close()
  await t.throws(() => {
    nc.publish('foo')
  }, {code: ErrorCode.CONN_CLOSED})
})

test('server info', async (t) => {
  t.plan(3)
  let sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    //@ts-ignore
    t.truthy(nc.nc.info.client_id > 0)
    //@ts-ignore
    t.truthy(nc.nc.info.max_payload > 0)
    //@ts-ignore
    t.truthy(nc.nc.info.proto > 0)
  })
})
