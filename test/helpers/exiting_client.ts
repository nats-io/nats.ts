/* tslint:disable:no-console */
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
import * as fs from 'fs'
import {connect, ConnectionOptions} from '../../src/nats'

const count = process.argv.length
test(parseInt(process.argv[count - 1], 10))

async function test(port: number) {
  await connect({port, name: 'closer test script'} as ConnectionOptions)
  .then((nc) => {
    nc.on('connect', () => {
      fs.writeFile('/tmp/existing_client.log', 'connected\n', (err) => {
        if (err) {
          console.error(err)
        }
      })
    })

    nc.on('error', (e) => {
      fs.appendFile('/tmp/existing_client.log', 'got error\n' + e, (err) => {
        if (err) {
          console.error(err)
        }
      })
      process.exit(1)
    })

    nc.subscribe('close', (err, msg) => {
      fs.appendFile('/tmp/existing_client.log', 'got close\n', (aerr) => {
        if (aerr) {
          console.error(aerr)
          process.exit(1)
        }
      })
      if (msg.reply) {
        nc.publish(msg.reply, 'closing')
      }
      nc.flush()
      .then(() => {
        nc.close()
        fs.appendFile('/tmp/existing_client.log', 'closed\n', (aerr) => {
          if (aerr) {
            console.error(aerr)
            process.exit(1)
          }
        })
        process.exit(0)
      })
    })

    nc.flush().then(() => {
      nc.publish('started')
    })
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
