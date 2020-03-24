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
import {next} from 'nuid'
import {connect, Msg} from '../src/nats'
import {Lock} from './helpers/latch'
import {Payload} from 'nats'


test.before(async (t) => {
  const server = await startServer()
  t.context = {server}
})

test.after.always((t) => {
  // @ts-ignore
  stopServer(t.context.server)
})

test('json types', async (t) => {
  t.plan(2)
  const sc = t.context as SC
  const nc = await connect({url: sc.server.nats, payload: Payload.JSON})
  const subj = next()
  nc.subscribe(subj, (err, msg) => {
    if (err) {
      t.fail(err.message)
    }
    t.is(typeof msg.data, 'number')
    t.is(msg.data, 6691)
  }, {max: 1})

  nc.publish(subj, 6691)
  await nc.flush()
  nc.close()
})

test('string types', async (t) => {
  t.plan(2)
  const lock = new Lock()
  const sc = t.context as SC
  const nc = await connect({url: sc.server.nats})
  const subj = next()
  nc.subscribe(subj, (err, msg: Msg) => {
    t.is(typeof msg.data, 'string')
    t.is(msg.data, 'hello world')
    lock.unlock()
  }, {max: 1})

  nc.publish(subj, Buffer.from('hello world'))
  nc.flush()
  return lock.latch
})

test('binary types', async (t) => {
  t.plan(2)
  const sc = t.context as SC
  const nc = await connect({url: sc.server.nats, payload: Payload.Binary})
  const subj = next()
  nc.subscribe(subj, (err, msg) => {
    t.truthy(Buffer.isBuffer(msg.data))
    t.is(msg.data.toString(), 'hello world')
  }, {max: 1})

  nc.publish(subj, Buffer.from('hello world'))
  await nc.flush()
  nc.close()
})

test('binary encoded per client', async (t) => {
  t.plan(4)
  const sc = t.context as SC
  const nc1 = await connect({url: sc.server.nats, payload: Payload.Binary})
  const nc2 = await connect({url: sc.server.nats, payload: Payload.String})
  const subj = next()
  nc1.subscribe(subj, (err, msg) => {
    if (err) {
      t.fail(err.message)
    }
    t.truthy(Buffer.isBuffer(msg.data))
    t.is(msg.data.toString(), 'hello world')
  }, {max: 1})

  nc2.subscribe(subj, (err, msg) => {
    if (err) {
      t.fail(err.message)
    }
    t.is(typeof msg.data, 'string')
    t.is(msg.data, 'hello world')
  }, {max: 1})
  await nc1.flush()
  await nc2.flush()

  nc2.publish(subj, 'hello world')
  await nc2.flush()
  await nc1.flush()
  nc1.close()
  nc2.close()
})

test('binary client gets binary', async (t) => {
  t.plan(2)

  const sc = t.context as SC
  const nc = await connect({url: sc.server.nats, payload: Payload.Binary})
  const subj = next()
  nc.subscribe(subj, (err, msg) => {
    t.truthy(Buffer.isBuffer(msg.data))
    t.is(msg.data.toString(), 'hello world')
  }, {max: 1})

  nc.publish(subj, 'hello world')
  await nc.flush()
  nc.close()
})