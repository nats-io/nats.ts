/*
 * Copyright 2018-2019 The NATS Authors
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
import {connect} from '../src/nats'

test.before(async (t) => {
  let server = await startServer(['-DV'])
  t.context = {server: server}
})

test.after.always((t) => {
  stopServer((t.context as SC).server)
})

test('should not send multiple subscriptions on startup', async (t) => {
  let subsSeen = 0
  // server seems to be adding a space after sid
  let subRe = /(\[SUB foo \d\s*\])+/g

  // Capture log output from nats-server and check for double SUB protos.
  let sc = t.context as SC
  //@ts-ignore
  sc.server.stderr.on('data', function (data) {
    let lines = data.toString().split('\n')
    lines.forEach((s: string) => {
      // t.log(s);
      if (subRe.test(s)) {
        subsSeen++
      }
    })
  })

  let nc = await connect(sc.server.nats)
  nc.subscribe('foo', () => {
  })
  await nc.flush()
  await nc.flush()
  nc.close()
  t.is(subsSeen, 1)
})

