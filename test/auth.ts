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
import {SC, startServer, stopServer} from './helpers/nats_server_control'
import {connect, ConnectionOptions, ErrorCode, NatsError} from '../src/nats'
import {jsonToNatsConf, writeFile} from './helpers/nats_conf_utils'
import {next} from 'nuid'
import {join} from 'path'

const CONF_DIR = (process.env.TRAVIS) ? process.env.TRAVIS_BUILD_DIR : process.env.TMPDIR


test.before(async (t) => {
  const conf = {
    authorization: {
      users: [{
        user: 'derek',
        password: 'foobar',
        permission: {
          subscribe: 'bar',
          publish: 'foo'
        }
      }]
    }
  }

  // @ts-ignore
  const fp = join(CONF_DIR, next() + '.conf')
  writeFile(fp, jsonToNatsConf(conf))
  const server = await startServer(['-c', fp])
  t.context = {server}
})

test.after.always((t) => {
  stopServer((t.context as SC).server)
})

test('auth: no auth', (t) => {
  t.plan(1)
  const sc = t.context as SC
  return connect(sc.server.nats)
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch((err) => {
    t.is(err?.code, ErrorCode.BAD_AUTHENTICATION)
  })
})

test('auth: bad auth', (t) => {
  t.plan(1)
  const sc = t.context as SC
  return connect({url: sc.server.nats, user: 'me', pass: 'you'})
  .then((nc) => {
    t.fail('should have not connected')
    nc.close()
  })
  .catch((err) => {
    t.is(err?.code, ErrorCode.BAD_AUTHENTICATION)
  })
})

test('auth: auth', (t) => {
  t.plan(1)
  const sc = t.context as SC
  return connect({url: sc.server.nats, user: 'derek', pass: 'foobar'} as ConnectionOptions)
  .then((nc) => {
    t.pass()
    nc.close()
  })
})

test('auth: urlauth', (t) => {
  t.plan(1)
  const sc = t.context as SC
  let v = sc.server.nats
  v = v.replace('nats://', 'nats://derek:foobar@')
  return connect({url: v} as ConnectionOptions)
  .then((nc) => {
    t.pass()
    nc.close()
  })
})

test('auth: cannot sub to foo - not fatal', (t) => {
  t.plan(2)
  const sc = t.context as SC
  return connect({url: sc.server.nats, user: 'derek', pass: 'foobar'} as ConnectionOptions)
  .then((nc) => {
    return nc.subscribe('foo', (err) => {
      t.is(err?.code, ErrorCode.PERMISSIONS_ERR)
    })
    .then(() => {
      nc.publish('foo')
    })
    .then(() => {
      return nc.flush()
    })
    .then(() => {
      t.false(nc.isClosed())
      nc.close()
    })
  })
})

test('auth: cannot pub bar - not fatal', (t) => {
  t.plan(3)
  const sc = t.context as SC
  return connect({url: sc.server.nats, user: 'derek', pass: 'foobar'} as ConnectionOptions)
  .then((nc) => {
    nc.addListener('pubError', (err: NatsError) => {
      t.is(err.code, ErrorCode.PERMISSIONS_ERR)
      t.pass()
    })
    nc.publish('bar')
    return nc.flush()
    .then(() => {
      t.false(nc.isClosed())
      nc.close()
    })
  })
})

//
// test('auth: no user and token', async (t) => {
//   t.plan(2)
//   let sc = t.context as SC
//   try {
//     let nc = await connect({url: sc.server.nats, user: 'derek', token: 'foobar'} as ConnectionOptions)
//     t.fail()
//     nc.close()
//   } catch (ex) {
//     t.is(ex.code, ErrorCode.BAD_AUTHENTICATION)
//     t.pass()
//   }
// })
