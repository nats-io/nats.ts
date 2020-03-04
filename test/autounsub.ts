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
import {connect, ConnectionOptions, ErrorCode, Sub} from '../src/nats'
import {next} from 'nuid'


test.before(async (t) => {
  let server = await startServer()
  t.context = {server: server}
})

test.after.always((t) => {
  stopServer((t.context as SC).server)
})

test('auto unsub from max from options', async (t) => {
  t.plan(1)
  const sc = t.context as SC
  const subj = next()
  let sub: Sub
  return connect({url: sc.server.nats} as ConnectionOptions)
  .then((nc) => {
    return nc.subscribe(subj, () => {
    }, {max: 10})
    .then((s) => {
      sub = s
      for (let i = 0; i < 20; i++) {
        nc.publish(subj)
      }
      return nc.flush()
    })
    .then(() => {
      t.is(sub.getReceived(), 10)
    })
    .finally(() => {
      nc.close()
    })
  })
})

test('auto unsub from unsubscribe', (t) => {
  t.plan(1)
  let subj = next()
  let sub: Sub
  const sc = t.context as SC
  return connect({url: sc.server.nats})
  .then((nc) => {
    return nc.subscribe(subj, () => {
    }, {max: 10})
    .then((s) => {
      sub = s
      sub.unsubscribe(11)
      for (let i = 0; i < 20; i++) {
        nc.publish(subj)
      }
      return nc.flush()
    })
    .then(() => {
      t.is(sub.getReceived(), 11)
      nc.close()
    })
  })
})

test('can unsub from auto-unsubscribed', async (t) => {
  t.plan(2)
  const sc = t.context as SC
  const subj = next()
  return connect({url: sc.server.nats})
  .then((nc) => {
    return nc.subscribe(subj, () => {
    }, {max: 1})
    .then((sub) => {
      for (let i = 0; i < 20; i++) {
        nc.publish(subj)
      }
      return nc.flush()
      .then(() => {
        t.is(sub.getReceived(), 1)
        t.is(nc.numSubscriptions(), 0)
        nc.close()
      })
    })
  })
})


test('can change auto-unsub to a lesser value', async (t) => {
  t.plan(1)
  const sc = t.context as SC
  const subj = next()
  let sub: Sub
  return connect({url: sc.server.nats})
  .then((nc) => {
    return nc.subscribe(subj, () => {}, {max: 16})
    .then((s) => {
      sub = s
      sub.unsubscribe(15)
      sub.unsubscribe(1)
      for (let i = 0; i < 20; i++) {
        nc.publish(subj)
      }
      return nc.flush()
    })
    .then(() => {
      t.is(sub.getReceived(), 1)
      nc.close()
    })
  })
})

test('can change auto-unsub to a higher value', async (t) => {
  t.plan(2)
  const sc = t.context as SC
  const subj = next()
  let sub: Sub
  return connect({url: sc.server.nats})
  .then((nc) => {
    return nc.subscribe(subj, () => {}, {max: 1})
    .then((s) => {
      sub = s
      sub.unsubscribe(5)
      sub.unsubscribe(15)
      for (let i = 0; i < 20; i++) {
        nc.publish(subj)
      }
      return nc.flush()
    })
    .then(() => {
      t.is(sub.getReceived(), 15)
      t.is(nc.numSubscriptions(), 0)
      nc.close()
    })
  })
})

test('request receives expected count with multiple helpers', (t) => {
  t.plan(8)
    const sc = t.context as SC
    const subj = next()
  return connect({url: sc.server.nats})
  .then((nc) => {
    for (let i = 0; i < 5; i++) {
      nc.subscribe(subj, (err, m) => {
        t.pass()
        m.respond('hello world')
      }, {max: 1})
    }
    return nc.request(subj)
    .then((m) => {
      t.is(m?.data, 'hello world')
      t.is(nc.numSubscriptions(), 1)
      //@ts-ignore
      t.is(nc.nc.reqs.length, 0)
      nc.close()
    })
  })
})

test('check cancelled requests leaks', (t) => {
  t.plan(2)
  const sc = t.context as SC
  const subj = next()
  return connect({url: sc.server.nats})
  .then((nc) => {
    return nc.request(subj, 100)
    .catch((err) => {
      t.is(err?.code, ErrorCode.REQ_TIMEOUT)
    })
    .then(() => {
      //@ts-ignore
      t.is(nc.nc.reqs.length, 0)
      nc.close()
    })
  })
})
