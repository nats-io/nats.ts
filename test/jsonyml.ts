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
import * as u from './helpers/nats_conf_utils'


test('test serializing simple', (t) => {
  const x = {
    test: 'one'
  }
  const y = u.jsonToNatsConf(x)

  const buf = y.split('\n')
  buf.forEach((e, i) => {
    buf[i] = e.trim()
  })

  const z = buf.join(' ')
  t.is(z, 'test: one')
})

test('test serializing nested', (t) => {
  const x = {
    a: 'one',
    b: {
      a: 'two'
    }
  }
  const y = u.jsonToNatsConf(x)

  const buf = y.split('\n')
  buf.forEach((e, i) => {
    buf[i] = e.trim()
  })

  const z = buf.join(' ')
  t.is(z, 'a: one b { a: two }')
})

test('test serializing array', (t) => {
  const x = {
    a: 'one',
    b: ['a', 'b', 'c']
  }
  const y = u.jsonToNatsConf(x)

  const buf = y.split('\n')
  buf.forEach((e, i) => {
    buf[i] = e.trim()
  })

  const z = buf.join(' ')
  t.is(z, 'a: one b [ a b c ]')
})

test('test serializing array objs', (t) => {
  const x = {
    a: 'one',
    b: [{
      a: 'a'
    }, {
      b: 'b'
    }, {
      c: 'c'
    }]
  }
  const y = u.jsonToNatsConf(x)
  const buf = y.split('\n')
  buf.forEach((e, i) => {
    buf[i] = e.trim()
  })

  const z = buf.join(' ')
  t.is(z, 'a: one b [ { a: a } { b: b } { c: c } ]')
})

test('test serializing array arrays', (t) => {
  const x = {
    a: 'one',
    b: [{
      a: 'a',
      b: ['b', 'c']
    }, {
      b: 'b'
    }, {
      c: 'c'
    }]
  }
  const y = u.jsonToNatsConf(x)
  const buf = y.split('\n')
  buf.forEach((e, i) => {
    buf[i] = e.trim()
  })

  const z = buf.join(' ')
  t.is(z, 'a: one b [ { a: a b [ b c ] } { b: b } { c: c } ]')
})
