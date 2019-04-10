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

import {connect, NatsConnectionOptions, SubscriptionOptions} from '../src/nats'
import {parseFlags} from "../test/helpers/argparser";

let flags = parseFlags(process.argv.slice(2), usage, ["max", "creds", "nkey"]);
let opts = {} as NatsConnectionOptions;
opts.url = flags.server;
if (flags.options.creds && flags.options.nkey) {
    console.error("specify one of -creds or -nkey");
    process.exit(-1);
}
if (flags.options.creds) {
    opts.userCreds = flags.options.creds;
}
if (flags.options.nkey) {
    opts.nkeyCreds = flags.options.nkey;
}

function usage() {
    console.log('tsnode-sub [-s <server>] [-creds file] [-nkey file] [-max count] <subject>');
    process.exit(-1);
}

async function main() {
    let nc = await connect(opts);

    nc.on('unsubscribe', () => {
        nc.close();
    });

    nc.on('permissionError', (err) => {
        nc.close();
        console.log(`${err}`);
    });

    // if user specifies a max, auto-unsubscribe when the count is reached
    let max = flags.options["max"] || -1;
    max = parseInt(max.toString(), 10);
    let subopts = {} as SubscriptionOptions;
    if (max > 0) {
        subopts.max = max;
    }

    // create the subscription
    let count = 0;
    await nc.subscribe(flags.subject, (err, msg) => {
        count++;
        if (err) {
            console.error(`[#${count}] error processing message [${err.message} - ${msg}`);
            return;
        }
        if (msg.reply) {
            console.log(`[#${count}] received request on [${msg.subject}]: ${msg.data} respond to ${msg.reply}`);
        } else {
            console.log(`[#${count}] received on [${msg.subject}]: ${msg.data}`);
        }
    }, subopts);

    nc.flush(() => {
        console.log(`listening to [${flags.subject}]`);
    });
}

main();
