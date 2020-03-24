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

import {connect, ErrorCode} from '../src/nats'
import test from 'ava'
import {SC, startServer, stopServer} from './helpers/nats_server_control'


test.before(async (t) => {
  const server = await startServer(['--auth', 'tokenxxxx'])
  t.context = {server}
})

test.after.always((t) => {
  stopServer((t.context as SC).server)
})

test('token no auth', async (t) => {
  t.plan(3)
  const sc = t.context as SC
  return connect({url: sc.server.nats})
  .then((nc) => {
    t.fail('should have failed to connect')
    nc.close()
  })
  .catch((err) => {
    t.truthy(err)
    t.regex(err.message, /Authorization/)
    t.is(err?.code, ErrorCode.BAD_AUTHENTICATION)
  })
})

test('token bad auth', async (t) => {
  t.plan(3)
  const sc = t.context as SC
  return connect({url: sc.server.nats, token: 'bad'})
  .then((nc) => {
    t.fail('should have failed to connect')
    nc.close()
  })
  .catch((err) => {
    t.truthy(err)
    t.regex(err.message, /Authorization/)
    t.is(err?.code, ErrorCode.BAD_AUTHENTICATION)
  })
})

test('token auth', async (t) => {
  t.plan(1)
  const sc = t.context as SC
  return connect({url: sc.server.nats, token: 'tokenxxxx'})
  .then((nc) => {
    t.pass()
    nc.close()
  })
})
