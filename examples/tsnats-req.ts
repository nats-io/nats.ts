/*
 * Copyright 2019 The NATS Authors
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

import {Client, connect, NatsConnectionOptions} from '../src/nats'
import {parseFlags} from "../test/helpers/argparser";

let flags = parseFlags(process.argv.slice(2), usage, ["timeout", "creds"]);
let opts = {} as NatsConnectionOptions;
opts.url = flags.server;
if (flags.options.creds) {
    opts.userCreds = flags.options.creds;
}
connect(opts)
    .then((nc: Client) => {
        // honor the timeout
        let max = flags.options["timeout"] || -1;
        max = parseInt(max.toString(), 10);
        if (max < 1) {
            max = 1000;
        }
        // make the request
        nc.request(flags.subject, max, flags.payload)
            .then((msg) => {
                console.log(`received response ${msg.data}`);
                nc.close();
            })
            .catch((err) => {
                console.log(`error sending request to [${flags.subject}]: ${err}`);
                nc.close();
            });
        console.log(`waiting for response to [${flags.subject}]`);
    })
    .catch((ex) => {
        console.log(`error connecting to ${flags.server || "nats://localhost:4222"}: ${ex}`);
    });


function usage() {
    console.log('tsnode-req [-s <server>] [-creds file] [-timeout millis] <subject> [data]');
    process.exit(-1);
}
